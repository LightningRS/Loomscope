import { beforeEach, describe, expect, it } from "vitest";

import { useStore } from "@/store/index";

const INITIAL = useStore.getState();

beforeEach(() => {
  useStore.setState(
    {
      ...INITIAL,
      sessions: new Map(),
      sessionsByCwd: new Map(),
      expandedCwds: new Set(),
      activeSessionId: null,
    },
    false,
  );
  if (typeof localStorage !== "undefined") localStorage.clear();
});

describe("drill-down navigation actions", () => {
  it("enterWorkflow pushes a chatnode frame and clears workflowSelectedNodeId", () => {
    useStore.getState().setWorkflowSelected("sid", "stale-node"); // should be wiped
    useStore.getState().enterWorkflow("sid", "cn-1");
    const s = useStore.getState().sessions.get("sid")!;
    expect(s.drillStack).toEqual([{ kind: "chatnode", chatNodeId: "cn-1" }]);
    expect(s.workflowSelectedNodeId).toBeNull();
  });

  it("enterWorkflow on the same chatNodeId is idempotent", () => {
    useStore.getState().enterWorkflow("sid", "cn-1");
    useStore.getState().setWorkflowSelected("sid", "wn-1");
    useStore.getState().enterWorkflow("sid", "cn-1"); // re-enter same
    const s = useStore.getState().sessions.get("sid")!;
    expect(s.drillStack).toEqual([{ kind: "chatnode", chatNodeId: "cn-1" }]);
    // Re-entering the SAME ChatNode preserves selection so a stray
    // double-click on the drill button doesn't blow away the user's
    // node-level selection.
    expect(s.workflowSelectedNodeId).toBe("wn-1");
  });

  it("exitWorkflow empties the stack and clears workflow-layer selection", () => {
    useStore.getState().enterWorkflow("sid", "cn-1");
    useStore.getState().setWorkflowSelected("sid", "wn-1");
    useStore.getState().exitWorkflow("sid");
    const s = useStore.getState().sessions.get("sid")!;
    expect(s.drillStack).toEqual([]);
    expect(s.workflowSelectedNodeId).toBeNull();
  });

  it("ChatFlow-layer selectedNodeId is independent from workflowSelectedNodeId across drills", () => {
    useStore.getState().setSelected("sid", "cn-1");
    useStore.getState().enterWorkflow("sid", "cn-1");
    useStore.getState().setWorkflowSelected("sid", "wn-1");
    useStore.getState().exitWorkflow("sid");
    const s = useStore.getState().sessions.get("sid")!;
    // ChatFlow selection survives the round trip — required so the
    // user lands back where they were after closing the drill view.
    expect(s.selectedNodeId).toBe("cn-1");
    expect(s.workflowSelectedNodeId).toBeNull();
  });

  it("truncateDrillStack with depth=0 is equivalent to exitWorkflow", () => {
    useStore.getState().enterWorkflow("sid", "cn-1");
    useStore.getState().setWorkflowSelected("sid", "wn-1");
    useStore.getState().truncateDrillStack("sid", 0);
    const s = useStore.getState().sessions.get("sid")!;
    expect(s.drillStack).toEqual([]);
    expect(s.workflowSelectedNodeId).toBeNull();
  });

  it("setWorkflowSelected sets and clears independently", () => {
    useStore.getState().setWorkflowSelected("sid", "wn-1");
    expect(useStore.getState().sessions.get("sid")?.workflowSelectedNodeId).toBe("wn-1");
    useStore.getState().setWorkflowSelected("sid", null);
    expect(useStore.getState().sessions.get("sid")?.workflowSelectedNodeId).toBeNull();
  });

  it("drillStack is NOT persisted across reloads (intentional v0.3 decision)", () => {
    useStore.getState().enterWorkflow("sid", "cn-1");
    const raw = localStorage.getItem("loomscope:state");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as { state: Record<string, unknown> };
    // Persisted shape only contains UI keys (sidebar prefs etc.) — sessions
    // and drillStack are explicitly NOT in partialize.
    expect(parsed.state).not.toHaveProperty("sessions");
  });
});
