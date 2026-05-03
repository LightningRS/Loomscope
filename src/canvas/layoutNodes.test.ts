// v0.6 M3 — layoutNodes tests.
//
// Coverage:
//   - default fold (no overrides) shows all turn roots + folds interiors
//   - expanding a turn root reveals its assistant_call / tool_call children
//   - folding a default-unfolded node hides its children
//   - mutually-exclusive overrides take precedence over defaults
//   - edge collapse: when a parent is folded, edges from outside the
//     folded subtree route to the folded ancestor
//   - edge kind classification: spawn vs continuation
//   - focus mode renders only the focused subtree; cross-focus edges drop
//   - hasFoldedChildren flag set on nodes with hidden children
//   - hidden / visible counts add up to total

import { describe, expect, it } from "vitest";

import { layoutNodes, isEffectivelyFolded, NODE_SIZE } from "@/canvas/layoutNodes";
import { buildNodeTree } from "@/parse/nodeTree";
import {
  buildSyntheticRecords,
  fixtureUuids,
} from "@/parse/__fixtures__/synthetic/build-fixture";

function fixtureTree() {
  return buildNodeTree(buildSyntheticRecords(), "/synthetic/main.jsonl");
}

describe("isEffectivelyFolded", () => {
  it("respects defaultFolded when no override is set (every kind defaults to children-hidden per抉择 1 A)", () => {
    const tree = fixtureTree();
    const userMsg = tree.nodes.get(fixtureUuids.u1)!;
    const llm = tree.nodes.get(fixtureUuids.a1)!;
    expect(isEffectivelyFolded(userMsg, new Set(), new Set())).toBe(true);
    expect(isEffectivelyFolded(llm, new Set(), new Set())).toBe(true);
  });

  it("expandedNodeIds override flips a default-folded node to unfolded", () => {
    const tree = fixtureTree();
    const llm = tree.nodes.get(fixtureUuids.a1)!;
    expect(
      isEffectivelyFolded(llm, new Set(), new Set([fixtureUuids.a1])),
    ).toBe(false);
  });
});

describe("layoutNodes — default render (no overrides)", () => {
  it("renders all turn roots, hides all interior nodes", () => {
    const tree = fixtureTree();
    const result = layoutNodes({
      tree,
      foldedNodeIds: new Set(),
      expandedNodeIds: new Set(),
    });
    // 6 turn roots in synthetic fixture (p1..p6).
    const turnRootIds = new Set(
      [...tree.nodes.values()].filter((n) => n.isTurnRoot).map((n) => n.id),
    );
    const renderedIds = new Set(result.nodes.map((n) => n.id));
    for (const id of turnRootIds) {
      expect(renderedIds.has(id)).toBe(true);
    }
    // No assistant_call / tool_call should render at default state.
    for (const n of tree.nodes.values()) {
      if (n.kind === "assistant_call" || n.kind === "tool_call") {
        expect(renderedIds.has(n.id)).toBe(false);
      }
    }
  });

  it("hidden + visible == total", () => {
    const tree = fixtureTree();
    const result = layoutNodes({
      tree,
      foldedNodeIds: new Set(),
      expandedNodeIds: new Set(),
    });
    expect(result.visibleCount + result.hiddenCount).toBe(tree.nodes.size);
  });

  it("turn roots that have any children get hasFoldedChildren=true", () => {
    const tree = fixtureTree();
    const result = layoutNodes({
      tree,
      foldedNodeIds: new Set(),
      expandedNodeIds: new Set(),
    });
    const p1 = result.nodes.find((n) => n.id === fixtureUuids.u1)!;
    expect(p1.data.hasFoldedChildren).toBe(true);
  });
});

describe("layoutNodes — expanding a turn root", () => {
  it("reveals the turn root's immediate assistant_call children", () => {
    const tree = fixtureTree();
    const result = layoutNodes({
      tree,
      foldedNodeIds: new Set(),
      expandedNodeIds: new Set([fixtureUuids.u1]),
    });
    const renderedIds = new Set(result.nodes.map((n) => n.id));
    expect(renderedIds.has(fixtureUuids.a1)).toBe(true); // p1's first assistant
    // a2 is a follow-up assistant under tool_result; its parent is the
    // tool_call (toolu_glob_001), which is still folded → a2 invisible.
    expect(renderedIds.has(fixtureUuids.a2)).toBe(false);
  });

  it("recursive expand uncovers deeper children", () => {
    const tree = fixtureTree();
    const result = layoutNodes({
      tree,
      foldedNodeIds: new Set(),
      expandedNodeIds: new Set([
        fixtureUuids.u1, // turn root
        fixtureUuids.a1, // first assistant
        fixtureUuids.tu1, // tool_call (Glob)
      ]),
    });
    const renderedIds = new Set(result.nodes.map((n) => n.id));
    expect(renderedIds.has(fixtureUuids.a2)).toBe(true);
  });
});

describe("layoutNodes — edge classification", () => {
  it("classifies assistant_call → tool_call as spawn", () => {
    const tree = fixtureTree();
    const result = layoutNodes({
      tree,
      foldedNodeIds: new Set(),
      expandedNodeIds: new Set([fixtureUuids.u1, fixtureUuids.a1]),
    });
    const spawnEdges = result.edges.filter((e) => e.type === "spawn");
    const a1ToToolu = spawnEdges.find((e) => e.target === fixtureUuids.tu1);
    expect(a1ToToolu).toBeDefined();
    expect(a1ToToolu?.source).toBe(fixtureUuids.a1);
  });

  it("classifies turn → next turn as continuation (default state, no expand)", () => {
    const tree = fixtureTree();
    const result = layoutNodes({
      tree,
      foldedNodeIds: new Set(),
      expandedNodeIds: new Set(),
    });
    // p2 → p1 cross-turn arrow: p2.parentId resolves through the
    // (folded) p1 subtree to p1's user_message, which IS visible.
    const p2Edge = result.edges.find((e) => e.target === fixtureUuids.u3);
    expect(p2Edge).toBeDefined();
    expect(p2Edge?.source).toBe(fixtureUuids.u1);
    expect(p2Edge?.type).toBe("continuation");
  });
});

describe("layoutNodes — focus mode", () => {
  it("only renders the focused subtree + its descendants (chain to root suppressed)", () => {
    const tree = fixtureTree();
    const result = layoutNodes({
      tree,
      foldedNodeIds: new Set(),
      expandedNodeIds: new Set([fixtureUuids.u1]),
      focusedSubtreeRootId: fixtureUuids.u1,
    });
    const renderedIds = new Set(result.nodes.map((n) => n.id));
    // p1 is rendered as the focus root; p2's user_message (cross-turn
    // child) is also reachable via the tree but lives OUTSIDE the
    // focused subtree (its parent chain goes through a1's terminal,
    // but cross-focus edges drop in focus mode).
    expect(renderedIds.has(fixtureUuids.u1)).toBe(true);
    // a1 is a direct child — visible because we expanded u1.
    expect(renderedIds.has(fixtureUuids.a1)).toBe(true);
    // p2 is not in the u1 subtree — must NOT appear.
    expect(renderedIds.has(fixtureUuids.u3)).toBe(false);
    expect(renderedIds.has(fixtureUuids.u_root2)).toBe(false);
  });

  it("focus mode drops edges that exit the focused subtree", () => {
    const tree = fixtureTree();
    const result = layoutNodes({
      tree,
      foldedNodeIds: new Set(),
      expandedNodeIds: new Set([fixtureUuids.u1]),
      focusedSubtreeRootId: fixtureUuids.u1,
    });
    // Edge from p1 → p2 doesn't exist when p2 is outside the focus.
    const exitEdges = result.edges.filter((e) => e.target === fixtureUuids.u3);
    expect(exitEdges).toHaveLength(0);
  });

  it("returns empty layout when focus root id doesn't exist in the tree", () => {
    const tree = fixtureTree();
    const result = layoutNodes({
      tree,
      foldedNodeIds: new Set(),
      expandedNodeIds: new Set(),
      focusedSubtreeRootId: "no-such-id",
    });
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });
});

describe("layoutNodes — folding a default-unfolded node", () => {
  it("explicitly folding a turn root collapses its (currently expanded) children", () => {
    // u1 is defaultFolded=true (children hidden). Expanding it
    // reveals a1; then folding it back should hide a1 again. The
    // foldedNodeIds membership wins over the expandedNodeIds
    // membership when both are present? They're mutually exclusive
    // per toggleFold contract — assert the override flips visibility.
    const tree = fixtureTree();
    const expanded = layoutNodes({
      tree,
      foldedNodeIds: new Set(),
      expandedNodeIds: new Set([fixtureUuids.u1]),
    });
    const collapsed = layoutNodes({
      tree,
      foldedNodeIds: new Set([fixtureUuids.u1]),
      expandedNodeIds: new Set(),
    });
    // Expanded view shows a1; collapsed view does not.
    const expandedHasA1 = expanded.nodes.some((n) => n.id === fixtureUuids.a1);
    const collapsedHasA1 = collapsed.nodes.some((n) => n.id === fixtureUuids.a1);
    expect(expandedHasA1).toBe(true);
    expect(collapsedHasA1).toBe(false);
  });
});

describe("layoutNodes — RF data shape", () => {
  it("node.type matches the source kind so the M5 nodeTypes map can dispatch", () => {
    const tree = fixtureTree();
    const result = layoutNodes({
      tree,
      foldedNodeIds: new Set(),
      expandedNodeIds: new Set([fixtureUuids.u1]),
    });
    for (const n of result.nodes) {
      expect(n.type).toBe(n.data.node.kind);
    }
  });

  it("isOverridden true iff the node id is in foldedNodeIds or expandedNodeIds", () => {
    const tree = fixtureTree();
    const result = layoutNodes({
      tree,
      foldedNodeIds: new Set(),
      expandedNodeIds: new Set([fixtureUuids.u1]),
    });
    const u1 = result.nodes.find((n) => n.id === fixtureUuids.u1)!;
    expect(u1.data.isOverridden).toBe(true);
    const u_root2 = result.nodes.find((n) => n.id === fixtureUuids.u_root2);
    expect(u_root2?.data.isOverridden).toBe(false);
  });

  it("each visible node carries hasIncomingEdge / hasOutgoingEdge flags", () => {
    const tree = fixtureTree();
    const result = layoutNodes({
      tree,
      foldedNodeIds: new Set(),
      expandedNodeIds: new Set([fixtureUuids.u1]),
    });
    // u1 is the first turn — should have outgoing (to a1) but no
    // incoming (it's a root).
    const u1 = result.nodes.find((n) => n.id === fixtureUuids.u1)!;
    expect(u1.data.hasOutgoingEdge).toBe(true);
    expect(u1.data.hasIncomingEdge).toBe(false);
  });
});

describe("NODE_SIZE", () => {
  it("delegate is widest, attachment narrowest (matches v0.5 chrome)", () => {
    expect(NODE_SIZE.delegate.width).toBeGreaterThan(NODE_SIZE.tool_call.width);
    expect(NODE_SIZE.attachment.width).toBeLessThan(NODE_SIZE.tool_call.width);
  });
});
