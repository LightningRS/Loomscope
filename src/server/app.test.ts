// @vitest-environment node
//
// Forces a Node-native environment so `Origin` headers aren't stripped as
// forbidden by happy-dom's spec-compliant `Request` polyfill (browsers
// reject JS-set Origin; we need to set it from tests to exercise CORS).

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "@/server/app";

let tmpRoot: string;
let app: ReturnType<typeof createApp>;
const TOKEN = "test-token";
const ORIGIN = "http://localhost:5174";

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "loomscope-app-test-"));
  app = createApp({ rootDir: tmpRoot, csrfToken: TOKEN, allowedOrigin: ORIGIN });
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

async function writeJsonl(filePath: string, lines: object[]): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

describe("GET /api/health", () => {
  it("returns ok=true", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; rootDir: string };
    expect(body.ok).toBe(true);
    expect(body.rootDir).toBe(tmpRoot);
  });
});

describe("GET /api/workspaces", () => {
  it("returns the scanned list without internal projectDir field", async () => {
    const projectDir = path.join(tmpRoot, "-home-user-Foo");
    await writeJsonl(path.join(projectDir, "s.jsonl"), [{ cwd: "/home/user/Foo" }]);
    const res = await app.request("/api/workspaces");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);
    expect(body[0].cwd).toBe("/home/user/Foo");
    expect(body[0].sessionCount).toBe(1);
    expect(body[0]).not.toHaveProperty("projectDir");
  });
});

describe("GET /api/workspaces/:cwdEnc/sessions", () => {
  it("returns sessions for a cwd", async () => {
    const projectDir = path.join(tmpRoot, "-home-user-Foo");
    await writeJsonl(path.join(projectDir, "00000000-0000-4000-8000-000000000001.jsonl"), [
      { type: "user", cwd: "/home/user/Foo", message: { content: "hi" } },
    ]);
    const cwdEnc = encodeURIComponent("/home/user/Foo");
    const res = await app.request(`/api/workspaces/${cwdEnc}/sessions`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ sessionId: string; title: string }>;
    expect(body).toHaveLength(1);
    expect(body[0].sessionId).toBe("00000000-0000-4000-8000-000000000001");
  });

  it("404s for an unknown cwd", async () => {
    const cwdEnc = encodeURIComponent("/does/not/exist");
    const res = await app.request(`/api/workspaces/${cwdEnc}/sessions`);
    expect(res.status).toBe(404);
  });
});

describe("GET /api/sessions/:id", () => {
  it("returns parsed ChatFlow for an existing session", async () => {
    const projectDir = path.join(tmpRoot, "-home-user-Foo");
    const sid = "11111111-1111-4000-8000-000000000001";
    await writeJsonl(path.join(projectDir, `${sid}.jsonl`), [
      {
        type: "user",
        uuid: "u1",
        sessionId: sid,
        promptId: "p1",
        cwd: "/home/user/Foo",
        gitBranch: "main",
        message: { role: "user", content: "Hi" },
        timestamp: "2026-05-02T00:00:00.000Z",
      },
      {
        type: "assistant",
        uuid: "a1",
        parentUuid: "u1",
        sessionId: sid,
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Hello." }],
          stop_reason: "end_turn",
        },
        timestamp: "2026-05-02T00:00:01.000Z",
      },
    ]);
    const res = await app.request(`/api/sessions/${sid}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; chatNodes: unknown[] };
    expect(body.id).toBe(sid);
    expect(body.chatNodes.length).toBe(1);
  });

  it("404s for an unknown session id", async () => {
    const res = await app.request("/api/sessions/00000000-0000-4000-8000-deadbeef0000");
    expect(res.status).toBe(404);
  });

  it("400s on a malformed session id", async () => {
    const res = await app.request("/api/sessions/not-a-uuid");
    expect(res.status).toBe(400);
  });
});

describe("GET /api/sessions/:id — fork closure merge (v0.8 M2)", () => {
  // Reuse the disk-resident fork-pair fixture so this exercises the
  // exact code paths a real session would hit (file system scan +
  // closure resolver + merge). The fixture lives in
  // src/parse/__fixtures__/synthetic/fork-pair/ — copy it into
  // tmpRoot's project subdir at test time so each test gets isolated
  // tmpdir behavior consistent with other endpoint tests.
  const ORIG_SID = "aaaaaaaa-1111-2222-3333-aaaaaaaaaaaa";
  const FORK_SID = "bbbbbbbb-1111-2222-3333-bbbbbbbbbbbb";
  const FIXTURE_DIR = path.resolve(
    __dirname,
    "..",
    "parse",
    "__fixtures__",
    "synthetic",
    "fork-pair",
  );

  async function copyForkPair(projectName: string): Promise<void> {
    const projectDir = path.join(tmpRoot, projectName);
    await fs.mkdir(projectDir, { recursive: true });
    for (const file of [`${ORIG_SID}.jsonl`, `${FORK_SID}.jsonl`]) {
      await fs.copyFile(
        path.join(FIXTURE_DIR, file),
        path.join(projectDir, file),
      );
    }
  }

  it("merges fork-pair into a single ChatFlow with sibling-fork sharing parent ChatNode", async () => {
    await copyForkPair("-home-dev-example");
    const res = await app.request(`/api/sessions/${FORK_SID}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      chatNodes: Array<{ id: string; parentChatNodeId: string | null }>;
      linkedSessions?: string[];
      customTitle?: string;
    };
    // entry session id wins as the merged ChatFlow's id.
    expect(body.id).toBe(FORK_SID);
    // 4 ChatNodes: p1 + p2 + p3 (from original) + p4f (NEW in fork).
    const ids = body.chatNodes.map((c) => c.id).sort();
    expect(ids).toEqual(["p1", "p2", "p3", "p4f"]);
    // Sibling fork: p2 has TWO children (p3 from original, p4f from
    // fork), both sharing parentChatNodeId === "p2".
    const p3 = body.chatNodes.find((c) => c.id === "p3");
    const p4f = body.chatNodes.find((c) => c.id === "p4f");
    expect(p3?.parentChatNodeId).toBe("p2");
    expect(p4f?.parentChatNodeId).toBe("p2");
    // linkedSessions records both closure members (BFS order, entry
    // first — fork was the entry).
    expect(body.linkedSessions).toEqual(
      expect.arrayContaining([FORK_SID, ORIG_SID]),
    );
    expect(body.linkedSessions?.[0]).toBe(FORK_SID);
    // customTitle from fork's `{type:"custom-title"}` record.
    expect(body.customTitle).toBe("list files (Branch)");
  });

  it("loading the original session also returns the merged closure (descendant scan)", async () => {
    await copyForkPair("-home-dev-example2");
    const res = await app.request(`/api/sessions/${ORIG_SID}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      chatNodes: Array<{ id: string }>;
      linkedSessions?: string[];
    };
    // Same 4 ChatNodes regardless of which side the user enters from
    // (consistent merged view per design choice 1A).
    const ids = body.chatNodes.map((c) => c.id).sort();
    expect(ids).toEqual(["p1", "p2", "p3", "p4f"]);
    // Entry now is original; closure still contains both.
    expect(body.id).toBe(ORIG_SID);
    expect(body.linkedSessions?.[0]).toBe(ORIG_SID);
  });

  it("uuid dedup keeps the first occurrence (original wins for shared records)", async () => {
    await copyForkPair("-home-dev-example3");
    const res = await app.request(`/api/sessions/${ORIG_SID}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      chatNodes: Array<{
        id: string;
        forkedFrom?: { sessionId: string; messageUuid: string };
      }>;
    };
    // p1 + p2 records exist in BOTH jsonls. When we enter from the
    // ORIGINAL (closure order: orig first), the original's records win
    // — they have NO forkedFrom marker, so the merged ChatNodes for p1
    // / p2 have forkedFrom === undefined.
    const p1 = body.chatNodes.find((c) => c.id === "p1");
    const p2 = body.chatNodes.find((c) => c.id === "p2");
    expect(p1?.forkedFrom).toBeUndefined();
    expect(p2?.forkedFrom).toBeUndefined();
  });

  it("non-fork session: linkedSessions stays undefined (degenerates to v0.7 path)", async () => {
    const projectDir = path.join(tmpRoot, "-home-user-Foo");
    const sid = "55555555-5555-4000-8000-000000000020";
    await writeJsonl(path.join(projectDir, `${sid}.jsonl`), [
      {
        type: "user",
        uuid: "u-only",
        sessionId: sid,
        promptId: "p-only",
        message: { role: "user", content: "alone" },
        timestamp: "2026-05-04T00:00:00.000Z",
      },
    ]);
    const res = await app.request(`/api/sessions/${sid}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { linkedSessions?: string[] };
    expect(body.linkedSessions).toBeUndefined();
  });
});

describe("GET /api/sessions/:id/tool-results/:refId", () => {
  // Minimum overflow file used across cases. We pick a size > the
  // 200 KB chunk threshold so tests can exercise both first-chunk +
  // continuation reads.
  const SID = "22222222-2222-4000-8000-000000000001";
  const PROJECT = "-home-user-Foo";
  const REF_ID = "abc_DEF-123";
  const PAYLOAD_BYTES = 250 * 1024; // > 200 KB chunk
  const PAYLOAD = Buffer.alloc(PAYLOAD_BYTES, "x");
  // Stamp a recognizable boundary marker at byte 200_000 so we can
  // verify the chunk start parameter actually advances the read.
  PAYLOAD.write("BOUNDARY", 200_000);

  beforeEach(async () => {
    const projectDir = path.join(tmpRoot, PROJECT);
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, `${SID}.jsonl`),
      JSON.stringify({ type: "user", uuid: "u1", sessionId: SID }) + "\n",
    );
    const sidecarDir = path.join(projectDir, SID, "tool-results");
    await fs.mkdir(sidecarDir, { recursive: true });
    await fs.writeFile(path.join(sidecarDir, `${REF_ID}.txt`), PAYLOAD);
  });

  it("returns the first 200 KB chunk by default with totalSize + hasMore", async () => {
    const res = await app.request(`/api/sessions/${SID}/tool-results/${REF_ID}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      refId: string;
      content: string;
      start: number;
      end: number;
      totalSize: number;
      hasMore: boolean;
    };
    expect(body.refId).toBe(REF_ID);
    expect(body.start).toBe(0);
    expect(body.end).toBe(200 * 1024);
    expect(body.totalSize).toBe(PAYLOAD_BYTES);
    expect(body.hasMore).toBe(true);
    expect(Buffer.byteLength(body.content, "utf8")).toBe(200 * 1024);
  });

  it("?start advances the read so subsequent chunks pick up where the first ended", async () => {
    const res = await app.request(
      `/api/sessions/${SID}/tool-results/${REF_ID}?start=200000`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      content: string;
      start: number;
      end: number;
      hasMore: boolean;
    };
    expect(body.start).toBe(200_000);
    expect(body.end).toBe(PAYLOAD_BYTES);
    expect(body.hasMore).toBe(false);
    // The boundary marker we stamped at byte 200_000 must be at the
    // very front of this chunk's content.
    expect(body.content.startsWith("BOUNDARY")).toBe(true);
  });

  it("404s when the refId doesn't exist on disk", async () => {
    const res = await app.request(
      `/api/sessions/${SID}/tool-results/no_such_ref`,
    );
    expect(res.status).toBe(404);
  });

  it("404s when the session itself doesn't exist", async () => {
    const res = await app.request(
      `/api/sessions/00000000-0000-4000-8000-deadbeef0000/tool-results/${REF_ID}`,
    );
    expect(res.status).toBe(404);
  });

  it("400s on a refId that contains path-traversal characters (rejected by zod)", async () => {
    // ``..`` and ``/`` and dots are not in [A-Za-z0-9_-]. Hono's
    // zValidator returns 400 on schema violation.
    const res = await app.request(
      `/api/sessions/${SID}/tool-results/${encodeURIComponent("../../etc/passwd")}`,
    );
    expect(res.status).toBe(400);
  });

  it("416s when ?start exceeds the file size", async () => {
    const res = await app.request(
      `/api/sessions/${SID}/tool-results/${REF_ID}?start=999999999`,
    );
    expect(res.status).toBe(416);
  });

  it("400s on malformed ?start", async () => {
    const res = await app.request(
      `/api/sessions/${SID}/tool-results/${REF_ID}?start=oops`,
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /api/sessions/:id/subagents/:agentId", () => {
  const SID = "33333333-3333-4000-8000-000000000001";
  const PROJECT = "-home-user-Foo";
  const AGENT_ID = "abc123def456";

  // Tiny but parseable sub-agent jsonl: one user prompt + one
  // assistant reply, all marked isSidechain:true (matches CC's
  // recordSidechainTranscript invariant).
  const subAgentJsonl = [
    {
      type: "user",
      uuid: "su1",
      sessionId: SID,
      promptId: "sp1",
      isSidechain: true,
      message: { role: "user", content: "Find perf hot spots." },
      timestamp: "2026-05-03T00:00:00.000Z",
    },
    {
      type: "assistant",
      uuid: "sa1",
      parentUuid: "su1",
      sessionId: SID,
      isSidechain: true,
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Three hot spots identified." }],
        stop_reason: "end_turn",
      },
      timestamp: "2026-05-03T00:00:01.000Z",
    },
  ];
  const META = {
    agentType: "Explore",
    description: "Find perf hot spots",
  };

  beforeEach(async () => {
    const projectDir = path.join(tmpRoot, PROJECT);
    await fs.mkdir(projectDir, { recursive: true });
    await writeJsonl(path.join(projectDir, `${SID}.jsonl`), [
      { type: "user", uuid: "u1", sessionId: SID, promptId: "p1", message: { content: "hi" } },
    ]);
    const subagentsDir = path.join(projectDir, SID, "subagents");
    await fs.mkdir(subagentsDir, { recursive: true });
    await writeJsonl(path.join(subagentsDir, `agent-${AGENT_ID}.jsonl`), subAgentJsonl);
    await fs.writeFile(
      path.join(subagentsDir, `agent-${AGENT_ID}.meta.json`),
      JSON.stringify(META),
    );
  });

  it("returns the parsed sub-agent ChatFlow + meta on happy path", async () => {
    const res = await app.request(`/api/sessions/${SID}/subagents/${AGENT_ID}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      agentId: string;
      subdir: string | null;
      chatFlow: { chatNodes: unknown[] };
      meta: { agentType: string; description?: string } | null;
    };
    expect(body.agentId).toBe(AGENT_ID);
    expect(body.subdir).toBeNull();
    expect(body.chatFlow.chatNodes.length).toBeGreaterThan(0);
    expect(body.meta?.agentType).toBe("Explore");
  });

  it("returns meta=null when meta.json is missing (older CC versions)", async () => {
    await fs.rm(
      path.join(tmpRoot, PROJECT, SID, "subagents", `agent-${AGENT_ID}.meta.json`),
    );
    const res = await app.request(`/api/sessions/${SID}/subagents/${AGENT_ID}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { meta: unknown };
    expect(body.meta).toBeNull();
  });

  it("supports the optional ?subdir param for grouped runs", async () => {
    const groupedDir = path.join(
      tmpRoot,
      PROJECT,
      SID,
      "subagents",
      "workflow_run_x",
    );
    await fs.mkdir(groupedDir, { recursive: true });
    await writeJsonl(path.join(groupedDir, `agent-${AGENT_ID}.jsonl`), subAgentJsonl);
    const res = await app.request(
      `/api/sessions/${SID}/subagents/${AGENT_ID}?subdir=workflow_run_x`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { subdir: string | null };
    expect(body.subdir).toBe("workflow_run_x");
  });

  it("404s when the sub-agent jsonl doesn't exist", async () => {
    const res = await app.request(`/api/sessions/${SID}/subagents/no_such_agent`);
    expect(res.status).toBe(404);
  });

  it("404s when the session itself doesn't exist", async () => {
    const res = await app.request(
      `/api/sessions/00000000-0000-4000-8000-deadbeef0000/subagents/${AGENT_ID}`,
    );
    expect(res.status).toBe(404);
  });

  it("400s on agentId with path-traversal characters", async () => {
    const res = await app.request(
      `/api/sessions/${SID}/subagents/${encodeURIComponent("../../etc/passwd")}`,
    );
    expect(res.status).toBe(400);
  });

  it("400s on subdir with path-traversal characters", async () => {
    const res = await app.request(
      `/api/sessions/${SID}/subagents/${AGENT_ID}?subdir=${encodeURIComponent("../sneaky")}`,
    );
    expect(res.status).toBe(400);
  });
});

describe("CSRF middleware", () => {
  it("rejects POST without X-Loomscope-Token", async () => {
    const res = await app.request("/api/health", { method: "POST" });
    expect(res.status).toBe(403);
  });

  it("rejects POST with wrong token", async () => {
    const res = await app.request("/api/health", {
      method: "POST",
      headers: { "x-loomscope-token": "bogus" },
    });
    expect(res.status).toBe(403);
  });
});

describe("CORS middleware", () => {
  it("rejects cross-origin requests", async () => {
    const res = await app.request("/api/health", {
      headers: { origin: "http://evil.com" },
    });
    expect(res.status).toBe(403);
  });

  it("passes same-origin requests", async () => {
    const res = await app.request("/api/health", { headers: { origin: ORIGIN } });
    expect(res.status).toBe(200);
  });
});
