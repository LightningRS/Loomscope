// First-launch banner that appears when ~/.claude/settings.json is
// missing Loomscope hook entries. v0.11 simplified: this modal no
// longer patches anything itself — it only redirects the user to
// Settings → Hooks tab via a window event, where they can pick exactly
// which hooks to enable (per-event checkboxes), copy the manual JSON,
// or rotate the secret. Single source of truth for hook config = the
// Settings panel.
//
// Dismiss button still writes a localStorage flag so we don't pester
// the user on every reload; clearing localStorage re-arms the banner.

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

const DISMISS_STORAGE_KEY = "loomscope:hook-onboarding-dismissed";
const STATUS_URL = "/api/cc-hook-onboarding/status";

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
  const { t } = useTranslation();
  const [status, setStatus] = useState<HookStatus | null>(null);
  const [open, setOpen] = useState(false);

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
        // Guard against malformed payloads (test env stub returns
        // `{}` without configured/missing arrays).
        if (!Array.isArray(data?.configured) || !Array.isArray(data?.missing)) {
          return;
        }
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

  const openSettings = () => {
    window.dispatchEvent(new CustomEvent("loomscope:open-settings"));
    // Don't write the dismissed flag — the user is acting, not
    // brushing it off; if they close Settings without configuring,
    // the next reload will surface this banner again as a reminder.
    setOpen(false);
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
        className="w-full max-w-xl rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-gray-200 px-5 py-3">
          <div className="text-[14px] font-semibold text-gray-800">
            ⚙ {t("hook_onboarding.title")}
          </div>
          <div className="mt-1 text-[12px] text-gray-500">
            {t("hook_onboarding.progress_label")}{" "}
            <span className="font-mono">{progress}</span>
            {" · "}
            settings.json:{" "}
            <span className="font-mono">{status.settingsPath}</span>
          </div>
        </div>

        <div className="px-5 py-4 space-y-3 text-[12px] text-gray-700">
          {status.malformed ? (
            <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800">
              ❌ {t("hook_onboarding.malformed")}
            </div>
          ) : (
            <p>{t("hook_onboarding.body")}</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-3">
          <button
            type="button"
            onClick={() => dismiss(true)}
            className="rounded border border-gray-300 px-3 py-1.5 text-[12px] hover:bg-gray-100"
            data-testid="dismiss-onboarding"
          >
            {t("hook_onboarding.btn_dismiss")}
          </button>
          <button
            type="button"
            onClick={openSettings}
            className="rounded bg-blue-500 px-3 py-1.5 text-[12px] text-white hover:bg-blue-600"
            data-testid="open-settings-from-onboarding"
          >
            {t("hook_onboarding.btn_open_settings")}
          </button>
        </div>
      </div>
    </div>
  );
}
