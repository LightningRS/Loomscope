// EN (v∞.0 PR 4): Header chip showing how many of the 11 Loomscope
// hooks are wired into ~/.claude/settings.json. Color-coded so the
// user can tell at a glance whether the v∞.0 push pipe is fully
// active.
//
// Polls `/api/cc-hook-onboarding/status` once on mount + every 30 s
// thereafter, plus listens for a window event the onboarding modal
// fires after a successful patch — that keeps the chip in sync
// without waiting for the next poll.
//
// 中: Header 角落的小标 显示 hook 配置进度（N/11）。绿=全配齐、
// 黄=部分、灰=没配。Onboarding modal 写入成功后会通过 window 事件
// 触发刷新，避免等下次轮询。

import { useEffect, useState } from "react";

export const HOOK_STATUS_REFRESH_EVENT = "loomscope:hook-status-refresh";
const POLL_INTERVAL_MS = 30_000;

interface MinimalHookStatus {
  configured: string[];
  missing: string[];
  malformed?: boolean;
  settingsExists: boolean;
}

export function HookStatusChip() {
  const [status, setStatus] = useState<MinimalHookStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchStatus = async () => {
      try {
        const res = await fetch("/api/cc-hook-onboarding/status");
        if (!res.ok) return;
        const data = (await res.json()) as MinimalHookStatus;
        if (cancelled) return;
        // Guard against malformed payloads — tests run with stub
        // fetch returning `{}`, which lacks `configured`/`missing`.
        // Without these defensives the chip crashes on
        // `status.configured.length`.
        if (!Array.isArray(data?.configured) || !Array.isArray(data?.missing)) {
          return;
        }
        setStatus(data);
      } catch {
        // network flap — keep last known status, don't blank the chip
      }
    };
    void fetchStatus();
    const poll = window.setInterval(() => void fetchStatus(), POLL_INTERVAL_MS);
    const onRefresh = () => void fetchStatus();
    window.addEventListener(HOOK_STATUS_REFRESH_EVENT, onRefresh);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
      window.removeEventListener(HOOK_STATUS_REFRESH_EVENT, onRefresh);
    };
  }, []);

  if (!status) return null;
  const total = status.configured.length + status.missing.length;
  const n = status.configured.length;
  const allGood = !status.malformed && n === total && total > 0;
  const partial = !status.malformed && n > 0 && n < total;

  const tone = status.malformed
    ? "border-rose-300 bg-rose-50 text-rose-800"
    : allGood
      ? "border-emerald-300 bg-emerald-50 text-emerald-800"
      : partial
        ? "border-amber-300 bg-amber-50 text-amber-800"
        : "border-gray-300 bg-gray-50 text-gray-600";

  const icon = status.malformed ? "⚠" : allGood ? "✓" : "🪝";
  const titleText = status.malformed
    ? "settings.json 是无效 JSON，无法读取 hook 配置"
    : `Claude Code hooks 已配置: ${n} / ${total}`;

  return (
    <span
      data-testid="hook-status-chip"
      title={titleText}
      className={[
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-mono",
        tone,
      ].join(" ")}
    >
      <span>{icon}</span>
      <span>
        {n}/{total}
      </span>
    </span>
  );
}
