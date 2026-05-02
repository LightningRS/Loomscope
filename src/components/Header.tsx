// Top bar — Loomscope wordmark + active session metadata.
// Visual identity per `design-visual-language.md` 视觉 token 章节:
//   wordmark slate-900 semibold; meta in font-mono gray-500;
//   status chips use saturated palette (teal=loading, rose=error).
// Settings (⚙) / help (❓) icons land in v0.4.

import { useStore } from "@/store/index";

export function Header() {
  const activeId = useStore((s) => s.activeSessionId);
  const session = useStore((s) => (activeId ? s.sessions.get(activeId) : null));
  const cf = session?.chatFlow ?? null;

  return (
    <header
      className="border-b border-gray-200 bg-white flex items-center justify-between px-4"
      style={{ height: 44 }}
      data-testid="header"
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-base font-semibold tracking-tight text-gray-900 flex items-center gap-1.5">
          <span className="text-blue-500">⌬</span>
          Loomscope
        </span>
        {cf ? (
          <span className="text-[11px] text-gray-500 flex items-center gap-3 font-mono min-w-0">
            <span title="cwd" className="inline-flex items-center gap-1 text-gray-700">
              📁 <span className="truncate max-w-[160px]">{cf.cwd ?? "—"}</span>
            </span>
            <span title="git branch" className="inline-flex items-center gap-1">
              <span className="text-blue-500">⌥</span> {cf.gitBranch ?? "—"}
            </span>
            <span title="time range" className="inline-flex items-center gap-1 text-gray-400">
              ⏱ {short(cf.createdAt)} → {short(cf.lastUpdatedAt)}
            </span>
            <span title="path" className="truncate max-w-[260px] text-gray-400">
              {cf.mainJsonlPath}
            </span>
          </span>
        ) : (
          <span className="text-xs text-gray-400">Pick a session →</span>
        )}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {session?.isLoading && (
          <span className="inline-flex items-center gap-1.5 rounded bg-teal-200/80 px-1.5 py-0.5 text-[10px] font-semibold text-teal-900">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-teal-500" />
            loading
          </span>
        )}
        {session?.error && (
          <span
            className="inline-flex items-center gap-1 rounded bg-rose-200/80 px-1.5 py-0.5 text-[10px] font-semibold text-rose-900 max-w-[280px] truncate"
            title={session.error}
          >
            ✗ {session.error}
          </span>
        )}
        {cf && (
          <span className="text-[11px] text-gray-500 font-mono">
            <span className="font-semibold text-gray-700">{cf.chatNodes.length}</span>{" "}
            <span className="text-gray-400">ChatNodes</span>
          </span>
        )}
      </div>
    </header>
  );
}

function short(iso: string | undefined): string {
  if (!iso) return "—";
  return iso.slice(0, 16).replace("T", " ");
}
