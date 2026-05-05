// EN (v∞.0 PR 3): one-time onboarding modal that appears the first
// time we detect missing Loomscope hook entries in
// ~/.claude/settings.json. Two paths:
//
//   1. 一键自动添加 — POST /api/cc-hook-onboarding/patch with mode:
//      "add". Backend's atomic patcher does the merge; we re-fetch
//      status to update the UI. Refuses on malformed settings.json
//      (caller-visible error).
//   2. 复制配置自己加 — render the JSON snippet + shell-rc line so
//      the user pastes manually. Either path needs the LOOMSCOPE_SECRET
//      shell export so CC can substitute it at hook fire time.
//
// Dismiss button writes a localStorage flag so we don't pester the
// user every reload. Settings panel item (PR 3 follow-up, deferred)
// will let the user re-open this modal manually if they change
// their mind.
//
// 中: Loomscope hook 缺失检测的 onboarding modal。两条路径：自动写
// 入 settings.json（atomic patcher）vs 复制 JSON 自己改。Dismiss 写
// localStorage 标记不每次启动都弹。

import { useEffect, useMemo, useState } from "react";

const DISMISS_STORAGE_KEY = "loomscope:hook-onboarding-dismissed";
const STATUS_URL = "/api/cc-hook-onboarding/status";
const PATCH_URL = "/api/cc-hook-onboarding/patch";

interface HookStatus {
  settingsPath: string;
  settingsExists: boolean;
  configured: string[];
  missing: string[];
  malformed?: boolean;
  shellRcSnippet: string;
  pasteableJson: string;
}

export function HookOnboardingModal() {
  const [status, setStatus] = useState<HookStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "secret" | "json">("idle");

  // First-launch check. Skip when user dismissed in a prior session.
  useEffect(() => {
    if (
      typeof localStorage !== "undefined" &&
      localStorage.getItem(DISMISS_STORAGE_KEY) === "true"
    ) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(STATUS_URL);
        if (!res.ok) return;
        const data = (await res.json()) as HookStatus;
        if (cancelled) return;
        setStatus(data);
        if (data.missing.length > 0 || data.malformed) setOpen(true);
      } catch {
        // Network flap on first load — silently skip; user can
        // re-trigger via settings panel later.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = (remember: boolean) => {
    if (remember && typeof localStorage !== "undefined") {
      localStorage.setItem(DISMISS_STORAGE_KEY, "true");
    }
    setOpen(false);
  };

  const autoAdd = async () => {
    setWorking(true);
    setErrorMsg(null);
    try {
      const res = await fetch(PATCH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ mode: "add" }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          status?: HookStatus;
        };
        setErrorMsg(body.error ?? `HTTP ${res.status}`);
        if (body.status) setStatus({ ...status!, ...body.status });
        return;
      }
      const fresh = (await res.json()) as HookStatus;
      setStatus({ ...status!, ...fresh });
      // If everything is in place now, close the modal — but keep
      // dismissed=false in case the user clears localStorage.
      if (fresh.missing.length === 0 && !fresh.malformed) {
        setTimeout(() => setOpen(false), 800);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setWorking(false);
    }
  };

  const copyToClipboard = async (text: string, kind: "secret" | "json") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState(kind);
      setTimeout(() => setCopyState("idle"), 1200);
    } catch {
      // Clipboard permission denied — user can still select-and-copy.
    }
  };

  const progress = useMemo(() => {
    if (!status) return null;
    const total = status.configured.length + status.missing.length;
    return `${status.configured.length} / ${total}`;
  }, [status]);

  if (!open || !status) return null;

  return (
    <div
      data-testid="hook-onboarding-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={() => dismiss(false)}
    >
      <div
        className="w-full max-w-2xl rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-gray-200 px-5 py-3">
          <div className="text-[14px] font-semibold text-gray-800">
            ⚙ Loomscope 需要订阅 Claude Code 事件
          </div>
          <div className="mt-1 text-[12px] text-gray-500">
            已配置: <span className="font-mono">{progress}</span>
            {" · "}
            settings.json: <span className="font-mono">{status.settingsPath}</span>
          </div>
        </div>

        <div className="px-5 py-4 space-y-3 text-[12px] text-gray-700">
          {status.malformed ? (
            <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800">
              ❌ 现有 settings.json 是无效 JSON，Loomscope 拒绝写入。请先手动修复
              文件，再回来点"一键自动添加"。
            </div>
          ) : (
            <>
              <p>
                Loomscope 用 CC 的 settings.json hooks 接收
                <span className="font-mono"> PermissionRequest</span> 等 11 个事件。
                Hook 触发时 CC 会向 <code>/api/cc-hook</code> POST 一次，
                Loomscope 没启动时 CC 静默失败、不影响正常工作。
              </p>
              <p>
                额外需要在 shell rc 里 export <code>LOOMSCOPE_SECRET</code> —
                CC 用 <code>allowedEnvVars</code> 白名单从环境变量取这个 secret 注入
                hook header 防伪造。
              </p>
              <div className="rounded bg-gray-50 px-2 py-1.5 font-mono text-[11px] flex items-center gap-2 break-all">
                <span className="flex-1 select-all">{status.shellRcSnippet}</span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(status.shellRcSnippet, "secret")}
                  className="rounded border border-gray-300 px-1.5 py-0.5 text-[11px] hover:bg-gray-100"
                  data-testid="copy-shell-rc"
                >
                  {copyState === "secret" ? "✓" : "📋"}
                </button>
              </div>
            </>
          )}

          {showAdvanced && (
            <div className="rounded border border-gray-200 bg-gray-50 p-2">
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-[11px] text-gray-700">
                  settings.json hooks 段（拷贝合并到 ~/.claude/settings.json）
                </span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(status.pasteableJson, "json")}
                  className="rounded border border-gray-300 px-1.5 py-0.5 text-[11px] hover:bg-gray-100"
                  data-testid="copy-json"
                >
                  {copyState === "json" ? "✓ 已复制" : "📋 复制"}
                </button>
              </div>
              <pre className="max-h-60 overflow-auto rounded bg-white p-2 text-[10px] font-mono whitespace-pre">
                {status.pasteableJson}
              </pre>
            </div>
          )}

          {errorMsg && (
            <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800">
              ✗ 自动添加失败: {errorMsg}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-3">
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="text-[12px] text-gray-500 hover:text-gray-800"
            data-testid="toggle-advanced"
          >
            {showAdvanced ? "收起手动配置" : "展开手动配置"}
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => dismiss(true)}
            className="rounded border border-gray-300 px-3 py-1.5 text-[12px] hover:bg-gray-100"
            data-testid="dismiss-onboarding"
          >
            暂不开启
          </button>
          <button
            type="button"
            onClick={autoAdd}
            disabled={working || status.malformed}
            className="rounded bg-blue-500 px-3 py-1.5 text-[12px] text-white hover:bg-blue-600 disabled:bg-blue-300"
            data-testid="auto-add-hooks"
          >
            {working ? "添加中…" : "一键自动添加"}
          </button>
        </div>
      </div>
    </div>
  );
}
