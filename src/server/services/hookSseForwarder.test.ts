// EN: hookEventBus → sseHub bridge integration test. Subscribe a
// fake SSE subscriber, fire a hook event, expect a `cc-hook` SSE
// frame on the matching session channel.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  _hookListenerCountForTests,
  _resetHookBusForTests,
  publishHook,
} from "@/server/services/hookEventBus";
import {
  _resetHookSseForwarderForTests,
  initHookSseForwarder,
} from "@/server/services/hookSseForwarder";
import { subscribe, type SseMessage } from "@/server/services/sseHub";

beforeEach(() => {
  _resetHookBusForTests();
  _resetHookSseForwarderForTests();
});

afterEach(() => {
  _resetHookBusForTests();
  _resetHookSseForwarderForTests();
});

describe("initHookSseForwarder", () => {
  it("is idempotent — calling twice attaches only one listener", () => {
    initHookSseForwarder();
    initHookSseForwarder();
    initHookSseForwarder();
    expect(_hookListenerCountForTests()).toBe(1);
  });

  it("forwards a published hook event to the SSE channel of its session_id", () => {
    initHookSseForwarder();
    const captured: SseMessage[] = [];
    const unsub = subscribe("sid-fwd-1", {
      send: (msg) => {
        captured.push(msg);
      },
    });
    try {
      publishHook("PermissionRequest", {
        session_id: "sid-fwd-1",
        cwd: "/tmp",
        extras: { tool_name: "Bash", tool_input: { command: "id" } },
      });
      expect(captured).toHaveLength(1);
      expect(captured[0].event).toBe("cc-hook");
      const data = captured[0].data as {
        event: string;
        payload: { session_id: string; extras: Record<string, unknown> };
      };
      expect(data.event).toBe("PermissionRequest");
      expect(data.payload.session_id).toBe("sid-fwd-1");
      expect(data.payload.extras.tool_name).toBe("Bash");
    } finally {
      unsub();
    }
  });

  it("does not deliver to subscribers of a different session_id", () => {
    initHookSseForwarder();
    const aMessages: SseMessage[] = [];
    const bMessages: SseMessage[] = [];
    const unsubA = subscribe("sid-a", { send: (m) => aMessages.push(m) });
    const unsubB = subscribe("sid-b", { send: (m) => bMessages.push(m) });
    try {
      publishHook("PreToolUse", {
        session_id: "sid-a",
        extras: {},
      });
      expect(aMessages).toHaveLength(1);
      expect(bMessages).toHaveLength(0);
    } finally {
      unsubA();
      unsubB();
    }
  });

  it("_resetHookSseForwarderForTests detaches the listener", () => {
    initHookSseForwarder();
    expect(_hookListenerCountForTests()).toBe(1);
    _resetHookSseForwarderForTests();
    expect(_hookListenerCountForTests()).toBe(0);
  });
});
