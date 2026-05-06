// EN: cross-tree pan mediator for the WorkFlow canvas (PR 2 dual-track
// navigation). The right-side DrillPanel (sibling subtree) needs to
// pan/centre WorkFlowCanvas (under its own ReactFlowProvider) on a
// specific WorkNode without leaving the WorkFlow drill view. Mirrors
// CanvasPanContext but simplified — only one mode (no hover/release):
// the "在画布定位" button is always a persistent move.
//
// 中: WorkFlow canvas 跨子树 pan 中介。右侧 DrillPanel 通过它请求
// WorkFlowCanvas 居中到指定 WorkNode（"在画布定位"按钮）。比
// CanvasPanContext 简单 —— 只有 click 模式，无 hover / release。

import { createContext, useContext, useRef, type ReactNode } from "react";

export type PanToWorkNodeFn = (workNodeId: string) => void;

export interface WorkFlowPanAPI {
  ref: { current: PanToWorkNodeFn | null };
}

export const WorkFlowPanContext = createContext<WorkFlowPanAPI | null>(null);

export function WorkFlowPanProvider({ children }: { children: ReactNode }) {
  const ref = useRef<PanToWorkNodeFn | null>(null);
  return (
    <WorkFlowPanContext.Provider value={{ ref }}>
      {children}
    </WorkFlowPanContext.Provider>
  );
}

/** Returns a stable shim that defers to the live pan function. Use
 *  this from event handlers — `useWorkFlowPan()` would capture the
 *  function at hook-execution time, which can be stale. */
export function useWorkFlowPanShim(): PanToWorkNodeFn {
  const ctx = useContext(WorkFlowPanContext);
  return (workNodeId: string) => {
    ctx?.ref.current?.(workNodeId);
  };
}
