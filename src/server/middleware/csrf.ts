// Mode A CSRF guard: any mutation request (POST/PUT/PATCH/DELETE) must carry
// `X-Loomscope-Token` header matching the server-side token. Browsers can't
// send a custom header on simple cross-origin POSTs without triggering a CORS
// preflight, which our strict same-origin CORS policy rejects — so a hostile
// page on `evil.com` cannot ride a victim's localhost cookies to attack us.
//
// v0.2 has no mutation endpoints yet, but wiring this up now means later
// endpoints inherit the protection by default.

import type { MiddlewareHandler } from "hono";

// EN (v∞.0 PR 1): the CC hook endpoint is server-to-server (CC's
// axios → our localhost), with no browser cookies in play, so CSRF
// doesn't apply. It uses `X-Loomscope-Secret` (LOOMSCOPE_SECRET via
// CC's allowedEnvVars) for auth instead. Skip the CSRF check here so
// CC doesn't need to know about the CSRF token at all — it only
// knows about the secret.
// 中: CC hook 是 server-to-server，没浏览器 cookie 风险，CSRF 不适用；
// hook 自己用 X-Loomscope-Secret 验权。CSRF middleware 直接放过这条路
// 径，CC 端不用关心 CSRF token。
const CSRF_BYPASS_PATHS = new Set(["/api/cc-hook"]);

export function csrfMiddleware(token: string): MiddlewareHandler {
  return async (c, next) => {
    const method = c.req.method.toUpperCase();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      return next();
    }
    if (CSRF_BYPASS_PATHS.has(c.req.path)) {
      return next();
    }
    const provided = c.req.header("x-loomscope-token");
    if (!provided || provided !== token) {
      return c.json({ error: "csrf token missing or invalid" }, 403);
    }
    return next();
  };
}
