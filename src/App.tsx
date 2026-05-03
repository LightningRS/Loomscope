// v0.6 M5: single ``<Canvas>`` replaces the v0.3-v0.5 ChatFlow /
// WorkFlow view branching. Sub-agent drilling stays (drillStack
// continues to govern which NodeTree the canvas resolves) and adds
// orthogonal focus mode (right-click → Focus on subtree) per抉择 2.
//
// Legacy Chat/WorkFlowCanvas are still in src/canvas/ (deleted in M7);
// nothing in App.tsx references them anymore.
//
// Visual chrome per `design-visual-language.md` 视觉 token 章节.

import { useEffect, useMemo } from "react";

import { Canvas } from "@/canvas/Canvas";
import { DrillPanel } from "@/components/drill/DrillPanel";
import { Header } from "@/components/Header";
import { Sidebar } from "@/components/Sidebar";
import { useStore } from "@/store/index";
import {
  resolveDrilledChatNode,
  type DrillBreadcrumbItem,
} from "@/store/sessionSlice";

export default function App() {
  const activeId = useStore((s) => s.activeSessionId);
  const session = useStore((s) => (activeId ? s.sessions.get(activeId) : null));

  useEffect(() => {
    if (activeId && !session) {
      void useStore.getState().loadSession(activeId);
    }
  }, [activeId, session]);

  // M6 still consumes ChatNode/WorkNode types from DrillPanel; keep
  // the legacy resolver running so the right-side panel works during
  // the M5→M6 transition. M6 swaps DrillPanel to read from nodeTree
  // and this becomes a pure breadcrumb data source.
  const drillView = useMemo(() => {
    if (!session || !activeId) return null;
    return resolveDrilledChatNode(session);
  }, [session, activeId]);
  const focusedSubtreeRootId = session?.focusedSubtreeRootId ?? null;

  return (
    <div className="h-screen w-screen flex flex-col bg-gray-50 text-gray-900">
      <Header />
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <main className="flex-1 min-w-0 relative bg-gray-100" data-testid="canvas-host">
          {!activeId && <EmptyState />}
          {activeId && session?.isLoading && <LoadingState />}
          {activeId && session?.error && <ErrorState message={session.error} />}
          {activeId && session?.nodeTree && (
            <>
              <Canvas sessionId={activeId} />
              {(drillView?.frameLabels?.length ?? 0) > 0 || focusedSubtreeRootId ? (
                <UnifiedBreadcrumb
                  sessionId={activeId}
                  drillFrames={drillView?.frameLabels ?? []}
                  focusedSubtreeRootId={focusedSubtreeRootId}
                />
              ) : null}
            </>
          )}
        </main>
        {activeId && session?.chatFlow && (
          <DrillPanel
            sessionId={activeId}
            chatFlow={session.chatFlow}
            viewMode={drillView ? "workflow" : "chatflow"}
            drilledChatNode={drillView?.chatNode ?? null}
          />
        )}
      </div>
    </div>
  );
}

function UnifiedBreadcrumb({
  sessionId,
  drillFrames,
  focusedSubtreeRootId,
}: {
  sessionId: string;
  drillFrames: DrillBreadcrumbItem[];
  focusedSubtreeRootId: string | null;
}) {
  const exitWorkflow = useStore((s) => s.exitWorkflow);
  const exitFocus = useStore((s) => s.exitFocus);
  const truncate = useStore((s) => s.truncateDrillStack);
  return (
    <nav
      data-testid="drill-breadcrumb"
      className="absolute left-3 top-3 z-20 flex flex-wrap items-center gap-1.5 rounded border border-gray-300 bg-white/90 px-2.5 py-1.5 text-xs text-gray-700 shadow-sm max-w-[80%]"
    >
      <button
        type="button"
        onClick={() => {
          exitWorkflow(sessionId);
          exitFocus(sessionId);
        }}
        data-testid="exit-workflow"
        className="hover:text-blue-600 hover:underline transition-colors"
      >
        ← Top
      </button>
      {drillFrames.map((frame, i) => {
        const isLast = i === drillFrames.length - 1 && !focusedSubtreeRootId;
        const truncateTo = i + 1;
        return (
          <span key={i} className="flex items-center gap-1">
            <span className="text-gray-400">/</span>
            {isLast ? (
              <span
                className={[
                  "font-mono text-[11px]",
                  frame.isAutoCompact ? "text-purple-700 font-semibold" : "text-gray-900",
                ].join(" ")}
                title={frame.title}
                data-testid={`drill-breadcrumb-frame-${i}`}
              >
                {frame.label}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => truncate(sessionId, truncateTo)}
                className={[
                  "font-mono text-[11px] hover:text-blue-600 hover:underline transition-colors",
                  frame.isAutoCompact ? "text-purple-700 font-semibold" : "",
                ].join(" ")}
                title={frame.title}
                data-testid={`drill-breadcrumb-frame-${i}`}
              >
                {frame.label}
              </button>
            )}
          </span>
        );
      })}
      {focusedSubtreeRootId && (
        <span className="flex items-center gap-1">
          <span className="text-gray-400">/</span>
          <span
            className="font-mono text-[11px] text-blue-700 font-semibold"
            title={`Focused on subtree ${focusedSubtreeRootId}`}
            data-testid="focus-breadcrumb"
          >
            🎯 focus ({focusedSubtreeRootId.slice(0, 8)})
          </span>
          <button
            type="button"
            onClick={() => exitFocus(sessionId)}
            className="ml-1 text-[10px] text-gray-500 hover:text-blue-600 hover:underline"
            data-testid="exit-focus"
            title="Exit focus mode (ESC also works)"
          >
            ✕
          </button>
        </span>
      )}
    </nav>
  );
}

function EmptyState() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-gray-400">
      <div className="text-5xl opacity-40">⌬</div>
      <div className="text-sm">
        Select a session from the <span className="text-gray-500 font-medium">sidebar</span> to view its ChatFlow.
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-gray-500">
      <span className="inline-flex items-center gap-2 rounded bg-teal-100 px-3 py-1.5 text-sm font-medium text-teal-900">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-teal-500" />
        Parsing JSONL…
      </span>
      <span className="text-[11px] text-gray-400">Large sessions may take a few seconds.</span>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-rose-700">
      <span className="text-3xl">✗</span>
      <span className="text-sm font-medium">Failed to load session.</span>
      <code className="text-[11px] bg-rose-50 border border-rose-200 px-2 py-1 rounded font-mono text-rose-900 max-w-[480px] break-words">
        {message}
      </code>
    </div>
  );
}
