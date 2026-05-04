// v0.8.1 #5: cross-tree pan-and-unfold mediator.
//
// ConversationView (right-panel sibling subtree) needs to ask
// ChatFlowCanvas (under ReactFlowProvider in <main>) to pan to a
// specific ChatNode + unfold any folds hiding it. The two are
// siblings in App.tsx, so we share a stable ref through context: App
// owns the ref, CanvasInner registers its impl on mount, hover
// callers in ConversationView read the ref via the hook.
//
// Why a ref-shaped registration and not a plain context value: the
// pan impl needs `useReactFlow()` which only resolves under
// ReactFlowProvider (= inside ChatFlowCanvas). We can't lift it to
// App. The ref pattern lets App stay above ReactFlowProvider while
// still threading a stable callable down to ConversationView.
//
// The registration is per-mount; sub-ChatFlow drill remounts the
// canvas (different ReactFlowProvider tree) which re-registers,
// over-writing the previous handler. ConversationView always sees
// the freshest handler.

import { createContext, useContext, useRef, type ReactNode } from "react";

export type PanToChatNodeFn = (chatNodeId: string) => void;

export interface CanvasPanAPI {
  // Mutable holder. CanvasInner sets `.current` on mount, clears on
  // unmount; ConversationView reads `.current` at fire time.
  ref: { current: PanToChatNodeFn | null };
}

export const CanvasPanContext = createContext<CanvasPanAPI | null>(null);

export function CanvasPanProvider({ children }: { children: ReactNode }) {
  const ref = useRef<PanToChatNodeFn | null>(null);
  return (
    <CanvasPanContext.Provider value={{ ref }}>
      {children}
    </CanvasPanContext.Provider>
  );
}

/** Returns the live pan function, or null when no canvas is mounted. */
export function useCanvasPan(): PanToChatNodeFn | null {
  const ctx = useContext(CanvasPanContext);
  return ctx?.ref.current ?? null;
}

/** Returns a stable shim that defers to the live pan function. Use
 *  this from event handlers — `useCanvasPan()` returns at the time of
 *  hook execution, which can be stale when fired from a setTimeout. */
export function useCanvasPanShim(): PanToChatNodeFn {
  const ctx = useContext(CanvasPanContext);
  return (chatNodeId: string) => {
    ctx?.ref.current?.(chatNodeId);
  };
}
