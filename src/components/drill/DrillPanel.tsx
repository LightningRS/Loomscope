// v0.6 M6 — drill panel reads from the unified Node tree.
//
// Selection lookup walks the same path as the Canvas: the active tree
// is either the session's main nodeTree or (when drilled into a
// sub-agent) the cached sub-agent's tree. The unified
// ``useIsNodeSelected`` hook (M2) returns true for either
// selectedNodeId or workflowSelectedNodeId, so the panel reflects the
// user's last click whichever layer they were in.
//
// Toggle button on the panel header lets users collapse to a 12px
// strip when they need full canvas width — preferred over hard-hide
// so the strip stays as a re-entry affordance.

import { useCallback, useEffect, useRef, useState } from "react";

import { NodeDetail } from "@/components/drill/NodeDetail";
import { useStore } from "@/store/index";
import type { Node, NodeTree } from "@/data/types";

interface Props {
  sessionId: string;
}

const COLLAPSED_WIDTH = 12;

export function DrillPanel({ sessionId }: Props) {
  const width = useStore((s) => s.drillPanelWidth);
  const collapsed = useStore((s) => s.drillPanelCollapsed);
  const setWidth = useStore((s) => s.setDrillPanelWidth);
  const toggle = useStore((s) => s.toggleDrillPanel);

  const focusedNode = useFocusedNode(sessionId);

  if (collapsed) {
    return <CollapsedStrip width={COLLAPSED_WIDTH} onExpand={toggle} />;
  }

  return (
    <aside
      data-testid="drill-panel"
      className="relative flex h-full flex-col border-l border-gray-200 bg-gray-50"
      style={{ width, minWidth: width, maxWidth: width }}
    >
      <ResizeHandle width={width} setWidth={setWidth} />
      <Header focusedNode={focusedNode} onCollapse={toggle} />
      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {focusedNode ? (
          <NodeDetail node={focusedNode} sessionId={sessionId} />
        ) : (
          <EmptyHint label="点击节点查看详情；右键节点可 Focus subtree" />
        )}
      </div>
    </aside>
  );
}

function Header({
  focusedNode,
  onCollapse,
}: {
  focusedNode: Node | null;
  onCollapse: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-gray-200 bg-white">
      <span className="text-[10px] font-semibold tracking-widest text-gray-500">
        DETAIL
      </span>
      {focusedNode && (
        <span
          className="ml-1 inline-flex items-center gap-1 truncate text-[10px] text-gray-400 font-mono"
          title={focusedNode.id}
          data-testid="drill-panel-breadcrumb"
        >
          <span>↳</span>
          <span className="truncate">
            {focusedNode.kind} {focusedNode.id.slice(0, 8)}
          </span>
        </span>
      )}
      <button
        type="button"
        className="ml-auto flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-200 hover:text-gray-700 transition-colors"
        onClick={onCollapse}
        title="Collapse panel"
        data-testid="drill-panel-collapse"
      >
        ▶
      </button>
    </div>
  );
}

// Resolve the focused node by walking the active tree (main session
// nodeTree, or — when drilled into a sub-agent — the cached
// sub-agent's tree). Selection comes from EITHER selectedNodeId or
// workflowSelectedNodeId since both are dual-written during the v0.6
// transition (M5 still calls setWorkflowSelected when a sub-agent is
// active to keep legacy hooks happy).
function useFocusedNode(sessionId: string): Node | null {
  return useStore((s) => {
    const sess = s.sessions.get(sessionId);
    if (!sess) return null;
    const tree = resolveActiveTree(sess);
    if (!tree) return null;
    const id =
      sess.workflowSelectedNodeId ?? sess.selectedNodeId ?? null;
    if (!id) return null;
    return tree.nodes.get(id) ?? null;
  });
}

function resolveActiveTree(sess: {
  nodeTree: NodeTree | null;
  drillStack?: Array<{ kind: string; parentWorkNodeId?: string; chatNodeId?: string }>;
  subAgentCache: Map<string, { status: string; nodeTree: NodeTree | null }>;
}): NodeTree | null {
  if (!sess.drillStack || sess.drillStack.length === 0) return sess.nodeTree;
  let tree = sess.nodeTree;
  for (const frame of sess.drillStack) {
    if (frame.kind === "chatnode") continue;
    if (!tree || !frame.parentWorkNodeId) return null;
    const delegate = tree.nodes.get(frame.parentWorkNodeId);
    if (!delegate?.agentId) return null;
    const cached = sess.subAgentCache.get(delegate.agentId);
    if (cached?.status !== "ready" || !cached.nodeTree) return null;
    tree = cached.nodeTree;
  }
  return tree;
}

function CollapsedStrip({
  width,
  onExpand,
}: {
  width: number;
  onExpand: () => void;
}) {
  return (
    <button
      type="button"
      className="h-full border-l border-gray-200 bg-gray-100 hover:bg-blue-50 transition-colors flex items-center justify-center text-gray-400 hover:text-blue-600 cursor-pointer"
      style={{ width, minWidth: width }}
      onClick={onExpand}
      title="Expand drill panel"
      data-testid="drill-panel-expand"
    >
      ◀
    </button>
  );
}

function ResizeHandle({
  width,
  setWidth,
}: {
  width: number;
  setWidth: (w: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const startWidth = useRef(width);

  const onMove = useCallback(
    (e: MouseEvent) => {
      // Panel is on the right, so dragging the handle LEFT grows it.
      const dx = startX.current - e.clientX;
      setWidth(startWidth.current + dx);
    },
    [setWidth],
  );

  const onUp = useCallback(() => {
    setDragging(false);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging, onMove, onUp]);

  return (
    <div
      className="absolute left-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-300 transition-colors z-10"
      onMouseDown={(e) => {
        e.preventDefault();
        startX.current = e.clientX;
        startWidth.current = width;
        setDragging(true);
      }}
      data-testid="drill-panel-resize"
    />
  );
}

function EmptyHint({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center text-gray-400 text-[12px]">
      {label}
    </div>
  );
}

// (Legacy WorkNode export dropped — M7 deletes the legacy types.)
