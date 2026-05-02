// Click-to-copy utility — modern clipboard API + execCommand fallback +
// surfaces failure reason. Used by ChatNodeCard NodeIdLine and Header
// session id button.

export type CopyResult = { ok: true } | { ok: false; reason: string };

export async function copyToClipboardWithFallback(text: string): Promise<CopyResult> {
  // Modern API — works in secure context (https / localhost / file://).
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return { ok: true };
    } catch {
      // Permission denied or transient — fall through to fallback.
    }
  }

  // Legacy fallback: hidden textarea + execCommand. Works in plain HTTP
  // contexts and older browsers.
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.opacity = "0";
    ta.style.pointerEvents = "none";
    ta.setAttribute("readonly", "");
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    if (ok) return { ok: true };
    return { ok: false, reason: "execCommand 拒绝复制（浏览器策略）" };
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "剪贴板 API 不可用",
    };
  }
}
