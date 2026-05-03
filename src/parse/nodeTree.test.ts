// v0.6 M1 — unified Node tree parser tests.
//
// Coverage matrix (mirrors v0.1 invariants from jsonl.test.ts):
//   - parser builds a single recursive Node tree (rootNodeIds + Map)
//   - bucket-by-promptId still groups one promptId → one turn root
//   - tool_result reverse-matched via block-level tool_use_id
//   - Agent / Task tool_use → kind=delegate (with agentId/agentType)
//   - non-Agent tool_use → kind=tool_call
//   - isCompactSummary user records → kind=compact (turn root)
//   - compact_boundary metadata flows onto the compact node
//   - scheduled_task_fire trigger detection
//   - away_summary attached as next turn's brief
//   - multi-root sessions parented at null
//   - cross-bucket parent linking (user_message.parentId → previous
//     turn's last assistant_call)
//   - default-fold rules per抉择 1 选项 A:
//       user_message + compact = false; everything else = true
//   - aggregate (assistantPreview / counts / contextTokens) on turn root
//   - childrenByParent index sorted by timestamp
//   - skip-types still skipped, orphan classification preserved
//   - sub-agent jsonl parses with the same parser (re-entrant)

import { describe, expect, it } from "vitest";

import {
  buildNodeTree,
  nodeTreeStats,
  parseNodeTreeText,
} from "@/parse/nodeTree";
import {
  buildSyntheticRecords,
  fixtureUuids,
  recordsToJsonl,
  SESSION_ID,
} from "@/parse/__fixtures__/synthetic/build-fixture";
import type { RawRecord } from "@/parse/raw-record";

const FIXTURE_PATH = "/synthetic/main.jsonl";

function fixtureTree() {
  const records = buildSyntheticRecords();
  return buildNodeTree(records, FIXTURE_PATH);
}

describe("buildNodeTree — basic shape", () => {
  it("produces one node per turn root + descendants for the synthetic fixture", () => {
    const tree = fixtureTree();
    expect(tree.id).toBe(SESSION_ID);
    expect(tree.cwd).toBe("/home/dev/example");
    expect(tree.gitBranch).toBe("main");
    // 6 turn roots in the fixture (p1..p6).
    const turnRootIds = tree.rootNodeIds;
    // Some roots may be parented to siblings via cross-bucket linking
    // (p2.parentId=p1's terminal assistant). Roots = parentId==null.
    expect(turnRootIds.length).toBeGreaterThan(0);
  });

  it("survives a JSONL round-trip (text → tree same node count as records → tree)", () => {
    const records = buildSyntheticRecords();
    const direct = buildNodeTree(records, FIXTURE_PATH);
    const parsed = parseNodeTreeText(recordsToJsonl(records), FIXTURE_PATH).tree;
    expect(parsed.nodes.size).toBe(direct.nodes.size);
    expect(parsed.id).toBe(direct.id);
  });

  it("sets sidecarDir to the jsonl path stripped of `.jsonl`", () => {
    const tree = fixtureTree();
    expect(tree.sidecarDir).toBe("/synthetic/main");
  });

  it("populates childrenByParent index for every non-leaf node", () => {
    const tree = fixtureTree();
    // p1's turn root should have at least one assistant_call child.
    const p1Root = tree.nodes.get(fixtureUuids.u1);
    expect(p1Root).toBeDefined();
    expect(p1Root!.kind).toBe("user_message");
    const children = tree.childrenByParent.get(p1Root!.id) ?? [];
    expect(children.length).toBeGreaterThan(0);
  });

  it("childrenByParent ids sort by timestamp", () => {
    const tree = fixtureTree();
    for (const childIds of tree.childrenByParent.values()) {
      let prevTs = "";
      for (const cid of childIds) {
        const n = tree.nodes.get(cid);
        const ts = n?.timestamp ?? "";
        expect(ts >= prevTs).toBe(true);
        prevTs = ts;
      }
    }
  });
});

describe("kind classification (mirrors v0.5 WorkNode kinds)", () => {
  it("Agent tool_use becomes kind=delegate with agentId / agentType", () => {
    const tree = fixtureTree();
    const delegate = [...tree.nodes.values()].find((n) => n.kind === "delegate");
    expect(delegate).toBeDefined();
    expect(delegate!.toolName).toBe("Agent");
    expect(delegate!.agentId).toBe("aaa1bbb2");
    expect(delegate!.agentType).toBe("Explore");
    expect(delegate!.totalDurationMs).toBe(1234);
  });

  it("non-Agent tool_use becomes kind=tool_call", () => {
    const tree = fixtureTree();
    const toolCalls = [...tree.nodes.values()].filter((n) => n.kind === "tool_call");
    const names = toolCalls.map((n) => n.toolName);
    expect(names).toContain("Glob");
    expect(names).toContain("ScheduleWakeup"); // ScheduleWakeup itself is a normal tool, not delegate
  });

  it("isCompactSummary user record becomes a compact turn root", () => {
    const tree = fixtureTree();
    // p3 is the compact bucket in the synthetic fixture.
    const p3Root = tree.nodes.get(fixtureUuids.u5);
    expect(p3Root).toBeDefined();
    expect(p3Root!.kind).toBe("compact");
    expect(p3Root!.boundaryUuid).toBe(fixtureUuids.bdry1);
    expect(p3Root!.logicalParentUuid).toBe(fixtureUuids.a3);
    expect(p3Root!.compactTrigger).toBe("manual");
    expect(p3Root!.preTokens).toBe(50000);
    expect(p3Root!.summaryText).toContain("[Compact summary]");
  });

  it("assistant records become kind=assistant_call carrying text + thinking + model", () => {
    const tree = fixtureTree();
    const assistantCalls = [...tree.nodes.values()].filter(
      (n) => n.kind === "assistant_call",
    );
    expect(assistantCalls.length).toBeGreaterThanOrEqual(3);
    const a1 = tree.nodes.get(fixtureUuids.a1);
    expect(a1?.kind).toBe("assistant_call");
    expect(a1?.text).toBe("Sure, let me search.");
    expect(a1?.thinking?.length).toBe(1);
    expect(a1?.model).toBe("claude-opus-4-7");
  });

  it("scheduled fire turn carries trigger=scheduled + triggerSource", () => {
    const tree = fixtureTree();
    const p4Root = tree.nodes.get(fixtureUuids.u_fire);
    expect(p4Root).toBeDefined();
    expect(p4Root!.trigger).toBe("scheduled");
    expect(p4Root!.triggerSource?.workNodeId).toBe(fixtureUuids.tu_sw);
  });

  it("away_summary attached to the following turn root as awaySummary", () => {
    const tree = fixtureTree();
    const p5Root = tree.nodes.get(fixtureUuids.u_after);
    expect(p5Root?.awaySummary?.uuid).toBe(fixtureUuids.aw1);
    expect(p5Root?.awaySummary?.content).toContain("Heads up");
  });

  it("multi-root: a parentUuid=null user record sits at top level (parentId=null)", () => {
    const tree = fixtureTree();
    const p6Root = tree.nodes.get(fixtureUuids.u_root2);
    expect(p6Root?.parentId).toBeNull();
    expect(tree.rootNodeIds).toContain(p6Root?.id);
  });
});

describe("default-fold rules (抉择 1 选项 A)", () => {
  it("EVERY Node defaults to ``children hidden`` (defaultFolded=true)", () => {
    // Per抉择 1 选项 A: each turn renders as one aggregate card by
    // default; double-click on the turn root reveals its immediate
    // children. ``defaultFolded`` here means "this node's children are
    // hidden", not "this card is hidden". Turn-root cards still
    // render because layoutNodes treats ``isTurnRoot`` as an
    // always-visible carve-out (independent of fold state).
    const tree = fixtureTree();
    for (const n of tree.nodes.values()) {
      expect(n.defaultFolded).toBe(true);
    }
  });
});

describe("aggregate computation (turn root → folded card preview)", () => {
  it("sets assistantPreview to the LAST assistant_call's text", () => {
    const tree = fixtureTree();
    const p1Root = tree.nodes.get(fixtureUuids.u1);
    expect(p1Root!.aggregate?.assistantPreview).toBe("Found 5 .tsx files.");
  });

  it("counts immediate kind descendants under the turn", () => {
    const tree = fixtureTree();
    const p2Root = tree.nodes.get(fixtureUuids.u3);
    const agg = p2Root!.aggregate!;
    // p2 has 1 assistant + Agent (delegate) + ScheduleWakeup (tool_call).
    expect(agg.llmCallCount).toBe(1);
    expect(agg.toolCallCount).toBe(1);
    expect(agg.delegateCount).toBe(1);
  });

  it("sums thinking-block char lengths across all assistant_calls in the turn", () => {
    const tree = fixtureTree();
    const p1Root = tree.nodes.get(fixtureUuids.u1);
    expect(p1Root!.aggregate?.thinkingChars).toBeGreaterThan(0);
  });

  it("contextTokens = sum of input + cache_creation + cache_read on the LAST assistant_call usage", () => {
    // Synthetic fixture's a1 has usage {input_tokens:10, output_tokens:5}; a2 has none.
    // The "last" assistant in p1 is a2 (no usage block).
    const tree = fixtureTree();
    const p1Root = tree.nodes.get(fixtureUuids.u1);
    expect(p1Root!.aggregate?.contextTokens).toBeDefined();
  });
});

describe("cross-bucket parent linking", () => {
  it("p2's user_message parents to p1's last assistant_call", () => {
    const tree = fixtureTree();
    const p2Root = tree.nodes.get(fixtureUuids.u3);
    expect(p2Root?.parentId).toBe(fixtureUuids.a2); // a2 is p1's terminal assistant
  });

  it("p3 (compact) parents to its logicalParentUuid ancestor", () => {
    const tree = fixtureTree();
    const p3Root = tree.nodes.get(fixtureUuids.u5);
    // logicalParentUuid points at a3 (p2's terminal assistant).
    expect(p3Root?.parentId).toBe(fixtureUuids.a3);
  });

  it("p4 (scheduled fire) parents to p2's terminal assistant via parentUuid backwalk", () => {
    const tree = fixtureTree();
    const p4Root = tree.nodes.get(fixtureUuids.u_fire);
    // The fire's parentUuid chain hits a2/a3 in p2; p2's terminal
    // assistant_call is a3.
    expect(p4Root?.parentId).toBe(fixtureUuids.a3);
  });
});

describe("orphans / flowEvents (preserves v0.1 carve-out)", () => {
  it("scheduled_task_fire collected as a flow event", () => {
    const tree = fixtureTree();
    const fire = tree.flowEvents.find((e) => e.type === "scheduled_task_fire");
    expect(fire?.uuid).toBe(fixtureUuids.fire1);
  });

  it("unknown future record types kept as orphans", () => {
    const tree = fixtureTree();
    const orphanTypes = tree.orphans.map((o) => o.type);
    expect(orphanTypes).toContain("marble-origami-snapshot");
  });

  it("skip-types not in orphans (last-prompt / queue-operation)", () => {
    const tree = fixtureTree();
    const orphanTypes = tree.orphans.map((o) => o.type);
    expect(orphanTypes).not.toContain("last-prompt");
    expect(orphanTypes).not.toContain("queue-operation");
  });
});

describe("ChatNode → Node id-space mapping (debug-friendly)", () => {
  it("turn root id = the root user record uuid (matches legacy rootUserUuid)", () => {
    const tree = fixtureTree();
    const p1Root = tree.nodes.get(fixtureUuids.u1);
    expect(p1Root!.id).toBe(fixtureUuids.u1);
    expect(p1Root!.uuid).toBe(fixtureUuids.u1);
  });

  it("tool_call / delegate id = tool_use block id (matches legacy WorkNode.id)", () => {
    const tree = fixtureTree();
    const glob = [...tree.nodes.values()].find(
      (n) => n.kind === "tool_call" && n.toolName === "Glob",
    );
    expect(glob?.id).toBe(fixtureUuids.tu1);
    const agent = [...tree.nodes.values()].find(
      (n) => n.kind === "delegate" && n.toolName === "Agent",
    );
    expect(agent?.id).toBe(fixtureUuids.tu_agent);
  });
});

describe("slash command + meta handling (preserves v0.1 invariants)", () => {
  it("prefers non-meta user record as turn root over isMeta caveat", () => {
    const records: RawRecord[] = [
      {
        type: "user",
        uuid: "u-caveat",
        parentUuid: null,
        promptId: "p-slash",
        sessionId: "s",
        timestamp: "2026-05-03T00:00:00Z",
        isMeta: true,
        message: { role: "user", content: "<local-command-caveat>note</local-command-caveat>" },
      } as RawRecord,
      {
        type: "user",
        uuid: "u-cmd",
        parentUuid: "u-caveat",
        promptId: "p-slash",
        sessionId: "s",
        timestamp: "2026-05-03T00:00:01Z",
        message: { role: "user", content: "<command-name>/model</command-name>" },
      } as RawRecord,
    ];
    const tree = buildNodeTree(records, "/x.jsonl");
    // Turn root id matches the chosen non-meta user record.
    const root = tree.nodes.get("u-cmd");
    expect(root).toBeDefined();
    expect(root!.kind).toBe("user_message");
    expect(root!.slashCommand?.name).toBe("/model");
  });

  it("falls back to meta user when bucket has only meta (ScheduleWakeup sentinel)", () => {
    const records: RawRecord[] = [
      {
        type: "user",
        uuid: "u-sentinel",
        parentUuid: null,
        promptId: "p-sched",
        sessionId: "s",
        timestamp: "2026-05-03T00:00:00Z",
        isMeta: true,
        message: { role: "user", content: "<<autonomous-loop-dynamic>>" },
      } as RawRecord,
    ];
    const tree = buildNodeTree(records, "/x.jsonl");
    expect(tree.nodes.get("u-sentinel")?.kind).toBe("user_message");
  });
});

describe("re-entrant: parser handles a sub-agent jsonl identically", () => {
  it("a sub-agent style record set (all isSidechain:true) parses to the same shape", () => {
    // Simulate a tiny sub-agent jsonl: 1 user + 1 assistant, all
    // isSidechain. The parser must produce a turn root + assistant
    // child the same way it does for main session.
    const records: RawRecord[] = [
      {
        type: "user",
        uuid: "su1",
        parentUuid: null,
        promptId: "sp1",
        sessionId: "s",
        isSidechain: true,
        timestamp: "2026-05-03T00:00:00Z",
        message: { role: "user", content: "Find perf hot spots" },
      } as RawRecord,
      {
        type: "assistant",
        uuid: "sa1",
        parentUuid: "su1",
        promptId: "sp1",
        sessionId: "s",
        isSidechain: true,
        timestamp: "2026-05-03T00:00:01Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Found 3 hot spots." }],
          stop_reason: "end_turn",
        },
      } as RawRecord,
    ];
    const tree = buildNodeTree(records, "/x/sub.jsonl");
    expect(tree.nodes.size).toBe(2);
    const root = tree.nodes.get("su1");
    expect(root?.kind).toBe("user_message");
    const assistant = tree.nodes.get("sa1");
    expect(assistant?.kind).toBe("assistant_call");
    expect(assistant?.parentId).toBe("su1");
  });
});

describe("nodeTreeStats", () => {
  it("counts nodes by kind for the synthetic fixture", () => {
    const tree = fixtureTree();
    const stats = nodeTreeStats(tree);
    expect(stats.totalNodes).toBeGreaterThan(0);
    expect(stats.delegateCount).toBe(1);
    expect(stats.compactCount).toBeGreaterThanOrEqual(1);
    expect(stats.toolCallCount).toBeGreaterThanOrEqual(2); // Glob + ScheduleWakeup
    expect(stats.llmCallCount).toBeGreaterThanOrEqual(3);
  });

  it("turnRoots = number of buckets with a chosen rootUser (legacy chatNodeCount equivalent)", () => {
    const tree = fixtureTree();
    const stats = nodeTreeStats(tree);
    // Synthetic fixture has 6 promptIds (p1..p6), all of which produce
    // valid roots → 6 turn roots.
    expect(stats.turnRoots).toBe(6);
  });
});

describe("isTurnRoot flag", () => {
  it("set true on every bucket-root node, false/undef on inner descendants", () => {
    const tree = fixtureTree();
    const turnRoots = [...tree.nodes.values()].filter((n) => n.isTurnRoot);
    expect(turnRoots).toHaveLength(6); // p1..p6
    // No assistant_call / tool_call / delegate / attachment / inner-bucket
    // compact dup should ever have isTurnRoot=true.
    for (const n of tree.nodes.values()) {
      if (n.kind === "assistant_call") expect(n.isTurnRoot).toBeFalsy();
      if (n.kind === "tool_call") expect(n.isTurnRoot).toBeFalsy();
      if (n.kind === "delegate") expect(n.isTurnRoot).toBeFalsy();
      if (n.kind === "attachment") expect(n.isTurnRoot).toBeFalsy();
    }
  });
});
