// v0.2 layout: header above, sidebar left, canvas filling remaining area.
// Visual chrome per `design-visual-language.md` 视觉 token 章节.

import { useEffect } from "react";

import { ChatFlowCanvas } from "@/canvas/ChatFlowCanvas";
import { Header } from "@/components/Header";
import { Sidebar } from "@/components/Sidebar";
import { useStore } from "@/store/index";

export default function App() {
  const activeId = useStore((s) => s.activeSessionId);
  const session = useStore((s) => (activeId ? s.sessions.get(activeId) : null));

  useEffect(() => {
    if (activeId && !session) {
      void useStore.getState().loadSession(activeId);
    }
  }, [activeId, session]);

  return (
    <div className="h-screen w-screen flex flex-col bg-gray-50 text-gray-900">
      <Header />
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <main className="flex-1 min-w-0 relative bg-gray-100" data-testid="canvas-host">
          {!activeId && <EmptyState />}
          {activeId && session?.isLoading && <LoadingState />}
          {activeId && session?.error && <ErrorState message={session.error} />}
          {activeId && session?.chatFlow && (
            <ChatFlowCanvas chatFlow={session.chatFlow} sessionId={activeId} />
          )}
        </main>
      </div>
    </div>
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
