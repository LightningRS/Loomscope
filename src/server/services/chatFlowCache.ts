// Server-side LRU cache for parsed ChatFlow.
//
// Why: parsing a 25 MB session JSONL takes ~250-300 ms (parse + merge
// + workflow build). For users who cycle between a handful of sessions
// — the typical workflow — re-parsing the same file every click is
// wasteful. Caching the merged ChatFlow keyed on (sessionId, mtime
// fingerprint) gives near-instant second-and-subsequent opens, and
// invalidates automatically when the underlying jsonl(s) change.
//
// Cache key includes mtimes of EVERY closure member (entry + all
// merged-in fork siblings/ancestors/descendants), so editing any
// closure member invalidates the cache. mtime is millisecond-resolution
// from fs.stat — same source v0.9 file-tail will use for change
// detection later.
//
// Eviction: simple insertion-order LRU (Map preserves insertion, and
// re-insertion-on-hit moves an entry to the most-recently-used end).
// Bounded by MAX_ENTRIES count rather than bytes; each ChatFlow is
// 5-25 MB in V8 representation, so 8 entries ≈ 100 MB upper bound.
// Size-based eviction would be more precise but harder to estimate
// accurately without sizeof()-equivalent.
//
// Lifetime: in-memory only. Cleared on process restart. That's fine —
// user reopens browser → first session click re-warms the cache.

import { promises as fs } from "node:fs";

import type { ChatFlow } from "@/data/types";
import type { ClosureMember } from "@/server/services/forkTree";

const MAX_ENTRIES = 8;

// Map preserves insertion order, so the iteration's first entry is the
// least-recently-used. We re-insert on hit (delete + set) to bump it
// to the end.
const cache = new Map<string, ChatFlow>();

// Public for tests; production callers should go through getOrLoad.
export function _resetForTests(): void {
  cache.clear();
}

export function _peekKeysForTests(): string[] {
  return [...cache.keys()];
}

/**
 * Build a stable cache key for a session + its fork closure. Includes
 * mtimes so any underlying JSONL change → key change → cache miss →
 * re-parse.
 *
 * Closure is BFS-ordered (per findForkClosure), so the resulting key
 * is deterministic for the same set of files.
 */
export async function buildCacheKey(
  sessionId: string,
  closure: ClosureMember[],
  fallbackJsonlPath: string,
): Promise<string> {
  // Closure can be empty when forkTree didn't locate the entry (rare —
  // usually means a malformed jsonl). Fall back to the entry path's
  // mtime alone.
  const paths =
    closure.length > 0 ? closure.map((m) => m.jsonlPath) : [fallbackJsonlPath];
  const mtimes = await Promise.all(
    paths.map((p) =>
      fs.stat(p).then(
        (s) => `${s.mtimeMs}`,
        () => "0", // unreadable path: treat as mtime 0 so any change re-keys
      ),
    ),
  );
  return `${sessionId}:${mtimes.join(",")}`;
}

/** Returns the cached ChatFlow + bumps it to the most-recently-used
 * end of the LRU. Returns null on miss. */
export function getCached(key: string): ChatFlow | null {
  const cf = cache.get(key);
  if (!cf) return null;
  // Move to MRU end.
  cache.delete(key);
  cache.set(key, cf);
  return cf;
}

/** Insert and apply LRU eviction if we exceed MAX_ENTRIES. */
export function setCached(key: string, chatFlow: ChatFlow): void {
  // If key already exists, delete first so the re-insert puts it at
  // the MRU end (same behaviour as `getCached`).
  if (cache.has(key)) cache.delete(key);
  cache.set(key, chatFlow);
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Default convenience wrapper used by route handlers. Computes the
 * cache key, returns cached if hit, otherwise calls `loader` and stores
 * the result. */
export async function getOrLoad(args: {
  sessionId: string;
  closure: ClosureMember[];
  fallbackJsonlPath: string;
  loader: () => Promise<ChatFlow>;
}): Promise<{ chatFlow: ChatFlow; cacheHit: boolean }> {
  const key = await buildCacheKey(
    args.sessionId,
    args.closure,
    args.fallbackJsonlPath,
  );
  const hit = getCached(key);
  if (hit) return { chatFlow: hit, cacheHit: true };
  const chatFlow = await args.loader();
  setCached(key, chatFlow);
  return { chatFlow, cacheHit: false };
}
