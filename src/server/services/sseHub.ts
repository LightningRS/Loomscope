// v0.9 file-tail: per-session SSE pub/sub hub.
//
// Why: file-tail mode pushes "this session's underlying jsonl changed,
// re-fetch" events from server → connected browsers. The watcher
// (sessionWatcher.ts) is the publisher; the SSE route (sessions.ts
// /:id/events) registers a Subscriber per connected EventSource and
// hands its `send` function to the hub. Keeping pub/sub in its own
// module lets future event sources (CC settings.json hooks → POST →
// broadcast) plug in without touching the watcher.
//
// Lifetime: in-memory only, single process. Reconnects are the
// EventSource client's responsibility (browser auto-retries every
// `retry:` ms by default).
//
// Event shape (data is JSON-encoded):
//   event: hello       — sent once on connect, payload { sessionId }
//   event: invalidate  — fs change detected, payload { sessionId, reason, path? }
//   event: ping        — periodic heartbeat, payload {}; client ignores
//
// "Per-session" granularity, not per-connection: multiple browser tabs
// viewing the same session share a subscriber set, all get the same
// invalidate fanout.
//
// Note: subscribe() and unsubscribe() are sync — they only mutate the
// in-memory map. The actual stream write happens inside `send`, which
// the SSE route wraps over hono's stream.writeSSE.
export interface SseSubscriber {
  send: (msg: SseMessage) => void;
}

export interface SseMessage {
  event: string;
  data: unknown;
}

const subscribers = new Map<string, Set<SseSubscriber>>();

export function subscribe(sessionId: string, sub: SseSubscriber): () => void {
  let set = subscribers.get(sessionId);
  if (!set) {
    set = new Set();
    subscribers.set(sessionId, set);
  }
  set.add(sub);
  return () => {
    const s = subscribers.get(sessionId);
    if (!s) return;
    s.delete(sub);
    if (s.size === 0) subscribers.delete(sessionId);
  };
}

export function broadcast(sessionId: string, msg: SseMessage): void {
  const set = subscribers.get(sessionId);
  if (!set) return;
  // Snapshot — `send` may indirectly trigger unsubscribe (e.g. write
  // failure tearing down the stream); iterating the live Set would skip
  // entries.
  for (const sub of [...set]) {
    try {
      sub.send(msg);
    } catch (err) {
      console.error("[sseHub] subscriber send threw:", err);
    }
  }
}

export function subscriberCount(sessionId: string): number {
  return subscribers.get(sessionId)?.size ?? 0;
}

// Test/debug helper.
export function _resetForTests(): void {
  subscribers.clear();
}
