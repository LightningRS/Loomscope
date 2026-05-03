// v0.6 M2 — bridge from legacy ChatFlow to the new unified NodeTree.
//
// Why an adapter and not a direct ``parseNodeTreeFile`` call from the
// store: the backend endpoint already returns a ChatFlow (parsed once
// from disk), and adding a parallel NodeTree fetch would either
// double-parse the 256MB session on the server (~5s instead of ~2.5s)
// or double the JSON payload size. The adapter is a pure client-side
// translation — same total node count, same id space — so the
// transitional v0.6 store can populate both shapes from one network
// fetch.
//
// M5 switches the canvas / DrillPanel consumers to read from the
// NodeTree side. M7 deletes the legacy ChatFlow + this adapter
// together once nothing reads ChatFlow anymore.

import type {
  AttachmentNode as LegacyAttachmentNode,
  ChatFlow,
  ChatNode,
  CompactNode as LegacyCompactNode,
  DelegateNode as LegacyDelegateNode,
  LlmCallNode as LegacyLlmCallNode,
  Node,
  NodeAggregate,
  NodeTree,
  ToolCallNode as LegacyToolCallNode,
  WorkNode,
} from "@/data/types";

export function chatFlowToNodeTree(cf: ChatFlow): NodeTree {
  const nodes = new Map<string, Node>();

  // Pass 1: emit a Node for every ChatNode + every WorkNode it owns.
  // Build an id-set first so cross-bucket parent linking can hop on it.
  for (const cn of cf.chatNodes) {
    emitTurnNodes(cn, nodes);
  }

  // Pass 2: cross-bucket parent linking. ChatNode.parentChatNodeId is
  // the legacy edge between turns; the unified tree wires the next
  // turn root onto the prior turn's terminal assistant_call (or the
  // turn root itself when no assistant exists in the prior turn).
  const terminalAssistantByPromptId = new Map<string, string>();
  const terminalTsByPromptId = new Map<string, string>();
  for (const n of nodes.values()) {
    if (n.kind !== "assistant_call" || !n.promptId) continue;
    const ts = n.timestamp ?? "";
    const prev = terminalTsByPromptId.get(n.promptId);
    if (prev == null || ts > prev) {
      terminalAssistantByPromptId.set(n.promptId, n.id);
      terminalTsByPromptId.set(n.promptId, ts);
    }
  }
  for (const cn of cf.chatNodes) {
    if (!cn.parentChatNodeId) continue;
    const turnRoot = nodes.get(cn.rootUserUuid);
    if (!turnRoot) continue;
    const parentTerminal = terminalAssistantByPromptId.get(cn.parentChatNodeId);
    // parentChatNodeId is a promptId; the corresponding turn root in
    // the unified tree has id = its rootUserUuid. Look that up via
    // the parent ChatNode record.
    const parentCN = cf.chatNodes.find((c) => c.id === cn.parentChatNodeId);
    const parentRootId = parentCN?.rootUserUuid;
    turnRoot.parentId = parentTerminal ?? parentRootId ?? null;
  }

  // Pass 3: build childrenByParent + rootNodeIds.
  const rootNodeIds: string[] = [];
  const childrenByParent = new Map<string, string[]>();
  for (const n of nodes.values()) {
    if (n.parentId == null) {
      rootNodeIds.push(n.id);
    } else {
      const arr = childrenByParent.get(n.parentId) ?? [];
      arr.push(n.id);
      childrenByParent.set(n.parentId, arr);
    }
  }
  // Sort root list in turn-timestamp order (matches v0.5 ordering).
  rootNodeIds.sort((a, b) => {
    const na = nodes.get(a);
    const nb = nodes.get(b);
    const ta = na?.timestamp ?? "";
    const tb = nb?.timestamp ?? "";
    if (ta === tb) return a.localeCompare(b);
    return ta < tb ? -1 : 1;
  });
  for (const arr of childrenByParent.values()) {
    arr.sort((a, b) => {
      const na = nodes.get(a);
      const nb = nodes.get(b);
      const ta = na?.timestamp ?? "";
      const tb = nb?.timestamp ?? "";
      if (ta === tb) return a.localeCompare(b);
      return ta < tb ? -1 : 1;
    });
  }

  // Pass 4: aggregate computation per turn root.
  for (const n of nodes.values()) {
    if (!n.isTurnRoot) continue;
    n.aggregate = computeAggregate(n, nodes, childrenByParent);
  }

  return {
    id: cf.id,
    mainJsonlPath: cf.mainJsonlPath,
    sidecarDir: cf.sidecarDir,
    cwd: cf.cwd,
    gitBranch: cf.gitBranch,
    createdAt: cf.createdAt,
    lastUpdatedAt: cf.lastUpdatedAt,
    trigger: cf.trigger,
    triggerSource: cf.triggerSource,
    rootNodeIds,
    nodes,
    childrenByParent,
    orphans: cf.orphans,
    flowEvents: cf.flowEvents,
  };
}

function emitTurnNodes(cn: ChatNode, nodes: Map<string, Node>): void {
  const turnRoot: Node = {
    id: cn.rootUserUuid,
    parentId: null, // filled in cross-bucket linking
    kind: cn.isCompactSummary ? "compact" : "user_message",
    uuid: cn.rootUserUuid,
    timestamp: cn.userMessage.timestamp,
    promptId: cn.id,
    role: "user",
    content: cn.userMessage.content,
    attachments:
      cn.userMessage.attachments.length > 0
        ? cn.userMessage.attachments.map((a) => ({
            uuid: a.id,
            type: a.attachmentType,
            raw: a.raw,
          }))
        : undefined,
    slashCommand: cn.slashCommand,
    awaySummary: cn.meta.awaySummary,
    trigger: cn.trigger,
    triggerSource: cn.triggerSource,
    fileHistorySnapshotUuids: cn.meta.fileHistorySnapshotUuids,
    permissionModeChanges: cn.meta.permissionModeChanges,
    defaultFolded: true,
    isTurnRoot: true,
  };
  if (cn.isCompactSummary && cn.compactMetadata) {
    turnRoot.boundaryUuid = cn.compactMetadata.boundaryUuid;
    turnRoot.logicalParentUuid = cn.compactMetadata.logicalParentUuid;
    turnRoot.compactTrigger = cn.compactMetadata.trigger;
    turnRoot.preTokens = cn.compactMetadata.preTokens;
    turnRoot.preCompactDiscoveredTools = cn.compactMetadata.preCompactDiscoveredTools;
    turnRoot.summaryText = cn.compactMetadata.summaryText;
    turnRoot.isCompactSummary = true;
  }
  nodes.set(turnRoot.id, turnRoot);

  // Map each WorkNode kind into the unified Node space.
  for (const wn of cn.workflow.nodes) {
    const node = mapWorkNode(wn, cn);
    if (node) nodes.set(node.id, node);
  }

  // Resolve assistant parentage now that all nodes exist. assistant
  // records' raw parentUuid points at either the turn root user
  // record or a tool_result user record (which isn't itself a Node).
  // Map tool_result user uuid → owning tool_call/delegate node id.
  const resultUserUuidToToolId = new Map<string, string>();
  for (const wn of cn.workflow.nodes) {
    if (wn.kind === "tool_call" || wn.kind === "delegate") {
      if (wn.resultUserUuid) resultUserUuidToToolId.set(wn.resultUserUuid, wn.id);
    }
  }
  for (const wn of cn.workflow.nodes) {
    if (wn.kind !== "llm_call") continue;
    const node = nodes.get(wn.id);
    if (!node) continue;
    const parentUuid = wn.parentUuid;
    if (!parentUuid) {
      node.parentId = turnRoot.id;
      continue;
    }
    const owningTool = resultUserUuidToToolId.get(parentUuid);
    if (owningTool) {
      node.parentId = owningTool;
    } else if (parentUuid === turnRoot.id) {
      node.parentId = turnRoot.id;
    } else if (nodes.has(parentUuid)) {
      // Direct hit on another node in the same turn (e.g. another
      // assistant in the same prompt) — keep as parent.
      node.parentId = parentUuid;
    } else {
      node.parentId = turnRoot.id;
    }
  }
  // tool_call / delegate parents = their owning assistant_call.
  for (const wn of cn.workflow.nodes) {
    if (wn.kind !== "tool_call" && wn.kind !== "delegate") continue;
    const node = nodes.get(wn.id);
    if (!node) continue;
    node.parentId = wn.parentUuid ?? turnRoot.id;
  }
  // attachment / inner-bucket compact parents = the turn root.
  for (const wn of cn.workflow.nodes) {
    if (wn.kind !== "attachment" && wn.kind !== "compact") continue;
    const node = nodes.get(wn.id);
    if (!node) continue;
    // Skip if this compact IS the turn root (legacy duplicates the
    // compactMetadata onto the ChatNode itself).
    if (node === turnRoot) continue;
    node.parentId = turnRoot.id;
  }
}

function mapWorkNode(wn: WorkNode, cn: ChatNode): Node | null {
  // Compact records sometimes appear as the turn root's primary
  // metadata AND as their own WorkNode. Skip the latter when its id
  // matches the turn root (already emitted as the kind=compact root).
  if (wn.kind === "compact" && wn.id === cn.rootUserUuid) return null;
  switch (wn.kind) {
    case "llm_call":
      return mapLlmCall(wn, cn);
    case "tool_call":
      return mapToolCall(wn, cn);
    case "delegate":
      return mapDelegate(wn, cn);
    case "compact":
      return mapCompact(wn, cn);
    case "attachment":
      return mapAttachment(wn, cn);
  }
}

function mapLlmCall(n: LegacyLlmCallNode, cn: ChatNode): Node {
  return {
    id: n.id,
    parentId: null, // resolved later
    kind: "assistant_call",
    uuid: n.id,
    timestamp: n.timestamp,
    promptId: cn.id,
    role: "assistant",
    text: n.text,
    thinking: n.thinking,
    model: n.model,
    stopReason: n.stopReason,
    usage: n.usage,
    requestId: n.requestId,
    errors: n.errors,
    defaultFolded: true,
  };
}

function mapToolCall(n: LegacyToolCallNode, cn: ChatNode): Node {
  return {
    id: n.id,
    parentId: null,
    kind: "tool_call",
    uuid: n.parentUuid ?? undefined,
    timestamp: n.timestamp,
    promptId: cn.id,
    toolName: n.toolName,
    toolInput: n.input,
    toolResultUserUuid: n.resultUserUuid,
    toolResultBlock: n.resultBlock,
    toolUseResult: n.toolUseResult,
    isError: n.isError,
    durationMs: n.durationMs,
    defaultFolded: true,
  };
}

function mapDelegate(n: LegacyDelegateNode, cn: ChatNode): Node {
  return {
    id: n.id,
    parentId: null,
    kind: "delegate",
    uuid: n.parentUuid ?? undefined,
    timestamp: n.timestamp,
    promptId: cn.id,
    toolName: n.toolName,
    agentType: n.agentType,
    agentId: n.agentId,
    description: n.description,
    prompt: n.prompt,
    toolResultUserUuid: n.resultUserUuid,
    status: n.status,
    delegateContent: n.content,
    totalDurationMs: n.totalDurationMs,
    totalTokens: n.totalTokens,
    totalToolUseCount: n.totalToolUseCount,
    delegateUsage: n.usage,
    toolStats: n.toolStats,
    toolUseResult: n.toolUseResult,
    isError: n.isError,
    defaultFolded: true,
  };
}

function mapCompact(n: LegacyCompactNode, cn: ChatNode): Node {
  return {
    id: n.id,
    parentId: null,
    kind: "compact",
    uuid: n.id,
    timestamp: n.timestamp,
    promptId: cn.id,
    role: "user",
    isCompactSummary: true,
    boundaryUuid: n.boundaryUuid,
    logicalParentUuid: n.logicalParentUuid,
    compactTrigger: n.trigger,
    preTokens: n.preTokens,
    preCompactDiscoveredTools: n.preCompactDiscoveredTools,
    summaryText: n.summaryText,
    defaultFolded: true,
  };
}

function mapAttachment(n: LegacyAttachmentNode, cn: ChatNode): Node {
  return {
    id: n.id,
    parentId: null,
    kind: "attachment",
    uuid: n.id,
    timestamp: n.timestamp,
    promptId: cn.id,
    attachmentType: n.attachmentType,
    attachmentRaw: n.raw,
    defaultFolded: true,
  };
}

// Aggregate computation — same shape as nodeTree.ts so the rendered
// turn-root card looks identical regardless of which path produced
// the tree.
function computeAggregate(
  root: Node,
  nodes: Map<string, Node>,
  childrenByParent: Map<string, string[]>,
): NodeAggregate {
  let llmCallCount = 0;
  let toolCallCount = 0;
  let delegateCount = 0;
  let attachmentCount = 0;
  let thinkingChars = 0;
  let lastAssistant: Node | null = null;
  const stack: string[] = [root.id];
  while (stack.length) {
    const id = stack.pop()!;
    const children = childrenByParent.get(id);
    if (!children) continue;
    for (const cid of children) {
      const c = nodes.get(cid);
      if (!c) continue;
      if (c.kind === "user_message" || c.kind === "compact") continue;
      if (c.kind === "assistant_call") {
        llmCallCount += 1;
        for (const t of c.thinking ?? []) {
          thinkingChars += t.text?.length ?? 0;
        }
        if (
          !lastAssistant ||
          (c.timestamp ?? "") > (lastAssistant.timestamp ?? "")
        ) {
          lastAssistant = c;
        }
      } else if (c.kind === "tool_call") {
        toolCallCount += 1;
      } else if (c.kind === "delegate") {
        delegateCount += 1;
      } else if (c.kind === "attachment") {
        attachmentCount += 1;
      }
      stack.push(cid);
    }
  }
  const usage = (lastAssistant?.usage ?? {}) as Record<string, unknown>;
  const num = (k: string): number =>
    typeof usage[k] === "number" ? (usage[k] as number) : 0;
  const contextTokens =
    num("input_tokens") + num("cache_creation_input_tokens") + num("cache_read_input_tokens");
  const previewText = (lastAssistant?.text ?? "").replace(/\s+/g, " ").trim();
  const assistantPreview =
    previewText.length <= 80 ? previewText : previewText.slice(0, 79) + "…";
  return {
    assistantPreview,
    llmCallCount,
    toolCallCount,
    delegateCount,
    attachmentCount,
    thinkingChars,
    contextTokens,
    model: lastAssistant?.model,
  };
}
