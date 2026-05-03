// v0.6 M5 — single Canvas component, replaces ChatFlowCanvas +
// WorkFlowCanvas.
//
// Reads the unified ``nodeTree`` from the store, runs ``layoutNodes``
// to compute visible nodes/edges from fold + focus state, and renders
// via the single ``<NodeCard>`` component (M4).
//
// Sub-agent drilling (v0.5) coexists with focus mode (v0.6 抉择 2):
//   - drillStack (v0.3-v0.5 cross-tree navigation): if a subworkflow
//     frame is on top, the canvas renders the cached sub-agent's
//     nodeTree instead of the main session's.
//   - focusedSubtreeRootId (v0.6 intra-tree filter): orthogonal to
//     drilling — narrows the visible set within whichever tree is
//     currently rendered.
//
// Interactions:
//   - single click on node    → setSelected (or setWorkflowSelected
//                                 inside a sub-agent drill, to keep
//                                 the v0.5 selectionHooks dual-write
//                                 contract during the M2-M5 transition)
//   - double-click on delegate → enterSubWorkflow (v0.5 behavior)
//   - double-click on others   → toggleFold (v0.6 behavior)
//   - right-click             → CanvasContextMenu with Focus / Copy id
//
// Legacy ChatFlowCanvas / WorkFlowCanvas stay in the tree until M7
// for safety; this Canvas is the new mount point for App.tsx.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore as useReactFlowStore,
  type EdgeTypes,
  type NodeTypes,
  type ReactFlowState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { ContinuationArrowDefs, ContinuationEdge } from "@/canvas/edges/ContinuationEdge";
import { SpawnArrowDefs, SpawnEdge } from "@/canvas/edges/SpawnEdge";
import { layoutNodes } from "@/canvas/layoutNodes";
import { NodeCard } from "@/canvas/nodes/NodeCard";
import { CanvasContextMenu } from "@/canvas/CanvasContextMenu";
import type { Node, NodeTree } from "@/data/types";
import { useStore } from "@/store/index";

const nodeTypes: NodeTypes = {
  user_message: NodeCard,
  assistant_call: NodeCard,
  tool_call: NodeCard,
  delegate: NodeCard,
  compact: NodeCard,
  attachment: NodeCard,
};

const edgeTypes: EdgeTypes = {
  continuation: ContinuationEdge,
  spawn: SpawnEdge,
};

export interface CanvasProps {
  sessionId: string;
}

export function Canvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <svg width={0} height={0} style={{ position: "absolute" }}>
        <ContinuationArrowDefs />
        <SpawnArrowDefs />
      </svg>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function CanvasInner({ sessionId }: CanvasProps) {
  // Resolve which NodeTree is active: main session, or — when a
  // sub-agent drill frame is on top of drillStack — the cached
  // sub-agent's nodeTree.
  const session = useStore((s) => s.sessions.get(sessionId));
  const activeTree = useResolvedTree(sessionId);
  const foldedNodeIds = session?.foldedNodeIds ?? EMPTY_SET;
  const expandedNodeIds = session?.expandedNodeIds ?? EMPTY_SET;
  const focusedSubtreeRootId = session?.focusedSubtreeRootId ?? null;

  const layout = useMemo(() => {
    if (!activeTree) return { nodes: [], edges: [], visibleCount: 0, hiddenCount: 0 };
    return layoutNodes({
      tree: activeTree,
      foldedNodeIds,
      expandedNodeIds,
      focusedSubtreeRootId,
    });
  }, [activeTree, foldedNodeIds, expandedNodeIds, focusedSubtreeRootId]);

  // Selection: per-card hook (useIsNodeSelected) reads BOTH
  // selectedNodeId and workflowSelectedNodeId. We need to pick which
  // setter to call based on whether we're in a sub-agent drill frame
  // (= keep the v0.5 dual-write going so DrillPanel + legacy hooks
  // continue to work).
  const setSelected = useStore((s) => s.setSelected);
  const setWorkflowSelected = useStore((s) => s.setWorkflowSelected);
  const isInsideSubAgent =
    (session?.drillStack?.[session.drillStack.length - 1]?.kind ?? null) ===
    "subworkflow";

  const onNodeClick = useCallback(
    (_e: unknown, node: { id: string }) => {
      if (isInsideSubAgent) {
        setWorkflowSelected(sessionId, node.id);
      } else {
        setSelected(sessionId, node.id);
      }
    },
    [isInsideSubAgent, sessionId, setSelected, setWorkflowSelected],
  );

  const enterSubWorkflow = useStore((s) => s.enterSubWorkflow);
  const toggleFold = useStore((s) => s.toggleFold);

  const onNodeDoubleClick = useCallback(
    (_e: unknown, node: { id: string; type?: string }) => {
      // delegate dblclick = drill into sub-agent (preserve v0.5).
      // Other kinds = toggleFold per抉择 1 选项 A.
      if (node.type === "delegate") {
        enterSubWorkflow(sessionId, node.id);
        return;
      }
      toggleFold(sessionId, node.id);
    },
    [enterSubWorkflow, toggleFold, sessionId],
  );

  // Right-click → context menu. Only for nodes; pane-context skip.
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    nodeId: string;
  } | null>(null);
  const enterFocus = useStore((s) => s.enterFocus);
  const onNodeContextMenu = useCallback(
    (event: { preventDefault: () => void; clientX: number; clientY: number }, node: { id: string }) => {
      event.preventDefault();
      setCtxMenu({ x: event.clientX, y: event.clientY, nodeId: node.id });
    },
    [],
  );
  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);
  const onContextFocus = useCallback(
    (id: string) => enterFocus(sessionId, id),
    [enterFocus, sessionId],
  );

  // FitView on tree-id change (= entered a different sub-agent / popped
  // the drill stack / changed sessions). Re-fit only on tree.id swap so
  // user's pan/zoom inside one tree isn't yanked by every fold action.
  const rf = useReactFlow();
  const firstNodeId = layout.nodes.length > 0 ? layout.nodes[0].id : null;
  const firstNodeMeasured = useReactFlowStore((s: ReactFlowState) => {
    if (!firstNodeId) return false;
    const n = s.nodeLookup.get(firstNodeId);
    return n?.measured.width !== undefined && n?.measured.height !== undefined;
  });
  const fittedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeTree) return;
    if (!firstNodeMeasured) return;
    const treeKey = `${activeTree.id}|focus:${focusedSubtreeRootId ?? ""}`;
    if (fittedRef.current === treeKey) return;
    rf.fitView({ padding: 0.2, maxZoom: 1.0, minZoom: 0.05, duration: 0 });
    fittedRef.current = treeKey;
  }, [activeTree, firstNodeMeasured, focusedSubtreeRootId, rf]);

  if (!activeTree) {
    return (
      <div
        data-testid="canvas-empty"
        className="absolute inset-0 flex flex-col items-center justify-center text-gray-400"
      >
        <span className="text-3xl opacity-40">⌬</span>
        <div className="text-sm mt-2">No session loaded</div>
      </div>
    );
  }
  if (layout.nodes.length === 0) {
    return (
      <div
        data-testid="canvas-empty"
        className="absolute inset-0 flex flex-col items-center justify-center text-gray-400"
      >
        <span className="text-3xl opacity-40">⌬</span>
        <div className="text-sm mt-2">该视图没有可见节点</div>
        <div className="text-[11px] text-gray-300 mt-1">
          (focus root invalid / 全部折叠)
        </div>
      </div>
    );
  }

  return (
    <>
      <ReactFlow
        data-testid="canvas"
        nodes={layout.nodes}
        edges={layout.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeContextMenu={onNodeContextMenu}
        minZoom={0.05}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesReconnectable={false}
        elementsSelectable={true}
        deleteKeyCode={null}
        panOnDrag={true}
      >
        <Background gap={24} size={1} color="#d1d5db" />
        <Controls
          position="bottom-left"
          showInteractive={false}
          className="!shadow-md !border !border-gray-200"
        />
      </ReactFlow>
      {ctxMenu && (
        <CanvasContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          nodeId={ctxMenu.nodeId}
          onFocus={onContextFocus}
          onClose={closeCtxMenu}
        />
      )}
    </>
  );
}

const EMPTY_SET = new Set<string>();

// Resolve the active NodeTree for a session. When a subworkflow frame
// is on top of the drill stack, the active tree is the cached
// sub-agent's nodeTree (possibly nested via further subworkflow frames).
// Otherwise it's the session's main nodeTree.
function useResolvedTree(sessionId: string): NodeTree | null {
  return useStore((s) => {
    const sess = s.sessions.get(sessionId);
    if (!sess) return null;
    if (!sess.drillStack || sess.drillStack.length === 0) return sess.nodeTree;
    // Walk drill stack — for each subworkflow frame, find the delegate
    // Node it references and pull the cached sub-agent tree.
    let tree = sess.nodeTree;
    for (const frame of sess.drillStack) {
      if (frame.kind === "chatnode") continue;
      // subworkflow: find the delegate node in the current tree, look
      // up its agentId, fetch the cached sub-agent's tree.
      if (!tree) return null;
      const delegate = findDelegate(tree, frame.parentWorkNodeId);
      if (!delegate?.agentId) return null;
      const cached = sess.subAgentCache.get(delegate.agentId);
      if (cached?.status !== "ready" || !cached.nodeTree) return null;
      tree = cached.nodeTree;
    }
    return tree;
  });
}

function findDelegate(tree: NodeTree, parentWorkNodeId: string): Node | null {
  const n = tree.nodes.get(parentWorkNodeId);
  if (n?.kind === "delegate") return n;
  return null;
}
