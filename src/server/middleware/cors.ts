// Strict same-origin CORS for Mode A. Allow only the configured origin;
// production single-process serve has frontend + API on the same port
// so same-origin GET fetches carry no Origin and pass through, and
// same-origin POSTs carry Origin = backend port and match.
//
// In dev the layout is split: Vite at 5175 (frontend) → proxies to
// Hono at 5174 (backend). Vite's `changeOrigin: true` rewrites the
// `Host` header to the upstream but does NOT rewrite `Origin` — so a
// browser POST from 5175 reaches Hono with `Origin: localhost:5175`
// while the backend port is 5174. To support that without weakening
// production, `allowedOrigin` accepts a comma-separated list. Caller
// (cli.ts dev script) sets both 5174 and 5175.
//
// We deliberately avoid Hono's `cors` middleware to keep behavior
// auditable.
//
// 中: Mode A 严格同源 CORS。生产单进程同端口；dev 拆 5174+5175，Vite
// changeOrigin 只改 Host 不改 Origin，所以 allowedOrigin 接受逗号分
// 隔列表，dev:server 同时塞两个端口。

import type { MiddlewareHandler } from "hono";

export function corsMiddleware(allowedOrigin: string): MiddlewareHandler {
  // Pre-split + trim so the per-request comparison is a Set lookup.
  // Empty entries (trailing comma) silently dropped.
  const allowed = new Set(
    allowedOrigin
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
  // For the response header we echo back the matched Origin (per the
  // spec; multiple origins can't all be advertised in one
  // Access-Control-Allow-Origin value). Pick the first entry as the
  // fallback when the response writes before the request comparison
  // (shouldn't happen in practice).
  const fallback = [...allowed][0] ?? allowedOrigin;
  return async (c, next) => {
    const origin = c.req.header("origin");
    if (!origin) return next(); // same-origin requests don't carry Origin
    if (!allowed.has(origin)) {
      return c.json({ error: "cors: origin not allowed" }, 403);
    }
    c.header("Access-Control-Allow-Origin", origin || fallback);
    c.header("Access-Control-Allow-Headers", "Content-Type, X-Loomscope-Token");
    c.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    c.header("Vary", "Origin");
    if (c.req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: c.res.headers });
    }
    return next();
  };
}
