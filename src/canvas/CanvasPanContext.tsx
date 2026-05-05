// EN: cross-tree pan-and-unfold mediator (v0.8.1 #5 + v0.9.1 polish).
//
// ConversationView (right-panel sibling subtree) asks ChatFlowCanvas
// (under ReactFlowProvider in <main>) to pan to a specific ChatNode
// + unfold any folds hiding it. The two are siblings in App.tsx,
// so we share a stable ref through context.
//
// Mode parameter controls persistence:
//   - "click": user explicitly selected → persistent. Caller doesn't
//     need to do anything on mouseleave; the new viewport / fold
//     state stays.
//   - "hover": transient preview. Returns a `release` callback the
//     caller MUST call on mouseleave to restore the viewport + the
//     fold state to what it was when the hover started. Without
//     release, the preview persists (which would be the same as
//     click — defeating the point).
//
// Click behaviour exists because some flows (BranchSelector,
// keyboard nav) need a non-undoable pan; hover paths use the
// release contract so a stray cursor pass doesn't permanently shift
// the user's view.
//
// 中: ConversationView 跟 ChatFlowCanvas 之间的 pan/unfold 中介。
// hover 模式会返回一个 release 回调，鼠标离开时调它恢复原 viewport
// + fold 状态；click 模式持久不需要 release。这样 hover 是临时预览，
// click 才真切换。

import { createContext, useContext, useRef, type ReactNode } from "react";

/** EN: persistence semantics. `click` = stays applied; `hover` =
 *  caller must invoke the returned release to restore.
 *  中: click 持久；hover 必须调返回的 release 恢复。 */
export type PanMode = "click" | "hover";

/** EN: returned by hover-mode panToChatNode; idempotent — calling
 *  twice is safe and re-restores nothing.
 *  中: hover 模式的 release 回调，幂等可重复调用。 */
export type PanRelease = () => void;

export type PanToChatNodeFn = (
  chatNodeId: string,
  mode?: PanMode,
) => PanRelease | void;

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
  return (chatNodeId: string, mode?: PanMode) => {
    return ctx?.ref.current?.(chatNodeId, mode);
  };
}
