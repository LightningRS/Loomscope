// pendingPermissionTracker — server-side memory of unresolved
// PermissionRequest hooks. Drives the v∞.0 hook catchup story:
// late-joining subscribers see currently-pending permissions even
// though the original cc-hook fire was broadcast before they were
// listening.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  _resetHookBusForTests,
  publishHook,
  type HookEnvelope,
} from "@/server/services/hookEventBus";
import {
  _peekPendingForTests,
  _resetPendingPermissionTrackerForTests,
  getPendingPermission,
  initPendingPermissionTracker,
} from "@/server/services/pendingPermissionTracker";

function envelope(sessionId: string, extras: Record<string, unknown> = {}): HookEnvelope {
  return {
    session_id: sessionId,
    cwd: "/tmp",
    permission_mode: "default",
    extras,
  };
}

beforeEach(() => {
  _resetHookBusForTests();
  _resetPendingPermissionTrackerForTests();
  initPendingPermissionTracker();
});

afterEach(() => {
  _resetHookBusForTests();
  _resetPendingPermissionTrackerForTests();
});

describe("pendingPermissionTracker", () => {
  it("records a PermissionRequest as pending for its session_id", () => {
    publishHook(
      "PermissionRequest",
      envelope("sid-A", { tool_name: "Bash", tool_input: { command: "ls" } }),
    );
    const pending = getPendingPermission("sid-A");
    expect(pending).not.toBeNull();
    expect(pending?.session_id).toBe("sid-A");
    expect(pending?.extras.tool_name).toBe("Bash");
  });

  it("returns null for sessions with no pending request", () => {
    expect(getPendingPermission("never-asked")).toBeNull();
  });

  it("PermissionDenied clears the pending entry", () => {
    publishHook("PermissionRequest", envelope("sid-B"));
    expect(getPendingPermission("sid-B")).not.toBeNull();
    publishHook("PermissionDenied", envelope("sid-B"));
    expect(getPendingPermission("sid-B")).toBeNull();
  });

  it("PostToolUse clears the pending entry (= user approved + tool ran)", () => {
    publishHook("PermissionRequest", envelope("sid-C"));
    publishHook("PostToolUse", envelope("sid-C"));
    expect(getPendingPermission("sid-C")).toBeNull();
  });

  it("SessionEnd clears any pending entry for that session", () => {
    publishHook("PermissionRequest", envelope("sid-D"));
    publishHook("SessionEnd", envelope("sid-D"));
    expect(getPendingPermission("sid-D")).toBeNull();
  });

  it("multiple sessions are tracked independently", () => {
    publishHook("PermissionRequest", envelope("sid-X"));
    publishHook("PermissionRequest", envelope("sid-Y"));
    publishHook("PermissionDenied", envelope("sid-X"));
    expect(getPendingPermission("sid-X")).toBeNull();
    expect(getPendingPermission("sid-Y")).not.toBeNull();
  });

  it("overwrites the previous pending when a new PermissionRequest comes for the same session", () => {
    publishHook(
      "PermissionRequest",
      envelope("sid-E", { tool_name: "Bash" }),
    );
    publishHook(
      "PermissionRequest",
      envelope("sid-E", { tool_name: "Edit" }),
    );
    expect(getPendingPermission("sid-E")?.extras.tool_name).toBe("Edit");
  });

  it("non-Permission / non-PostToolUse / non-SessionEnd events don't touch the tracker", () => {
    publishHook("PreToolUse", envelope("sid-F", { tool_name: "Bash" }));
    publishHook("SubagentStart", envelope("sid-F"));
    publishHook("PreCompact", envelope("sid-F"));
    expect(_peekPendingForTests()).toEqual([]);
  });

  it("init is idempotent — calling twice doesn't double-register the bus listener", () => {
    initPendingPermissionTracker();
    initPendingPermissionTracker();
    publishHook("PermissionRequest", envelope("sid-G"));
    // If listener was double-registered, we'd see the entry written
    // twice (still just one entry in Map, but no error). Best
    // observable: PermissionDenied should clear cleanly.
    publishHook("PermissionDenied", envelope("sid-G"));
    expect(getPendingPermission("sid-G")).toBeNull();
  });
});
