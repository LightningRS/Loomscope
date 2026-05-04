// @vitest-environment node

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { findForkClosure } from "@/server/services/forkTree";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "loomscope-forkTree-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

interface RecordSeed {
  uuid: string;
  parentUuid?: string | null;
  type?: string;
  forkedFrom?: { sessionId: string; messageUuid: string };
}

async function writeJsonl(
  sessionId: string,
  records: RecordSeed[],
): Promise<string> {
  const file = path.join(tmpDir, `${sessionId}.jsonl`);
  const lines = records.map((r) =>
    JSON.stringify({
      type: r.type ?? "user",
      uuid: r.uuid,
      parentUuid: r.parentUuid ?? null,
      sessionId,
      promptId: r.uuid, // simple 1-record bucket per row in these tests
      timestamp: "2026-04-10T00:00:00.000Z",
      message: { role: "user", content: r.uuid },
      ...(r.forkedFrom ? { forkedFrom: r.forkedFrom } : {}),
    }),
  );
  await fs.writeFile(file, lines.join("\n") + "\n");
  return file;
}

describe("findForkClosure", () => {
  it("returns just the entry session when no forks exist anywhere", async () => {
    const sid = "11111111-1111-4000-8000-000000000001";
    await writeJsonl(sid, [{ uuid: "u1" }, { uuid: "u2", parentUuid: "u1" }]);
    const closure = await findForkClosure({
      projectDir: tmpDir,
      entrySessionId: sid,
    });
    expect(closure.map((m) => m.sessionId)).toEqual([sid]);
  });

  it("walks parent chain via forkedFrom (entry IS a fork)", async () => {
    const orig = "aaaaaaaa-aaaa-4000-8000-000000000001";
    const fork = "bbbbbbbb-bbbb-4000-8000-000000000002";
    await writeJsonl(orig, [{ uuid: "u1" }]);
    await writeJsonl(fork, [
      { uuid: "u1", forkedFrom: { sessionId: orig, messageUuid: "u1" } },
      { uuid: "u2-fork", parentUuid: "u1" },
    ]);
    const closure = await findForkClosure({
      projectDir: tmpDir,
      entrySessionId: fork,
    });
    expect(closure.map((m) => m.sessionId).sort()).toEqual([fork, orig].sort());
  });

  it("walks descendants (entry IS the original, fork session points back)", async () => {
    const orig = "cccccccc-cccc-4000-8000-000000000003";
    const fork = "dddddddd-dddd-4000-8000-000000000004";
    await writeJsonl(orig, [{ uuid: "u1" }]);
    await writeJsonl(fork, [
      { uuid: "u1", forkedFrom: { sessionId: orig, messageUuid: "u1" } },
    ]);
    const closure = await findForkClosure({
      projectDir: tmpDir,
      entrySessionId: orig,
    });
    expect(closure[0].sessionId).toBe(orig); // entry first
    expect(closure.map((m) => m.sessionId).sort()).toEqual([fork, orig].sort());
  });

  it("nested fork: entry → parent → grandparent + sibling forks", async () => {
    const root = "eeeeeeee-eeee-4000-8000-000000000005";
    const mid = "ffffffff-ffff-4000-8000-000000000006";
    const leaf = "00000000-1111-4000-8000-000000000007";
    const sibling = "00000000-2222-4000-8000-000000000008";
    await writeJsonl(root, [{ uuid: "u1" }]);
    await writeJsonl(mid, [
      { uuid: "u1", forkedFrom: { sessionId: root, messageUuid: "u1" } },
    ]);
    await writeJsonl(leaf, [
      { uuid: "u1", forkedFrom: { sessionId: mid, messageUuid: "u1" } },
    ]);
    await writeJsonl(sibling, [
      { uuid: "u1", forkedFrom: { sessionId: root, messageUuid: "u1" } },
    ]);
    const closure = await findForkClosure({
      projectDir: tmpDir,
      entrySessionId: leaf,
    });
    // Closure should include all 4 sessions; order = entry, then BFS.
    expect(closure[0].sessionId).toBe(leaf);
    expect(closure.map((m) => m.sessionId).sort()).toEqual(
      [root, mid, leaf, sibling].sort(),
    );
  });

  it("defends against forkedFrom cycle (corrupt input shouldn't loop forever)", async () => {
    // a → forkedFrom: b; b → forkedFrom: a (impossible from CC but
    // shouldn't loop). seen-set guarantees termination.
    const a = "aaaaaaaa-cycle-4000-8000-000000000009";
    const b = "bbbbbbbb-cycle-4000-8000-000000000010";
    await writeJsonl(a, [
      { uuid: "u1", forkedFrom: { sessionId: b, messageUuid: "u1" } },
    ]);
    await writeJsonl(b, [
      { uuid: "u1", forkedFrom: { sessionId: a, messageUuid: "u1" } },
    ]);
    const closure = await findForkClosure({
      projectDir: tmpDir,
      entrySessionId: a,
    });
    expect(closure.map((m) => m.sessionId).sort()).toEqual([a, b].sort());
  });

  it("skips forkedFrom pointing to a non-existent jsonl (stale reference)", async () => {
    const sid = "22222222-2222-4000-8000-000000000011";
    await writeJsonl(sid, [
      {
        uuid: "u1",
        forkedFrom: { sessionId: "ghost-session-id-xxxx", messageUuid: "u1" },
      },
    ]);
    const closure = await findForkClosure({
      projectDir: tmpDir,
      entrySessionId: sid,
    });
    // Ghost parent silently dropped; closure has just the entry.
    expect(closure.map((m) => m.sessionId)).toEqual([sid]);
  });

  it("returns [] when entry session jsonl can't be located", async () => {
    const closure = await findForkClosure({
      projectDir: tmpDir,
      entrySessionId: "missing-session-aaaa-bbbb-cccccccccccc",
    });
    expect(closure).toEqual([]);
  });

  it("multi-fork in one project (entry has many sibling children)", async () => {
    const root = "33333333-3333-4000-8000-000000000012";
    const c1 = "44444444-4444-4000-8000-000000000013";
    const c2 = "44444444-5555-4000-8000-000000000014";
    const c3 = "44444444-6666-4000-8000-000000000015";
    await writeJsonl(root, [{ uuid: "u1" }]);
    for (const child of [c1, c2, c3]) {
      await writeJsonl(child, [
        { uuid: "u1", forkedFrom: { sessionId: root, messageUuid: "u1" } },
      ]);
    }
    const closure = await findForkClosure({
      projectDir: tmpDir,
      entrySessionId: root,
    });
    expect(closure.map((m) => m.sessionId).sort()).toEqual(
      [root, c1, c2, c3].sort(),
    );
  });
});
