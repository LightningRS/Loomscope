// Entry binary — boots the listener. Wired into `npm run dev:server` and
// (eventually) the published `loomscope-server` bin.

import * as crypto from "node:crypto";

import { serve } from "@hono/node-server";

import { createApp, parseArgs } from "@/server/index";
import { getOrCreateSecret } from "@/server/services/loomscopeSecret";

async function main(): Promise<void> {
  // Drop the `node`/`tsx` and script paths — commander expects the user
  // arg list when called with `from: 'user'`.
  const cli = parseArgs(process.argv.slice(2));
  const csrfToken = process.env.LOOMSCOPE_CSRF_TOKEN ?? crypto.randomBytes(24).toString("hex");
  const allowedOrigin =
    process.env.LOOMSCOPE_ALLOWED_ORIGIN ?? `http://localhost:${cli.port}`;

  // v∞.0 PR 1: load (or generate-and-persist) the per-installation
  // hook secret. CC's settings.json template references it via
  // `$LOOMSCOPE_SECRET` (substituted from the user's shell env at
  // hook fire time); onboarding (PR 3) walks the user through both
  // setup steps. Failing to read/write is non-fatal — see service
  // for graceful-degradation semantics.
  const hookSecret = await getOrCreateSecret();

  const app = createApp({
    rootDir: cli.rootDir,
    csrfToken,
    allowedOrigin,
    hookSecret,
  });

  serve({ fetch: app.fetch, port: cli.port, hostname: cli.bind }, (info) => {
    console.log(
      `[loomscope] backend listening at http://${info.address}:${info.port}  (rootDir=${cli.rootDir})`,
    );
  });
}

void main();
