// EN: v0.9.1 cross-tree scroll mediator (canvas → conversation).
// Mirror of `CanvasPanContext` but in the reverse direction —
// ChatFlowCanvas (left, on hover/click of a ChatNodeCard) asks
// ConversationView (right panel sibling) to scroll the matching
// bubble into view. Same ref-pattern: App owns the ref,
// ConversationView registers its impl on mount, callers from inside
// ChatFlowCanvas read the ref via the shim hook.
//
// 中: v0.9.1 跨子树的反向滚动 mediator（canvas → conversation）。
// `CanvasPanContext` 的镜像：ChatFlowCanvas（hover/click ChatNode
// 卡片）需要让 ConversationView（右边面板兄弟节点）滚到对应 bubble。
// App 拿 ref，ConversationView 挂载时注册具体实现，ChatFlowCanvas
// 通过 shim hook 在事件触发时读取最新 ref。
//
// Why a ref instead of a plain context value: the scroll impl uses
// ConversationView-local state (containerRef, the rendered
// startIdx slice) and would close over stale data if injected as
// a plain value at render time. The mutable ref lets the always-
// current implementation be reachable without re-rendering all
// canvas cards every time the conversation slice shifts.

import { createContext, useContext, useRef, type ReactNode } from "react";

export type ScrollToChatNodeFn = (
  chatNodeId: string,
  opts?: { smooth?: boolean },
) => void;

export interface ConversationScrollAPI {
  ref: { current: ScrollToChatNodeFn | null };
}

export const ConversationScrollContext =
  createContext<ConversationScrollAPI | null>(null);

export function ConversationScrollProvider({
  children,
}: {
  children: ReactNode;
}) {
  const ref = useRef<ScrollToChatNodeFn | null>(null);
  return (
    <ConversationScrollContext.Provider value={{ ref }}>
      {children}
    </ConversationScrollContext.Provider>
  );
}

/** Stable shim that defers to the live scroll function. Read it
 *  once at component mount; `.current` is checked at fire time so
 *  late-mounted ConversationView still receives calls. */
export function useConversationScrollShim(): ScrollToChatNodeFn {
  const ctx = useContext(ConversationScrollContext);
  return (id, opts) => {
    ctx?.ref.current?.(id, opts);
  };
}
