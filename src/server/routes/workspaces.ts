// `/api/workspaces` and `/api/workspaces/:cwdEnc/sessions`.
//
// `cwdEnc` is the URL-encoded real cwd (e.g. `%2Fhome%2Fuser%2FLoomscope`).
// We don't try to reverse-engineer the dash-substituted directory name —
// instead we re-scan and match by cwd, which is unambiguous.

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import { findWorkspaceByCwd, listSessions, scanWorkspaces } from "@/server/services/workspaceScanner";
import {
  ensureWorkspaceWatcher,
  workspacesChannelName,
} from "@/server/services/workspaceWatcher";
import { subscribe, type SseSubscriber } from "@/server/services/sseHub";

export interface WorkspacesRouteOptions {
  rootDir: string;
}

const SSE_HEARTBEAT_MS = 25_000;

export function workspacesRouter(opts: WorkspacesRouteOptions) {
  const app = new Hono();

  app.get("/", async (c) => {
    const items = await scanWorkspaces(opts.rootDir);
    // Strip projectDir from response — internal-only.
    return c.json(
      items.map(({ cwd, sessionCount, lastModified }) => ({
        cwd,
        sessionCount,
        lastModified,
      })),
    );
  });

  // v0.9.1: global SSE channel for workspace-level changes (new
  // sessions appearing, sessions removed). Lazy-starts the watcher
  // on first subscriber. Single connection per browser tab is enough;
  // sidebar refetches workspaces + any expanded session lists when
  // events arrive.
  app.get("/events", async (c) => {
    ensureWorkspaceWatcher(opts.rootDir);
    const channel = workspacesChannelName();
    return streamSSE(c, async (stream) => {
      const sub: SseSubscriber = {
        send: (msg) => {
          void stream
            .writeSSE({
              event: msg.event,
              data: JSON.stringify(msg.data),
            })
            .catch(() => {});
        },
      };
      const unsubscribe = subscribe(channel, sub);
      stream.onAbort(() => unsubscribe());
      await stream.writeSSE({
        event: "hello",
        data: JSON.stringify({ rootDir: opts.rootDir }),
      });
      while (!stream.aborted) {
        await stream.sleep(SSE_HEARTBEAT_MS);
        if (stream.aborted) break;
        await stream
          .writeSSE({ event: "ping", data: "{}" })
          .catch(() => {});
      }
    });
  });

  app.get(
    "/:cwdEnc/sessions",
    zValidator("param", z.object({ cwdEnc: z.string().min(1) })),
    async (c) => {
      const { cwdEnc } = c.req.valid("param");
      let cwd: string;
      try {
        cwd = decodeURIComponent(cwdEnc);
      } catch {
        return c.json({ error: "invalid cwdEnc encoding" }, 400);
      }
      const ws = await findWorkspaceByCwd(opts.rootDir, cwd);
      if (!ws) return c.json({ error: "workspace not found" }, 404);
      const sessions = await listSessions(ws.projectDir);
      return c.json(sessions);
    },
  );

  return app;
}
