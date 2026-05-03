// v0.6 M3 — unified Node tree layout for the single Canvas.
//
// Replaces the v0.1-v0.5 split between ``layoutDag`` (ChatFlow layer)
// and ``layoutWorkflow`` (drill-down layer). Both source files stay in
// the tree until M5 swaps the canvas consumers; this module is the
// single layout entry point for the M5 ``<Canvas>``.
//
// Inputs:
//   - tree: NodeTree from store ``sessions[sid].nodeTree``
//   - foldedNodeIds / expandedNodeIds: user fold overrides
//   - focusedSubtreeRootId?: optional focus mode anchor (per抉择 2)
//
// Output:
//   - React Flow nodes[] + edges[] for the visible subset
//
// Visibility rules:
//   - A node is "expanded" iff its effective fold state resolves to
//     unfolded. Effective state = defaultFolded XOR override membership:
//       defaultFolded=false + foldedNodeIds.has(id) → folded
//       defaultFolded=true  + expandedNodeIds.has(id) → unfolded
//       otherwise → defaultFolded
//   - A node is "visible" iff every ancestor (up to the layout root) is
//     expanded.
//   - Edges: for each visible node N with parent P, walk P upward
//     through invisible ancestors until hitting a visible node V; the
//     emitted edge is V → N. Folded subtrees collapse onto their
//     visible ancestor — same chrome as v0.5 cards rendered for them.
//   - Focus mode: layout root = the focused subtree root + descendants
//     only. Cross-tree edges to outside-the-focus nodes are dropped.

import dagre from "@dagrejs/dagre";
import type { Edge as RFEdge, Node as RFNode } from "@xyflow/react";

import type { Node, NodeKind, NodeTree } from "@/data/types";

// Per-kind node sizing. Width drives the rendered card's max-w; height
// is a dagre layout hint only (React Flow grows the rendered card to
// fit content). Numbers preserved from v0.5's WF_NODE_SIZE +
// ChatNodeCard's w-52 so the M5 NodeCard renders identical chrome.
export const NODE_SIZE: Record<NodeKind, { width: number; height: number }> = {
  user_message: { width: 208, height: 150 }, // matches legacy ChatNodeCard
  assistant_call: { width: 240, height: 110 }, // matches legacy llm_call
  tool_call: { width: 240, height: 110 },
  delegate: { width: 280, height: 170 },
  compact: { width: 240, height: 100 },
  attachment: { width: 200, height: 80 },
};

export const RANKSEP = 80;
export const NODESEP = 20;

export interface NodeRFData extends Record<string, unknown> {
  node: Node;
  // Visibility hints — drives chrome decisions like the fold +/- icon
  // (visible only when the node has any folded descendants) and the
  // handle dot (visible only when an edge attaches).
  hasIncomingEdge: boolean;
  hasOutgoingEdge: boolean;
  hasFoldedChildren: boolean;
  // True iff at least one user override has been applied to this node.
  // M5 NodeCard uses this to draw the "(folded)" / "(expanded)" hint
  // distinctly from the default state.
  isOverridden: boolean;
}

export type NodeRFNode = RFNode<NodeRFData, NodeKind>;

export interface LayoutNodesResult {
  nodes: NodeRFNode[];
  edges: RFEdge[];
  // Diagnostic counts useful for tests / dev panels — does NOT change
  // ``nodes`` / ``edges`` semantics.
  visibleCount: number;
  hiddenCount: number;
}

export interface LayoutNodesOptions {
  tree: NodeTree;
  foldedNodeIds: Set<string>;
  expandedNodeIds: Set<string>;
  // null = full canvas; non-null = focus subtree at this node.
  focusedSubtreeRootId?: string | null;
}

/**
 * Compute effective fold state for a node — true means "this node's
 * children are hidden".
 */
export function isEffectivelyFolded(
  n: Node,
  foldedNodeIds: Set<string>,
  expandedNodeIds: Set<string>,
): boolean {
  if (n.defaultFolded) {
    return !expandedNodeIds.has(n.id);
  }
  return foldedNodeIds.has(n.id);
}

export function layoutNodes(opts: LayoutNodesOptions): LayoutNodesResult {
  const { tree, foldedNodeIds, expandedNodeIds, focusedSubtreeRootId } = opts;

  // Visibility model. Turn roots (Node.isTurnRoot) are ALWAYS visible
  // outside focus mode — they're the "always-on" skeleton of the
  // canvas and folding inside one turn must not hide siblings or
  // later turns. Cross-bucket parent linking parents turn N's user
  // record under turn (N-1)'s terminal assistant, which is interior
  // and folded by default; without the always-visible carve-out, only
  // the very first turn would render.
  //
  // Inside each turn (= subtree rooted at a turn root, bounded above
  // by the next turn root encountered while descending), regular fold
  // rules apply. Focus mode is a separate filter that further
  // restricts the visible set to nodes inside the focused subtree.
  const focusBoundary = focusedSubtreeRootId
    ? collectSubtreeIds(tree, focusedSubtreeRootId)
    : null;

  const visibleIds = new Set<string>();
  const hasFoldedChildrenById = new Set<string>();
  // Layout roots — what dagre treats as the topmost tier. Focus mode
  // points at exactly one node (the focused root); default mode uses
  // every turn root as a peer-tier root so dagre lays them in the
  // expected left-to-right turn sequence.
  let layoutRootIds: string[];
  if (focusedSubtreeRootId) {
    layoutRootIds = tree.nodes.has(focusedSubtreeRootId) ? [focusedSubtreeRootId] : [];
    // Also seed any turn roots inside the focused subtree as
    // "always-visible" — same rule as default mode but bounded.
  } else {
    layoutRootIds = [];
    for (const n of tree.nodes.values()) {
      if (n.isTurnRoot) layoutRootIds.push(n.id);
    }
  }

  // Pass 1: turn roots inside the layout scope are always visible.
  for (const n of tree.nodes.values()) {
    if (!n.isTurnRoot) continue;
    if (focusBoundary && !focusBoundary.has(n.id)) continue;
    visibleIds.add(n.id);
  }
  // Also seed the focus root (when not itself a turn root — rare; the
  // focus action could target an arbitrary node in v0.6+).
  if (focusedSubtreeRootId && tree.nodes.has(focusedSubtreeRootId)) {
    visibleIds.add(focusedSubtreeRootId);
  }

  // Pass 2: walk each visible node's subtree per fold rules. Stop
  // descending into a different turn root (it's already in visibleIds
  // and has its own subtree expansion to handle).
  const stack: string[] = [...visibleIds];
  while (stack.length) {
    const id = stack.pop()!;
    const node = tree.nodes.get(id);
    if (!node) continue;
    if (focusBoundary && !focusBoundary.has(id)) continue;
    const folded = isEffectivelyFolded(node, foldedNodeIds, expandedNodeIds);
    const children = tree.childrenByParent.get(id) ?? [];
    // Children that are themselves turn roots are already added
    // (always-visible carve-out). They don't count toward the
    // "hasFoldedChildren" hint either — they aren't being folded
    // here, just laid out as their own peer roots.
    const nonTurnChildren = children.filter((cid) => {
      const c = tree.nodes.get(cid);
      return c ? !c.isTurnRoot : false;
    });
    if (folded) {
      if (nonTurnChildren.length > 0) hasFoldedChildrenById.add(id);
      continue;
    }
    for (const cid of nonTurnChildren) {
      if (focusBoundary && !focusBoundary.has(cid)) continue;
      visibleIds.add(cid);
      stack.push(cid);
    }
  }
  void layoutRootIds; // referenced semantically; not fed to dagre directly
  const rootIds = focusedSubtreeRootId
    ? tree.nodes.has(focusedSubtreeRootId)
      ? [focusedSubtreeRootId]
      : []
    : tree.rootNodeIds;

  // Build dagre graph + RF nodes. Per-kind sizing.
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: "LR",
    nodesep: NODESEP,
    ranksep: RANKSEP,
    marginx: 20,
    marginy: 20,
  });

  const incomingEdgeIds = new Set<string>();
  const outgoingEdgeIds = new Set<string>();
  const edgeRecords: Array<{
    id: string;
    source: string;
    target: string;
    kind: "spawn" | "continuation";
    targetModel?: string;
  }> = [];

  // Place visible nodes in the dagre graph.
  for (const id of visibleIds) {
    const n = tree.nodes.get(id);
    if (!n) continue;
    const size = NODE_SIZE[n.kind];
    g.setNode(id, { width: size.width, height: size.height });
  }

  // Compute edges by walking each visible node's parent chain upward
  // until hitting another visible node. In focus mode, edges that exit
  // the focused subtree are skipped (focusBoundary computed earlier).
  for (const id of visibleIds) {
    if (rootIds.includes(id)) continue; // roots have no inbound edge
    const n = tree.nodes.get(id);
    if (!n) continue;
    let parentId = n.parentId;
    while (parentId && !visibleIds.has(parentId)) {
      const p = tree.nodes.get(parentId);
      if (!p) break;
      parentId = p.parentId;
    }
    if (!parentId) continue;
    if (focusBoundary && !focusBoundary.has(parentId)) continue;
    const parent = tree.nodes.get(parentId);
    if (!parent) continue;
    // Edge kind classification: spawn = assistant_call → tool_call/delegate
    // (a tool emitted by an LLM turn); continuation = everything else
    // (turn → next turn, user_message → its assistant, etc.).
    const kind: "spawn" | "continuation" =
      parent.kind === "assistant_call" &&
      (n.kind === "tool_call" || n.kind === "delegate")
        ? "spawn"
        : "continuation";
    const targetModel =
      n.kind === "assistant_call" ? n.model : n.aggregate?.model;
    g.setEdge(parentId, id);
    edgeRecords.push({
      id: `e-${parentId}->${id}`,
      source: parentId,
      target: id,
      kind,
      targetModel,
    });
    incomingEdgeIds.add(id);
    outgoingEdgeIds.add(parentId);
  }

  dagre.layout(g);

  const nodes: NodeRFNode[] = [];
  for (const id of visibleIds) {
    const n = tree.nodes.get(id);
    if (!n) continue;
    const pos = g.node(id);
    const size = NODE_SIZE[n.kind];
    const x = (pos?.x ?? 0) - size.width / 2;
    const y = (pos?.y ?? 0) - size.height / 2;
    const isOverridden =
      foldedNodeIds.has(id) || expandedNodeIds.has(id);
    nodes.push({
      id,
      type: n.kind,
      position: { x, y },
      data: {
        node: n,
        hasIncomingEdge: incomingEdgeIds.has(id),
        hasOutgoingEdge: outgoingEdgeIds.has(id),
        hasFoldedChildren: hasFoldedChildrenById.has(id),
        isOverridden,
      },
    } as NodeRFNode);
  }

  const edges: RFEdge[] = edgeRecords.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: e.kind,
    data: e.targetModel ? { targetModel: e.targetModel } : undefined,
  }));

  // Hidden count = total tree size - visible. Useful for "showing N of M
  // nodes" status indicators, plus a sanity check for tests.
  const hiddenCount = tree.nodes.size - visibleIds.size;

  return {
    nodes,
    edges,
    visibleCount: visibleIds.size,
    hiddenCount,
  };
}

// Walk the subtree rooted at ``rootId`` and return the set of node ids
// it contains. Stops at descendant turn roots (other than the start
// root itself) — cross-bucket parent linking parents the next turn's
// user_message under the previous turn's terminal assistant, so a
// naive walk would leak the next turn (and everything beyond it) into
// the focus boundary.
function collectSubtreeIds(tree: NodeTree, rootId: string): Set<string> {
  const out = new Set<string>();
  const stack: string[] = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    const children = tree.childrenByParent.get(id) ?? [];
    for (const cid of children) {
      const c = tree.nodes.get(cid);
      // Don't descend into another turn root — that's a different
      // "turn" boundary in the unified tree even though it's a
      // tree-descendant via cross-bucket linking.
      if (c?.isTurnRoot && cid !== rootId) continue;
      stack.push(cid);
    }
  }
  return out;
}
