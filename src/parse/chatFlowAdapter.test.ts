// Equivalence tests for ChatFlow → NodeTree adapter.
//
// The adapter must produce the same node count + same id space + same
// kinds + same parent linkage as the direct M1 parser. This pins
// the M2 transitional path's correctness so consumers can read from
// EITHER shape interchangeably until M5/M6 swap them out.

import { describe, expect, it } from "vitest";

import { chatFlowToNodeTree } from "@/parse/chatFlowAdapter";
import { buildChatFlow } from "@/parse/jsonl";
import { buildNodeTree, nodeTreeStats } from "@/parse/nodeTree";
import { buildSyntheticRecords } from "@/parse/__fixtures__/synthetic/build-fixture";

const FIXTURE_PATH = "/synthetic/main.jsonl";

describe("chatFlowToNodeTree adapter — shape equivalence", () => {
  it("emits the same total node count as direct M1 parse", () => {
    const records = buildSyntheticRecords();
    const direct = buildNodeTree(records, FIXTURE_PATH);
    const cf = buildChatFlow(records, FIXTURE_PATH);
    const adapted = chatFlowToNodeTree(cf);
    expect(adapted.nodes.size).toBe(direct.nodes.size);
  });

  it("emits the same set of node ids", () => {
    const records = buildSyntheticRecords();
    const direct = buildNodeTree(records, FIXTURE_PATH);
    const cf = buildChatFlow(records, FIXTURE_PATH);
    const adapted = chatFlowToNodeTree(cf);
    const directIds = [...direct.nodes.keys()].sort();
    const adaptedIds = [...adapted.nodes.keys()].sort();
    expect(adaptedIds).toEqual(directIds);
  });

  it("kind classification matches per node id", () => {
    const records = buildSyntheticRecords();
    const direct = buildNodeTree(records, FIXTURE_PATH);
    const cf = buildChatFlow(records, FIXTURE_PATH);
    const adapted = chatFlowToNodeTree(cf);
    for (const [id, n] of direct.nodes) {
      expect(adapted.nodes.get(id)?.kind).toBe(n.kind);
    }
  });

  it("isTurnRoot flag matches per node id", () => {
    const records = buildSyntheticRecords();
    const direct = buildNodeTree(records, FIXTURE_PATH);
    const cf = buildChatFlow(records, FIXTURE_PATH);
    const adapted = chatFlowToNodeTree(cf);
    for (const [id, n] of direct.nodes) {
      expect(adapted.nodes.get(id)?.isTurnRoot ?? false).toBe(n.isTurnRoot ?? false);
    }
  });

  it("nodeTreeStats reports identical kind counts", () => {
    const records = buildSyntheticRecords();
    const direct = buildNodeTree(records, FIXTURE_PATH);
    const cf = buildChatFlow(records, FIXTURE_PATH);
    const adapted = chatFlowToNodeTree(cf);
    expect(nodeTreeStats(adapted)).toEqual(nodeTreeStats(direct));
  });

  it("parent linkage matches for every node (cross-bucket arrows land identically)", () => {
    const records = buildSyntheticRecords();
    const direct = buildNodeTree(records, FIXTURE_PATH);
    const cf = buildChatFlow(records, FIXTURE_PATH);
    const adapted = chatFlowToNodeTree(cf);
    for (const [id, n] of direct.nodes) {
      const a = adapted.nodes.get(id);
      expect(a?.parentId).toBe(n.parentId);
    }
  });

  it("aggregate (assistantPreview / counts / contextTokens) matches per turn root", () => {
    const records = buildSyntheticRecords();
    const direct = buildNodeTree(records, FIXTURE_PATH);
    const cf = buildChatFlow(records, FIXTURE_PATH);
    const adapted = chatFlowToNodeTree(cf);
    for (const [id, n] of direct.nodes) {
      if (!n.isTurnRoot) continue;
      const a = adapted.nodes.get(id);
      expect(a?.aggregate?.assistantPreview).toBe(n.aggregate?.assistantPreview);
      expect(a?.aggregate?.llmCallCount).toBe(n.aggregate?.llmCallCount);
      expect(a?.aggregate?.toolCallCount).toBe(n.aggregate?.toolCallCount);
      expect(a?.aggregate?.delegateCount).toBe(n.aggregate?.delegateCount);
      expect(a?.aggregate?.contextTokens).toBe(n.aggregate?.contextTokens);
    }
  });

  it("rootNodeIds match the direct parse (cross-bucket parents agree)", () => {
    const records = buildSyntheticRecords();
    const direct = buildNodeTree(records, FIXTURE_PATH);
    const cf = buildChatFlow(records, FIXTURE_PATH);
    const adapted = chatFlowToNodeTree(cf);
    expect(adapted.rootNodeIds.sort()).toEqual([...direct.rootNodeIds].sort());
  });

  it("preserves session-level metadata (id / cwd / sidecarDir)", () => {
    const records = buildSyntheticRecords();
    const cf = buildChatFlow(records, FIXTURE_PATH);
    const adapted = chatFlowToNodeTree(cf);
    expect(adapted.id).toBe(cf.id);
    expect(adapted.cwd).toBe(cf.cwd);
    expect(adapted.sidecarDir).toBe(cf.sidecarDir);
  });
});
