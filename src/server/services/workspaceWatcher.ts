// v0.9.1: workspace-level chokidar watcher.
//
// Why separate from sessionWatcher: per-session watcher only sees the
// fork closure (= jsonls of sessions a client has opened SSE on). New
// session jsonls appearing in the projects root wouldn't be seen by
// any per-session subscription. To make the sidebar live-update, we
// watch the projects root globally for `*.jsonl` add / unlink at depth
// 2 (rootDir/<projectSlug>/<sid>.jsonl) and fan out via the sseHub
// channel "workspaces".
//
// Started lazily on first subscriber (workspaces SSE route). Stays
// running once started — projects-root watch is cheap and would
// thrash if we kept toggling it.
//
// Event payload (broadcast via sseHub channel "workspaces"):
//   { event: "workspace-changed", data: { reason: "add"|"remove",
//       sessionId, projectDir, path } }
//
// Excluded from depth/visibility:
//   - depth-1 dirs themselves (project slugs) — not jsonls, ignored
//   - depth>2 paths (sidecar subagents, tool-results) — handled by
//     per-session sessionWatcher; keeping depths separate avoids
//     double-firing on sidecar jsonl events
//
// chokidar config mirrors sessionWatcher (awaitWriteFinish 80 ms,
// ignoreInitial). usePolling false on Linux native FS.

import * as path from "node:path";

import { FSWatcher, watch } from "chokidar";

import { broadcast } from "@/server/services/sseHub";

const WORKSPACES_CHANNEL = "workspaces";

let watcher: FSWatcher | null = null;
let watchedRoot: string | null = null;

function classify(
  rootDir: string,
  filePath: string,
): { sessionId: string; projectDir: string } | null {
  const rel = path.relative(rootDir, filePath);
  if (rel.startsWith("..")) return null;
  const parts = rel.split(path.sep);
  // We want exactly rootDir/<projectSlug>/<sid>.jsonl (2 segments).
  // Anything deeper (sidecar dirs, tool-results) is sessionWatcher
  // territory.
  if (parts.length !== 2) return null;
  const filename = parts[1];
  if (!filename.endsWith(".jsonl")) return null;
  const sessionId = filename.slice(0, -".jsonl".length);
  // CC sessionIds are uuid-shaped; cheap sanity check skips anything
  // odd (e.g., editor swap files) so we don't broadcast garbage.
  if (!/^[a-f0-9-]{8,}$/i.test(sessionId)) return null;
  return {
    sessionId,
    projectDir: path.join(rootDir, parts[0]),
  };
}

/**
 * Idempotent start. First call kicks off chokidar; subsequent calls
 * with the same rootDir are no-ops. Calling with a DIFFERENT rootDir
 * swaps the watcher (only matters in tests / multi-instance setups).
 */
export function ensureWorkspaceWatcher(rootDir: string): void {
  if (watcher && watchedRoot === rootDir) return;
  if (watcher) {
    void watcher.close();
    watcher = null;
  }
  watchedRoot = rootDir;
  // depth: 2 → rootDir (depth 0) + projectSlug dirs (depth 1) + jsonl
  // files (depth 2). Higher-depth files are filtered by `classify`
  // anyway, but capping depth saves chokidar a bunch of inotify
  // watches on sidecar trees we don't care about here.
  watcher = watch(rootDir, {
    persistent: true,
    ignoreInitial: true,
    depth: 2,
    awaitWriteFinish: {
      stabilityThreshold: 80,
      pollInterval: 30,
    },
  });
  watcher.on("add", (filePath: string) => {
    const hit = classify(rootDir, filePath);
    if (!hit) return;
    broadcast(WORKSPACES_CHANNEL, {
      event: "workspace-changed",
      data: {
        reason: "add",
        sessionId: hit.sessionId,
        projectDir: hit.projectDir,
        path: filePath,
      },
    });
  });
  watcher.on("unlink", (filePath: string) => {
    const hit = classify(rootDir, filePath);
    if (!hit) return;
    broadcast(WORKSPACES_CHANNEL, {
      event: "workspace-changed",
      data: {
        reason: "remove",
        sessionId: hit.sessionId,
        projectDir: hit.projectDir,
        path: filePath,
      },
    });
  });
  watcher.on("error", (err) => {
    console.error("[workspaceWatcher] chokidar error:", err);
  });
}

export function workspacesChannelName(): string {
  return WORKSPACES_CHANNEL;
}

/** Test helper. */
export async function _resetForTests(): Promise<void> {
  if (watcher) {
    await watcher.close();
    watcher = null;
  }
  watchedRoot = null;
}
