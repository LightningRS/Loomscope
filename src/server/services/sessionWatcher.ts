// v0.9 file-tail: refcounted chokidar watcher for session JSONLs.
//
// Why a refcounted single watcher instead of one chokidar per session:
// fork closures overlap (sibling forks share most ancestor jsonls), so
// tracking watch by-path with a `path → sessionIds` reverse-map lets us
// fire one event handler per fs change and fan out to every interested
// session without redundant watchers.
//
// Lifecycle:
//   - sessions.ts /:id/events route calls `watchSessionClosure(id, paths)`
//     before subscribing the SSE stream
//   - on `change` event: invalidate LRU cache + broadcast to subscribers
//     of every session that owns this path
//   - when the last SSE subscriber for a session disconnects, route
//     calls `unwatchSession(id)`; paths still owned by other sessions
//     stay watched
//
// Spike scope: only listens for `change` (file modify). New session
// files appearing in the project dir aren't auto-discovered — that's
// for v0.9.1 once we decide whether the workspace scanner subscribes
// to a global "new session" event.
//
// chokidar config:
//   - persistent: true   — keep the event loop alive while watching
//   - ignoreInitial: true — we already have current state via the
//     initial parse; skip the synthetic `add` events on startup
//   - awaitWriteFinish: small stability window so we don't fire mid-
//     write while CC is still flushing a multi-line append. 80 ms is
//     enough headroom without making the live tail feel sluggish.
//   - usePolling: false on Linux — inotify-based watching is reliable
//     on native FS. WSL2 + Windows-mounted /mnt/c paths would need
//     polling, but ~/.claude/projects is on the Linux side, so native
//     watch wins.

import { FSWatcher, watch } from "chokidar";

import { invalidateSession } from "@/server/services/chatFlowCache";
import { broadcast } from "@/server/services/sseHub";

let watcher: FSWatcher | null = null;

// path → set of sessionIds that care about this path
const pathToSessions = new Map<string, Set<string>>();
// sessionId → set of paths it owns (for cleanup)
const sessionToPaths = new Map<string, Set<string>>();

function ensureWatcher(): FSWatcher {
  if (watcher) return watcher;
  watcher = watch([], {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 80,
      pollInterval: 30,
    },
  });
  watcher.on("change", (filePath: string) => {
    const ids = pathToSessions.get(filePath);
    if (!ids || ids.size === 0) return;
    for (const sessionId of ids) {
      invalidateSession(sessionId);
      broadcast(sessionId, {
        event: "invalidate",
        data: { sessionId, reason: "fs-change", path: filePath },
      });
    }
  });
  watcher.on("error", (err) => {
    console.error("[sessionWatcher] chokidar error:", err);
  });
  return watcher;
}

/**
 * Add `paths` to the watch set on behalf of `sessionId`. Idempotent —
 * paths already owned by this session are skipped; paths new to chokidar
 * are added.
 */
export function watchSessionClosure(sessionId: string, paths: string[]): void {
  const w = ensureWatcher();
  let owned = sessionToPaths.get(sessionId);
  if (!owned) {
    owned = new Set();
    sessionToPaths.set(sessionId, owned);
  }
  for (const p of paths) {
    if (owned.has(p)) continue;
    owned.add(p);
    let seen = pathToSessions.get(p);
    if (!seen) {
      seen = new Set();
      pathToSessions.set(p, seen);
      // First subscriber for this path → tell chokidar to watch it.
      w.add(p);
    }
    seen.add(sessionId);
  }
}

/**
 * Drop watches owned by `sessionId`. Paths still referenced by other
 * sessions stay watched; orphaned paths are removed from chokidar.
 */
export function unwatchSession(sessionId: string): void {
  const owned = sessionToPaths.get(sessionId);
  if (!owned) return;
  for (const p of owned) {
    const seen = pathToSessions.get(p);
    if (!seen) continue;
    seen.delete(sessionId);
    if (seen.size === 0) {
      pathToSessions.delete(p);
      watcher?.unwatch(p);
    }
  }
  sessionToPaths.delete(sessionId);
}

/** Test helper: tear down the global watcher + maps. */
export async function _resetForTests(): Promise<void> {
  if (watcher) {
    await watcher.close();
    watcher = null;
  }
  pathToSessions.clear();
  sessionToPaths.clear();
}

/** Test helper: peek state. */
export function _peekStateForTests(): {
  watchedPaths: string[];
  sessions: string[];
} {
  return {
    watchedPaths: [...pathToSessions.keys()],
    sessions: [...sessionToPaths.keys()],
  };
}
