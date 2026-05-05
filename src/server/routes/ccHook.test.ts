// @vitest-environment node
//
// CC hook endpoint — auth + schema + bus publish.
//
// Hermetic: drives a Hono app instance directly via `app.request`,
// no listener, no real CC. Every test starts with a clean
// hookEventBus (no leaked listeners across cases).

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "@/server/app";
import { _setCacheRootForTests } from "@/server/services/chatFlowDiskCache";
import {
  _resetHookBusForTests,
  subscribeHooks,
  type HookEnvelope,
  type HookEventName,
} from "@/server/services/hookEventBus";

let tmpRoot: string;
let app: ReturnType<typeof createApp>;
const TOKEN = "test-token";
const ORIGIN = "http://localhost:5174";
const SECRET = "a".repeat(64);
const WRONG_SECRET = "b".repeat(64);

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "loomscope-ccHook-"));
  _setCacheRootForTests(path.join(tmpRoot, "disk-cache"));
  _resetHookBusForTests();
  app = createApp({
    rootDir: tmpRoot,
    csrfToken: TOKEN,
    allowedOrigin: ORIGIN,
    hookSecret: SECRET,
  });
});

afterEach(async () => {
  _setCacheRootForTests(null);
  _resetHookBusForTests();
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

async function postHook(opts: {
  event: string;
  body: unknown;
  secret?: string;
}): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (opts.secret !== undefined) {
    headers["X-Loomscope-Secret"] = opts.secret;
  }
  return app.request(`/api/cc-hook?event=${opts.event}`, {
    method: "POST",
    headers,
    body: JSON.stringify(opts.body),
  });
}

describe("POST /api/cc-hook — auth", () => {
  it("403 when no X-Loomscope-Secret header", async () => {
    const res = await postHook({
      event: "PreToolUse",
      body: { session_id: "sid-1" },
    });
    expect(res.status).toBe(403);
  });

  it("403 when secret mismatches", async () => {
    const res = await postHook({
      event: "PreToolUse",
      body: { session_id: "sid-1" },
      secret: WRONG_SECRET,
    });
    expect(res.status).toBe(403);
  });

  it("204 + bus publish when secret matches", async () => {
    const captured: Array<{ event: HookEventName; payload: HookEnvelope }> = [];
    subscribeHooks((event, payload) => captured.push({ event, payload }));
    const res = await postHook({
      event: "PreToolUse",
      body: { session_id: "sid-2", tool_name: "Bash", tool_input: { command: "ls" } },
      secret: SECRET,
    });
    expect(res.status).toBe(204);
    expect(captured).toHaveLength(1);
    expect(captured[0].event).toBe("PreToolUse");
    expect(captured[0].payload.session_id).toBe("sid-2");
    // Event-specific fields land in extras.
    expect(captured[0].payload.extras.tool_name).toBe("Bash");
    expect((captured[0].payload.extras.tool_input as Record<string, unknown>).command).toBe(
      "ls",
    );
  });

  it("does NOT require the CSRF token (server-to-server fire path)", async () => {
    // No X-Loomscope-Token. With a valid secret, this should succeed.
    const res = await postHook({
      event: "PostToolUse",
      body: { session_id: "sid-3" },
      secret: SECRET,
    });
    expect(res.status).toBe(204);
  });
});

describe("POST /api/cc-hook — schema validation", () => {
  it("400 on unknown event name", async () => {
    const res = await postHook({
      event: "NotARealEvent",
      body: { session_id: "sid-4" },
      secret: SECRET,
    });
    expect(res.status).toBe(400);
  });

  it("400 when body is missing session_id", async () => {
    const res = await postHook({
      event: "PreToolUse",
      body: { tool_name: "Bash" },
      secret: SECRET,
    });
    expect(res.status).toBe(400);
  });

  it("400 on empty body", async () => {
    const res = await postHook({
      event: "PreToolUse",
      body: {},
      secret: SECRET,
    });
    expect(res.status).toBe(400);
  });

  it("preserves event-specific fields in `extras`", async () => {
    const captured: HookEnvelope[] = [];
    subscribeHooks((_event, payload) => captured.push(payload));
    await postHook({
      event: "PostToolUse",
      body: {
        session_id: "sid-5",
        tool_name: "Bash",
        tool_input: { command: "echo hi" },
        tool_output: { stdout: "hi\n" },
        custom_field: "preserved",
      },
      secret: SECRET,
    });
    expect(captured[0].extras).toMatchObject({
      tool_name: "Bash",
      tool_input: { command: "echo hi" },
      tool_output: { stdout: "hi\n" },
      custom_field: "preserved",
    });
    // Known envelope fields are NOT duplicated into extras.
    expect("session_id" in captured[0].extras).toBe(false);
  });

  it("agent_id and agent_type are promoted to envelope (not extras)", async () => {
    const captured: HookEnvelope[] = [];
    subscribeHooks((_event, payload) => captured.push(payload));
    await postHook({
      event: "PreToolUse",
      body: {
        session_id: "sid-6",
        agent_id: "abc",
        agent_type: "general-purpose",
      },
      secret: SECRET,
    });
    expect(captured[0].agent_id).toBe("abc");
    expect(captured[0].agent_type).toBe("general-purpose");
    expect("agent_id" in captured[0].extras).toBe(false);
  });
});

describe("POST /api/cc-hook — supported events", () => {
  const EVENTS = [
    "PreToolUse",
    "PostToolUse",
    "SubagentStart",
    "SubagentStop",
    "PreCompact",
    "PostCompact",
    "TaskCompleted",
    "SessionStart",
    "SessionEnd",
    "PermissionRequest",
    "PermissionDenied",
  ];
  it.each(EVENTS)("accepts %s", async (event) => {
    const res = await postHook({
      event,
      body: { session_id: "sid-7" },
      secret: SECRET,
    });
    expect(res.status).toBe(204);
  });
});

describe("POST /api/cc-hook — listener errors don't propagate", () => {
  it("a throwing subscriber doesn't fail the request or block other subscribers", async () => {
    const goodSeen: HookEnvelope[] = [];
    subscribeHooks(() => {
      throw new Error("listener boom");
    });
    subscribeHooks((_event, payload) => goodSeen.push(payload));
    const res = await postHook({
      event: "PreToolUse",
      body: { session_id: "sid-8" },
      secret: SECRET,
    });
    expect(res.status).toBe(204);
    expect(goodSeen).toHaveLength(1);
  });
});
