// EN (v∞.0 hook catchup): server-side per-session memory of unresolved
// PermissionRequest fires.
//
// CC hooks are fire-and-forget: when CC POSTs `/api/cc-hook?event=
// PermissionRequest`, we publish to hookEventBus → broadcast `cc-hook`
// SSE → clients with a live subscription get the banner. But:
//
//   - User in Loomscope viewing session B while CC is asking permission
//     in session A → SSE channel A has no subscribers → event dropped
//   - User opens Loomscope after CC was already paused waiting for
//     permission → no replay
//   - Multi-tab: tab2 connects after tab1 already cleared the
//     permission via PermissionDenied → tab2 doesn't know
//
// Other hooks (PreToolUse / PostToolUse / SubagentStart / etc.) DON'T
// need catchup — the file watcher will deliver the underlying jsonl
// records on next refresh. PermissionRequest is the one event with no
// file backing, so it's the only thing this tracker watches.
//
// Lifecycle of a pending entry:
//   • PermissionRequest                → stored
//   • PermissionDenied                 → cleared (user said no)
//   • PostToolUse for the same tool    → cleared (= user said yes,
//                                        the gated tool actually ran)
//   • SessionEnd                       → all pending for that session
//                                        cleared (defensive — CC died
//                                        with a prompt open)
//   • TTL expiry (10 min)              → cleared (very rare — process
//                                        leak guard)
//
// On SSE subscribe (sessions.ts route), we read the tracker for this
// session and emit a synthetic `cc-hook` event with the stored payload
// — exactly the same shape as a fresh fire. Client's applyCcHookEvent
// doesn't need to distinguish.
//
// 中: v∞.0 hook catchup —— server 端记忆每个 session 未结的
// PermissionRequest，新订阅者上线时发 snapshot。CC hook 是
// fire-and-forget，没人订阅就丢。其它 hook 文件监听有兜底，只有
// Permission 没文件备份，所以只追这一种。

import {
  subscribeHooks,
  type HookEnvelope,
} from "@/server/services/hookEventBus";

const TTL_MS = 10 * 60 * 1000; // 10 min — defensive process leak guard

interface PendingEntry {
  payload: HookEnvelope;
  storedAt: number;
}

const pending = new Map<string, PendingEntry>();
let unsubscribe: (() => void) | null = null;

function clearTtlExpired(): void {
  const cutoff = Date.now() - TTL_MS;
  for (const [sid, entry] of pending) {
    if (entry.storedAt < cutoff) pending.delete(sid);
  }
}

/** Idempotent — wires the bus listener once at boot. */
export function initPendingPermissionTracker(): void {
  if (unsubscribe) return;
  unsubscribe = subscribeHooks((event, payload) => {
    if (event === "PermissionRequest") {
      pending.set(payload.session_id, {
        payload,
        storedAt: Date.now(),
      });
      // Cheap opportunistic sweep on every write — keeps memory
      // bounded without a separate timer.
      clearTtlExpired();
      return;
    }
    if (event === "PermissionDenied") {
      pending.delete(payload.session_id);
      return;
    }
    if (event === "PostToolUse") {
      // The gated tool ran → user must have approved → pending is
      // resolved. Match by session_id; we don't track per-tool ids
      // because CC's permission flow is one-at-a-time per session.
      pending.delete(payload.session_id);
      return;
    }
    if (event === "SessionEnd") {
      pending.delete(payload.session_id);
      return;
    }
    // Other events: ignored.
  });
}

/**
 * Read current pending PermissionRequest for `sessionId`. Returns the
 * stored hook payload (same shape `applyCcHookEvent` consumes), or
 * null if nothing pending.
 *
 * Used by the SSE route on subscribe to send a catchup snapshot.
 */
export function getPendingPermission(sessionId: string): HookEnvelope | null {
  clearTtlExpired();
  return pending.get(sessionId)?.payload ?? null;
}

/** Test helper. */
export function _resetPendingPermissionTrackerForTests(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  pending.clear();
}

/** Test helper: peek state for assertions. */
export function _peekPendingForTests(): Array<{
  sessionId: string;
  storedAt: number;
}> {
  return [...pending.entries()].map(([sessionId, entry]) => ({
    sessionId,
    storedAt: entry.storedAt,
  }));
}
