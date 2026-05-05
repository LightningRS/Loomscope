// EN (v∞.0 PR 2): bridge from `hookEventBus` to `sseHub`. Subscribes
// once at app boot; on each hook fire publishes a `cc-hook` event
// (with the event name + envelope) on the per-session SSE channel
// so any client currently watching that session sees it.
//
// Why a separate forwarder instead of inlining the broadcast in
// `routes/ccHook.ts`: the bus can have multiple consumers
// (forwarder, future logging, future audit). A dedicated subscriber
// per consumer keeps each one's lifecycle / error handling
// independent.
//
// Idempotent init: calling `initHookSseForwarder()` twice is a
// no-op. The route handler in `app.ts` calls it from `createApp`
// so test harnesses and the production CLI both get the wiring
// without bothering callers.
//
// 中: hookEventBus → sseHub 的桥。boot 时挂一个 listener，hook fire
// 后按 session_id 在 SSE 通道广播 `cc-hook` 事件（含 event 名 +
// envelope）。idempotent，重复调用是 no-op。

import {
  subscribeHooks,
  type HookEnvelope,
  type HookEventName,
} from "@/server/services/hookEventBus";
import { broadcast } from "@/server/services/sseHub";

let unsubscribe: (() => void) | null = null;

export function initHookSseForwarder(): void {
  if (unsubscribe) return;
  unsubscribe = subscribeHooks((event: HookEventName, payload: HookEnvelope) => {
    broadcast(payload.session_id, {
      event: "cc-hook",
      data: { event, payload },
    });
  });
}

/** Test helper: tear down the forwarder so each test gets a clean
 * subscriber state. */
export function _resetHookSseForwarderForTests(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
}
