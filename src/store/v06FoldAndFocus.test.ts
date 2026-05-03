// v0.6 M2 — fold-state + focus-mode + unified-selection-hook tests.
//
// Coverage:
//   - toggleFold against an actual nodeTree (default-folded vs default-
//     unfolded nodes get inverted overrides as the user clicks)
//   - foldedNodeIds and expandedNodeIds stay mutually exclusive
//   - enterFocus / exitFocus mutate only focusedSubtreeRootId
//   - useIsNodeSelected returns true for either selectedNodeId or
//     workflowSelectedNodeId match (transitional dual-write window)
//   - loadSession populates BOTH chatFlow AND nodeTree (M2 promise)
//   - subAgentCache entries carry both chatFlow + nodeTree

import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useStore } from "@/store/index";
import { useIsNodeSelected } from "@/store/selectionHooks";
import { chatFlowToNodeTree } from "@/parse/chatFlowAdapter";
import { buildChatFlow } from "@/parse/jsonl";
import { buildSyntheticRecords, fixtureUuids } from "@/parse/__fixtures__/synthetic/build-fixture";

const SID = "sess-v06";

function blank() {
  return {
    chatFlow: null,
    foldedNodeIds: new Set<string>(),
    viewport: { x: 0, y: 0, zoom: 1 },
    selectedNodeId: null,
    workflowSelectedNodeId: null,
    drillStack: [],
    nodeTree: null,
    expandedNodeIds: new Set<string>(),
    focusedSubtreeRootId: null,
    subAgentCache: new Map(),
    isLoading: false,
    error: null,
    lastUpdated: 0,
  };
}

function seedWithTree() {
  const records = buildSyntheticRecords();
  const cf = buildChatFlow(records, "/synthetic/main.jsonl");
  const tree = chatFlowToNodeTree(cf);
  useStore.setState((s) => {
    const sessions = new Map(s.sessions);
    sessions.set(SID, {
      ...blank(),
      chatFlow: cf,
      nodeTree: tree,
    });
    return { sessions, activeSessionId: SID };
  });
}

beforeEach(() => {
  useStore.setState({ sessions: new Map(), activeSessionId: null });
  if (typeof localStorage !== "undefined") localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("toggleFold against a real nodeTree", () => {
  it("default-folded node (assistant_call) → first toggle adds to expandedNodeIds", () => {
    seedWithTree();
    useStore.getState().toggleFold(SID, fixtureUuids.a1);
    const s = useStore.getState().sessions.get(SID)!;
    expect(s.expandedNodeIds.has(fixtureUuids.a1)).toBe(true);
    expect(s.foldedNodeIds.has(fixtureUuids.a1)).toBe(false);
  });

  it("turn root (user_message, defaultFolded=true under抉择 1 A) → first toggle adds to expandedNodeIds", () => {
    seedWithTree();
    useStore.getState().toggleFold(SID, fixtureUuids.u1);
    const s = useStore.getState().sessions.get(SID)!;
    // Per抉择 1 A turn roots default to ``children hidden``; first
    // toggle reveals the inner workflow nodes (= add to expanded set).
    expect(s.expandedNodeIds.has(fixtureUuids.u1)).toBe(true);
    expect(s.foldedNodeIds.has(fixtureUuids.u1)).toBe(false);
  });

  it("a second toggle removes the override (returns to default)", () => {
    seedWithTree();
    useStore.getState().toggleFold(SID, fixtureUuids.a1); // expand
    useStore.getState().toggleFold(SID, fixtureUuids.a1); // back to default
    const s = useStore.getState().sessions.get(SID)!;
    expect(s.expandedNodeIds.has(fixtureUuids.a1)).toBe(false);
    expect(s.foldedNodeIds.has(fixtureUuids.a1)).toBe(false);
  });

  it("foldedNodeIds and expandedNodeIds stay mutually exclusive across toggles", () => {
    seedWithTree();
    // u1 is defaultFolded=true; first toggle expands it, second
    // toggle removes the override. Verify both sets stay disjoint
    // throughout — toggleFold is the only mutator.
    useStore.getState().toggleFold(SID, fixtureUuids.u1);
    let s = useStore.getState().sessions.get(SID)!;
    expect(s.expandedNodeIds.has(fixtureUuids.u1)).toBe(true);
    expect(s.foldedNodeIds.has(fixtureUuids.u1)).toBe(false);
    useStore.getState().toggleFold(SID, fixtureUuids.u1);
    s = useStore.getState().sessions.get(SID)!;
    expect(s.foldedNodeIds.has(fixtureUuids.u1)).toBe(false);
    expect(s.expandedNodeIds.has(fixtureUuids.u1)).toBe(false);
  });
});

describe("enterFocus / exitFocus", () => {
  it("enterFocus sets focusedSubtreeRootId, exitFocus clears it", () => {
    seedWithTree();
    expect(useStore.getState().sessions.get(SID)?.focusedSubtreeRootId).toBeNull();
    useStore.getState().enterFocus(SID, fixtureUuids.u3);
    expect(useStore.getState().sessions.get(SID)?.focusedSubtreeRootId).toBe(
      fixtureUuids.u3,
    );
    useStore.getState().exitFocus(SID);
    expect(useStore.getState().sessions.get(SID)?.focusedSubtreeRootId).toBeNull();
  });

  it("enterFocus is idempotent on the same id", () => {
    seedWithTree();
    useStore.getState().enterFocus(SID, fixtureUuids.u3);
    const before = useStore.getState().sessions.get(SID);
    useStore.getState().enterFocus(SID, fixtureUuids.u3);
    const after = useStore.getState().sessions.get(SID);
    // Same reference would be ideal but a no-op early-return at least
    // means focusedSubtreeRootId hasn't changed.
    expect(after?.focusedSubtreeRootId).toBe(before?.focusedSubtreeRootId);
  });

  it("preserves selection across focus enter/exit (focused subtree opens with the user's last click highlighted)", () => {
    seedWithTree();
    useStore.getState().setSelected(SID, fixtureUuids.a1);
    useStore.getState().enterFocus(SID, fixtureUuids.u3);
    expect(useStore.getState().sessions.get(SID)?.selectedNodeId).toBe(fixtureUuids.a1);
    useStore.getState().exitFocus(SID);
    expect(useStore.getState().sessions.get(SID)?.selectedNodeId).toBe(fixtureUuids.a1);
  });
});

describe("useIsNodeSelected (unified hook)", () => {
  it("returns true when ChatFlow-layer selectedNodeId matches", () => {
    seedWithTree();
    const { result } = renderHook(() => useIsNodeSelected("node-x"));
    expect(result.current).toBe(false);
    act(() => useStore.getState().setSelected(SID, "node-x"));
    expect(result.current).toBe(true);
  });

  it("returns true when WorkFlow-layer workflowSelectedNodeId matches (transitional)", () => {
    seedWithTree();
    const { result } = renderHook(() => useIsNodeSelected("node-y"));
    expect(result.current).toBe(false);
    act(() => useStore.getState().setWorkflowSelected(SID, "node-y"));
    expect(result.current).toBe(true);
  });

  it("does NOT re-render unrelated cards on a single-node selection change", () => {
    seedWithTree();
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useIsNodeSelected("never-this-id");
    });
    const initial = renders;
    expect(result.current).toBe(false);
    act(() => useStore.getState().setSelected(SID, "some-other-id"));
    expect(result.current).toBe(false);
    expect(renders).toBe(initial); // false → false → no re-render
  });
});

describe("loadSession populates both chatFlow + nodeTree", () => {
  it("after loadSession, sessions[id] has BOTH legacy chatFlow and unified nodeTree set", async () => {
    const records = buildSyntheticRecords();
    const cf = buildChatFlow(records, "/synthetic/main.jsonl");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(cf), { status: 200 })),
    );
    await useStore.getState().loadSession(cf.id);
    const s = useStore.getState().sessions.get(cf.id);
    expect(s?.chatFlow?.id).toBe(cf.id);
    expect(s?.nodeTree?.id).toBe(cf.id);
    expect(s?.nodeTree?.nodes.size).toBeGreaterThan(0);
  });
});

describe("subAgentCache entries carry both shapes", () => {
  it("after loadSubAgent success, the entry has both chatFlow and nodeTree populated", async () => {
    seedWithTree();
    const records = buildSyntheticRecords();
    const subCf = buildChatFlow(records, "/synthetic/sub.jsonl");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ chatFlow: subCf, meta: null }), {
            status: 200,
          }),
      ),
    );
    const entry = await useStore.getState().loadSubAgent(SID, "agent-xyz");
    expect(entry.status).toBe("ready");
    expect(entry.chatFlow?.id).toBe(subCf.id);
    expect(entry.nodeTree?.id).toBe(subCf.id);
    expect(entry.nodeTree?.nodes.size).toBeGreaterThan(0);
  });
});
