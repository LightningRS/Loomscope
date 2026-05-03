// v0.6 unified Node tree parser.
//
// Reads raw CC jsonl records and emits a single recursive ``Node`` tree
// (see ``src/data/types.ts``). Replaces the v0.1-v0.5 two-layer
// ChatFlow → ChatNode → WorkFlow → WorkNode model with a flat
// ``Map<id, Node>`` plus ``rootNodeIds[]`` and a ``childrenByParent``
// index so consumers can walk the tree in O(1) per hop.
//
// Algorithm (mirrors v0.1's pass structure but emits unified nodes):
//   pass 1: index records (uuid → light summary; pair compact_boundary
//           with its isCompactSummary user record; collect ScheduleWakeup
//           tool_use ids by uuid for trigger source lookup).
//   pass 2: bucket records by promptId (inheriting via parentUuid hop
//           across compact boundary). Carve ChatFlow-layer system
//           events (scheduled_task_fire / away_summary /
//           compact_boundary / local_command) into ``flowEvents`` /
//           lookup tables instead of bucketing them.
//   pass 3: per bucket, build the turn's Node subtree:
//           - one ``user_message`` node (turn root)
//           - assistant_call / tool_call / delegate / compact /
//             attachment children, parented via raw parentUuid chain
//           - default-fold per抉择 1 选项 A: turn root + compact
//             unfolded; everything else folded
//           - aggregate (assistant preview / counts / token bar inputs)
//             pre-computed onto the user_message node
//   pass 4: link cross-bucket parents — each user_message's parentId
//           points at the prior turn's last assistant_call (or compact
//           parent via logicalParentUuid hop). Sort root list + build
//           ``childrenByParent`` index.
//
// All v0.1 invariants are preserved (see docs/design-data-model.md
// "v0.1 实测确认的解析规范"); they're enforced by the same code paths,
// just emitting Node objects instead of ChatNode/WorkNode pairs.

import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";

import type {
  Node,
  NodeAggregate,
  NodeKind,
  NodeTree,
  OrphanRecord,
  FlowEvent,
  ChatNodeTrigger,
  ThinkingBlock,
  WorkNodeError,
  SlashCommandInfo,
} from "@/data/types";
import {
  blocksOf,
  extractToolResultBlock,
  isToolResultRecord,
  parseLine,
  type InnerToolUseBlock,
  type RawRecord,
} from "@/parse/raw-record";

const SKIP_TYPES = new Set([
  "last-prompt",
  "messages_changed",
  "system_changed",
  "queue-operation",
]);

const DELEGATE_TOOL_NAMES = new Set(["Agent", "Task"]);

const ATTACHMENT_RENDER_TYPES = new Set([
  "file",
  "edited_text_file",
  "queued_command",
  "invoked_skills",
  "compact_file_reference",
  "skill_listing",
]);

interface IndexedRecord {
  uuid: string;
  parentUuid: string | null;
  logicalParentUuid?: string | null;
  type: string;
  subtype?: string;
  promptId?: string;
  isCompactSummary?: boolean;
  timestamp?: string;
}

interface PromptBucket {
  promptId: string;
  records: RawRecord[];
}

export interface ParseNodeTreeResult {
  tree: NodeTree;
  parseFailures: number;
}

export interface ParseNodeTreeOptions {
  // Override sidecar dir derivation (defaults to jsonl path stripped
  // of ``.jsonl``).
  sidecarDir?: string;
}

// ── Public API ──────────────────────────────────────────────────────

export function parseNodeTreeText(
  text: string,
  mainJsonlPath: string,
  options: ParseNodeTreeOptions = {},
): ParseNodeTreeResult {
  const records: RawRecord[] = [];
  let parseFailures = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const r = parseLine(line);
    if (r) records.push(r);
    else parseFailures += 1;
  }
  const tree = buildNodeTree(records, mainJsonlPath, options);
  return { tree, parseFailures };
}

export async function parseNodeTreeFile(
  jsonlPath: string,
  options: ParseNodeTreeOptions = {},
): Promise<ParseNodeTreeResult> {
  const records: RawRecord[] = [];
  let parseFailures = 0;
  const stream = fs.createReadStream(jsonlPath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    const r = parseLine(line);
    if (r) records.push(r);
    else parseFailures += 1;
  }
  const tree = buildNodeTree(records, jsonlPath, options);
  return { tree, parseFailures };
}

// ── Core builder ────────────────────────────────────────────────────

export function buildNodeTree(
  records: RawRecord[],
  mainJsonlPath: string,
  options: ParseNodeTreeOptions = {},
): NodeTree {
  const sidecarDir =
    options.sidecarDir ??
    (mainJsonlPath.endsWith(".jsonl")
      ? mainJsonlPath.slice(0, -".jsonl".length)
      : path.join(path.dirname(mainJsonlPath), path.basename(mainJsonlPath, ".jsonl")));

  const indexByUuid = new Map<string, IndexedRecord>();
  const boundariesByUuid = new Map<string, RawRecord>();
  const awaySummaryByUuid = new Map<string, RawRecord>();
  const scheduledFireByUuid = new Map<string, RawRecord>();
  const scheduleWakeupToolUseIds = new Set<string>();

  let sessionId: string | undefined;
  let cwd: string | undefined;
  let gitBranch: string | undefined;
  let createdAt: string | undefined;
  let lastUpdatedAt: string | undefined;

  for (const r of records) {
    if (r.uuid) {
      indexByUuid.set(r.uuid, {
        uuid: r.uuid,
        parentUuid: r.parentUuid ?? null,
        logicalParentUuid: r.logicalParentUuid ?? null,
        type: r.type,
        subtype: r.subtype,
        promptId: r.promptId,
        isCompactSummary: r.isCompactSummary,
        timestamp: r.timestamp,
      });
    }
    if (r.sessionId && !sessionId) sessionId = r.sessionId;
    if (r.cwd && !cwd) cwd = r.cwd;
    if (r.gitBranch && !gitBranch) gitBranch = r.gitBranch;
    if (r.timestamp) {
      if (!createdAt || r.timestamp < createdAt) createdAt = r.timestamp;
      if (!lastUpdatedAt || r.timestamp > lastUpdatedAt) lastUpdatedAt = r.timestamp;
    }
    if (r.type === "system") {
      if (r.subtype === "compact_boundary" && r.uuid) boundariesByUuid.set(r.uuid, r);
      else if (r.subtype === "away_summary" && r.uuid) awaySummaryByUuid.set(r.uuid, r);
      else if (r.subtype === "scheduled_task_fire" && r.uuid) scheduledFireByUuid.set(r.uuid, r);
    }
    if (r.type === "assistant") {
      for (const b of blocksOf(r)) {
        if (b.type === "tool_use" && (b as { name?: string }).name === "ScheduleWakeup") {
          const id = (b as { id?: string }).id;
          if (id) scheduleWakeupToolUseIds.add(id);
        }
      }
    }
  }

  // Bucket by promptId (inherit via parentUuid hop, with compact_boundary
  // logicalParentUuid hop). Same logic as v0.1; preserves all invariants.
  const bucketsByPid = new Map<string, PromptBucket>();
  const orphans: OrphanRecord[] = [];
  const flowEvents: FlowEvent[] = [];

  const inheritedPromptId = new Map<string, string | null>();
  const resolvePromptId = (uuid: string | null | undefined): string | null => {
    if (!uuid) return null;
    if (inheritedPromptId.has(uuid)) return inheritedPromptId.get(uuid) ?? null;
    inheritedPromptId.set(uuid, null);
    const node = indexByUuid.get(uuid);
    if (!node) return null;
    let resolved: string | null = node.promptId ?? null;
    if (!resolved) {
      const next =
        node.type === "system" &&
        node.subtype === "compact_boundary" &&
        !node.parentUuid &&
        node.logicalParentUuid
          ? node.logicalParentUuid
          : node.parentUuid;
      resolved = resolvePromptId(next);
    }
    inheritedPromptId.set(uuid, resolved);
    return resolved;
  };

  const promptIdOf = (r: RawRecord): string | null => {
    if (r.promptId) return r.promptId;
    if (r.type === "user") return null;
    return resolvePromptId(r.parentUuid ?? null);
  };

  for (const r of records) {
    if (r.isMeta && !r.isCompactSummary && r.type !== "user") continue;
    if (SKIP_TYPES.has(r.type)) continue;

    if (r.type === "system") {
      if (r.subtype === "scheduled_task_fire") {
        flowEvents.push({
          type: "scheduled_task_fire",
          uuid: r.uuid,
          timestamp: r.timestamp,
          data: { content: r.content, parentUuid: r.parentUuid },
        });
        continue;
      }
      if (r.subtype === "compact_boundary") continue;
      if (r.subtype === "away_summary") continue;
      if (r.subtype === "bridge_status" || r.subtype === "informational") continue;
      if (r.subtype === "local_command") {
        flowEvents.push({
          type: "local_command",
          uuid: r.uuid,
          timestamp: r.timestamp,
          data: r.content,
        });
        continue;
      }
    }

    const pid = promptIdOf(r);
    if (pid) {
      let bucket = bucketsByPid.get(pid);
      if (!bucket) {
        bucket = { promptId: pid, records: [] };
        bucketsByPid.set(pid, bucket);
      }
      bucket.records.push(r);
      continue;
    }

    if (r.type === "system") {
      orphans.push({
        uuid: r.uuid,
        type: r.subtype ? `system/${r.subtype}` : "system",
        reason: "no promptId reachable",
      });
      continue;
    }
    if (r.type === "permission-mode") {
      flowEvents.push({
        type: "permission_mode",
        uuid: r.uuid,
        timestamp: r.timestamp,
        data: { permissionMode: r.permissionMode },
      });
      continue;
    }
    if (r.type === "file-history-snapshot") {
      orphans.push({
        uuid: r.uuid,
        type: "file-history-snapshot",
        reason: "no promptId",
      });
      continue;
    }
    orphans.push({
      uuid: r.uuid,
      type: r.type + (r.subtype ? `/${r.subtype}` : ""),
      reason: "no promptId",
    });
  }

  // Per-bucket build of the turn's Node subtree.
  const nodes = new Map<string, Node>();
  const turnRoots: Node[] = []; // user_message nodes per bucket — used for cross-bucket linking

  for (const bucket of bucketsByPid.values()) {
    const built = buildTurnNodes(
      bucket,
      indexByUuid,
      boundariesByUuid,
      awaySummaryByUuid,
      scheduledFireByUuid,
      records,
    );
    if (!built) continue;
    for (const n of built.nodes) {
      nodes.set(n.id, n);
    }
    turnRoots.push(built.turnRoot);
  }

  // Sort turn roots by timestamp for stable ordering.
  turnRoots.sort((a, b) => {
    const ta = a.timestamp ?? "";
    const tb = b.timestamp ?? "";
    if (ta === tb) return a.id.localeCompare(b.id);
    return ta < tb ? -1 : 1;
  });

  // Precompute terminal assistant per promptId — the cross-bucket
  // linker calls this O(N_turnRoots) times, and walking ``nodes`` per
  // call would be O(N²) over total node count (91M iterations on the
  // 256MB session = ~1.5s just for this loop). One pass keeps it O(N).
  const terminalAssistantByPromptId = new Map<string, string>();
  const terminalAssistantTsByPromptId = new Map<string, string>();
  for (const n of nodes.values()) {
    if (n.kind !== "assistant_call" || !n.promptId) continue;
    const ts = n.timestamp ?? "";
    const prevTs = terminalAssistantTsByPromptId.get(n.promptId);
    if (prevTs == null || ts > prevTs) {
      terminalAssistantByPromptId.set(n.promptId, n.id);
      terminalAssistantTsByPromptId.set(n.promptId, ts);
    }
  }

  // Cross-bucket parent linking: each turn root's parentId points at the
  // prior turn's last assistant_call (or compact ancestor via logical
  // parent hop). Same backwalk logic as v0.1's linkChatNodeParents but
  // resolved against the unified Node id space.
  linkTurnRoots(turnRoots, indexByUuid, terminalAssistantByPromptId);

  // Scheduled trigger source resolution (workNodeId = the ScheduleWakeup
  // tool_use that caused the fire, by timestamp heuristic).
  for (const root of turnRoots) {
    if (root.trigger !== "scheduled" || !root.triggerSource) continue;
    // Already set by buildTurnNodes when a fire ancestor was found;
    // nothing to do here.
    void root;
  }

  // Compute root ids + children index in one final pass.
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
  // Sort root list by turn timestamp (matches turnRoots ordering above).
  const rootOrder = new Map(turnRoots.map((n, i) => [n.id, i]));
  rootNodeIds.sort((a, b) => (rootOrder.get(a) ?? 0) - (rootOrder.get(b) ?? 0));
  // Sort each child list by timestamp + uuid (deterministic).
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

  // Aggregate computation runs after children are indexed so we can
  // walk turn-root → descendants once.
  for (const root of turnRoots) {
    root.aggregate = computeAggregate(root, nodes, childrenByParent);
  }

  return {
    id: sessionId ?? "",
    mainJsonlPath,
    sidecarDir,
    cwd,
    gitBranch,
    createdAt,
    lastUpdatedAt,
    trigger: "user",
    rootNodeIds,
    nodes,
    childrenByParent,
    orphans,
    flowEvents,
  };
}

// ── Per-turn build ──────────────────────────────────────────────────

interface TurnBuildResult {
  turnRoot: Node;
  nodes: Node[];
}

function buildTurnNodes(
  bucket: PromptBucket,
  index: Map<string, IndexedRecord>,
  boundariesByUuid: Map<string, RawRecord>,
  awaySummaryByUuid: Map<string, RawRecord>,
  scheduledFireByUuid: Map<string, RawRecord>,
  // ALL records (not just bucket records) — required for the
  // ScheduleWakeup ancestor lookup, since the tool_use that caused
  // the fire lives in the previous turn's bucket.
  allRecords: RawRecord[],
): TurnBuildResult | null {
  // Pick root user record (preference: non-meta > meta > compactSummary).
  let nonMetaUser: RawRecord | undefined;
  let metaUser: RawRecord | undefined;
  let compactUser: RawRecord | undefined;
  for (const r of bucket.records) {
    if (r.type !== "user") continue;
    if (isToolResultRecord(r)) continue;
    if (r.isCompactSummary) {
      compactUser ??= r;
      continue;
    }
    if (r.isMeta) {
      metaUser ??= r;
      continue;
    }
    nonMetaUser ??= r;
  }
  const rootUser = nonMetaUser ?? metaUser ?? compactUser;
  if (!rootUser) return null;

  const rootUserUuid = rootUser.uuid ?? "";
  const isCompactBucket = !!compactUser;
  const allNodes: Node[] = [];

  // Trigger / awaySummary detection (walk parentUuid back across system
  // ancestors). Same heuristic as v0.1.
  let trigger: ChatNodeTrigger = "user";
  let scheduledFireUuid: string | undefined;
  let awaySummaryAttached: { uuid: string; content: string; timestamp?: string } | undefined;
  let cursor: string | null = rootUser.parentUuid ?? null;
  let hops = 0;
  while (cursor && hops < 20) {
    const ancestor = index.get(cursor);
    if (!ancestor) break;
    if (ancestor.type === "system" && ancestor.subtype === "scheduled_task_fire") {
      trigger = "scheduled";
      scheduledFireUuid = ancestor.uuid;
      cursor = ancestor.parentUuid;
    } else if (ancestor.type === "system" && ancestor.subtype === "away_summary") {
      const rec = awaySummaryByUuid.get(ancestor.uuid);
      if (rec) {
        awaySummaryAttached = {
          uuid: ancestor.uuid,
          content: typeof rec.content === "string" ? rec.content : "",
          timestamp: rec.timestamp,
        };
      }
      cursor = ancestor.parentUuid;
    } else {
      break;
    }
    hops += 1;
  }
  if (rootUser.parentUuid && scheduledFireByUuid.has(rootUser.parentUuid)) {
    scheduledFireUuid = rootUser.parentUuid;
    trigger = "scheduled";
  }

  // Inline attachments preview (same subset as v0.1: file /
  // edited_text_file / queued_command on the user_message itself for
  // quick badging — full attachment Nodes are emitted below).
  const attachmentsInline: Array<{ uuid: string; type: string; raw: unknown }> = [];
  const fileHistorySnapshotUuids: string[] = [];
  const permissionModeChanges: Array<{ uuid: string; permissionMode: string }> = [];
  for (const r of bucket.records) {
    if (r.type === "attachment") {
      const a = r.attachment;
      if (a && typeof a.type === "string") {
        if (a.type === "file" || a.type === "edited_text_file" || a.type === "queued_command") {
          attachmentsInline.push({
            uuid: r.uuid ?? "",
            type: a.type,
            raw: r.attachment,
          });
        }
      }
    } else if (r.type === "file-history-snapshot" && r.uuid) {
      fileHistorySnapshotUuids.push(r.uuid);
    } else if (r.type === "permission-mode" && r.uuid && typeof r.permissionMode === "string") {
      permissionModeChanges.push({ uuid: r.uuid, permissionMode: r.permissionMode });
    }
  }

  const slashCommand = detectSlashCommand(bucket.records);

  // Compact pairing — for compact-anchored buckets, the turn root is
  // emitted as kind=compact (unfolded by default), not user_message.
  let turnKind: NodeKind = "user_message";
  let boundaryRec: RawRecord | undefined;
  if (isCompactBucket && compactUser) {
    turnKind = "compact";
    const pUuid = compactUser.parentUuid ?? "";
    boundaryRec = boundariesByUuid.get(pUuid);
  }

  // Build the turn root node.
  const turnRoot: Node = {
    id: rootUserUuid,
    parentId: null, // filled in cross-bucket linking
    kind: turnKind,
    uuid: rootUserUuid,
    timestamp: rootUser.timestamp,
    promptId: bucket.promptId,
    role: "user",
    content: rootUser.message?.content ?? rootUser.content ?? "",
    attachments: attachmentsInline.length ? attachmentsInline : undefined,
    slashCommand,
    awaySummary: awaySummaryAttached,
    trigger,
    triggerSource: undefined, // resolved later if scheduled
    fileHistorySnapshotUuids: fileHistorySnapshotUuids.length
      ? fileHistorySnapshotUuids
      : undefined,
    permissionModeChanges: permissionModeChanges.length ? permissionModeChanges : undefined,
    // Per抉择 1 选项 A: every Node defaults to ``children hidden``.
    // The turn root's CARD is always visible (carve-out in
    // ``layoutNodes``), but its children — assistant_call /
    // tool_call / delegate / attachment — only show on explicit
    // expand. ``defaultFolded`` is about children visibility, not
    // about whether this node's own card renders.
    defaultFolded: true,
    isTurnRoot: true,
  };

  // Compact-specific fields on the turn root.
  if (turnKind === "compact" && compactUser) {
    const meta = boundaryRec?.compactMetadata ?? compactUser.compactMetadata;
    turnRoot.boundaryUuid = boundaryRec?.uuid;
    turnRoot.logicalParentUuid =
      boundaryRec?.logicalParentUuid ?? compactUser.logicalParentUuid ?? undefined;
    turnRoot.compactTrigger = meta?.trigger;
    turnRoot.preTokens = typeof meta?.preTokens === "number" ? meta.preTokens : undefined;
    turnRoot.preCompactDiscoveredTools = meta?.preCompactDiscoveredTools;
    turnRoot.summaryText =
      typeof compactUser.message?.content === "string" ? compactUser.message.content : "";
    turnRoot.isCompactSummary = true;
  }
  allNodes.push(turnRoot);

  // Children: assistant_call nodes (each with their tool_use children).
  // Parent resolution: each assistant_call's parentId starts at the
  // turn root, but if the raw parentUuid points at a prior assistant
  // / tool_result inside this bucket we use that for tree fidelity.
  const assistantToToolUses = new Map<string, string[]>();
  const toolUseToResult = new Map<string, RawRecord>();
  const toolUseBlocks = new Map<
    string,
    { block: InnerToolUseBlock; assistantUuid: string }
  >();
  for (const r of bucket.records) {
    if (r.type === "assistant" && r.uuid) {
      const tuIds: string[] = [];
      for (const b of blocksOf(r)) {
        if (b.type === "tool_use") {
          const tu = b as InnerToolUseBlock;
          tuIds.push(tu.id);
          toolUseBlocks.set(tu.id, { block: tu, assistantUuid: r.uuid });
        }
      }
      if (tuIds.length) assistantToToolUses.set(r.uuid, tuIds);
    } else if (isToolResultRecord(r)) {
      const blk = extractToolResultBlock(r);
      if (blk?.tool_use_id) toolUseToResult.set(blk.tool_use_id, r);
    }
  }

  // Build assistant_call + tool_call/delegate children. Parent resolution:
  //   - assistant.parentUuid points at the prior tool_result user record
  //     (for follow-up assistants in a tool loop) or the user_message
  //     itself (for the first assistant in a turn). user records carrying
  //     tool_results aren't Nodes themselves; we rewrite parentId to the
  //     owning tool_call/delegate node so the tree stays connected.
  //   - tool_use blocks are children of their owning assistant_call.
  const seenToolUses = new Set<string>();
  for (const r of bucket.records) {
    if (r.type !== "assistant") continue;
    const llm = buildAssistantCall(r);
    // Parent: for the first assistant in this turn, the user_message;
    // for follow-ups, the most-recent tool_call/delegate Node (resolved
    // by walking parentUuid through the tool_result user record).
    llm.parentId = resolveAssistantParent(
      r.parentUuid ?? null,
      rootUserUuid,
      toolUseToResult,
      // We need a forward-pass map from tool_result user uuid → owning
      // tool_use id. Build it inline for clarity.
      buildResultUserToToolId(toolUseToResult),
    );
    allNodes.push(llm);

    // Tool-use children.
    const tuIds = assistantToToolUses.get(r.uuid ?? "") ?? [];
    for (const tuId of tuIds) {
      if (seenToolUses.has(tuId)) continue;
      seenToolUses.add(tuId);
      const child = buildToolCallOrDelegate(tuId, toolUseBlocks, toolUseToResult);
      if (!child) continue;
      child.parentId = llm.id;
      allNodes.push(child);
    }
  }

  // Inner-bucket compact records (rare — usually compact has its own
  // promptId so the bucket _is_ the compact ChatNode). When present,
  // emit each as a child of the turn root with #N dup suffix.
  let dupSuffix = 0;
  for (const r of bucket.records) {
    if (r.type !== "user") continue;
    if (!r.isCompactSummary) continue;
    if (compactUser && r === compactUser) continue; // already the turn root for this bucket
    const id = r.uuid ?? "";
    let nodeId = id;
    if (allNodes.some((n) => n.id === nodeId)) {
      dupSuffix += 1;
      nodeId = `${id}#${dupSuffix}`;
    }
    const meta = r.compactMetadata;
    allNodes.push({
      id: nodeId,
      parentId: rootUserUuid,
      kind: "compact",
      uuid: r.uuid,
      timestamp: r.timestamp,
      promptId: bucket.promptId,
      role: "user",
      isCompactSummary: true,
      logicalParentUuid: r.logicalParentUuid ?? undefined,
      compactTrigger: meta?.trigger,
      preTokens: typeof meta?.preTokens === "number" ? meta.preTokens : undefined,
      preCompactDiscoveredTools: meta?.preCompactDiscoveredTools,
      summaryText:
        typeof r.message?.content === "string" ? r.message.content : "",
      defaultFolded: true,
    });
  }

  // Attachment children (full attachment Nodes — distinct from the
  // ``attachmentsInline`` quick-badge subset on user_message).
  for (const r of bucket.records) {
    if (r.type !== "attachment") continue;
    const a = r.attachment;
    if (!a || typeof a.type !== "string") continue;
    if (!ATTACHMENT_RENDER_TYPES.has(a.type)) continue;
    allNodes.push({
      id: r.uuid ?? "",
      parentId: rootUserUuid,
      kind: "attachment",
      uuid: r.uuid,
      timestamp: r.timestamp,
      promptId: bucket.promptId,
      attachmentType: a.type,
      attachmentRaw: r.attachment,
      defaultFolded: true,
    });
  }

  // Resolve scheduled trigger source on the turn root (most-recent
  // ScheduleWakeup tool_use before this turn's fire timestamp). The
  // tool_use lives in the previous turn's bucket, so we scan ALL
  // session records here, not just this bucket.
  if (trigger === "scheduled" && scheduledFireUuid) {
    const wid = findScheduleWakeupAncestor(scheduledFireUuid, index, allRecords);
    if (wid) {
      turnRoot.triggerSource = { workNodeId: wid };
    }
  }

  return { turnRoot, nodes: allNodes };
}

function buildAssistantCall(r: RawRecord): Node {
  const thinking: ThinkingBlock[] = [];
  const textParts: string[] = [];
  for (const b of blocksOf(r)) {
    if (b.type === "thinking") {
      thinking.push({
        text: typeof b.thinking === "string" ? b.thinking : "",
        signature: typeof b.signature === "string" ? b.signature : undefined,
      });
    } else if (b.type === "text") {
      const txt = (b as { text?: unknown }).text;
      if (typeof txt === "string") textParts.push(txt);
    }
  }
  return {
    id: r.uuid ?? "",
    parentId: null, // filled by caller
    kind: "assistant_call",
    uuid: r.uuid,
    timestamp: r.timestamp,
    promptId: r.promptId,
    role: "assistant",
    text: textParts.join(""),
    thinking,
    model: r.message?.model,
    stopReason: r.message?.stop_reason,
    usage: r.message?.usage,
    requestId: r.requestId,
    defaultFolded: true,
  };
}

function buildToolCallOrDelegate(
  toolUseId: string,
  toolUseBlocks: Map<string, { block: InnerToolUseBlock; assistantUuid: string }>,
  toolUseToResult: Map<string, RawRecord>,
): Node | null {
  const entry = toolUseBlocks.get(toolUseId);
  if (!entry) return null;
  const { block, assistantUuid } = entry;
  const resultRec = toolUseToResult.get(toolUseId);
  const resultBlock = resultRec ? extractToolResultBlock(resultRec) : null;
  const tur = resultRec?.toolUseResult as Record<string, unknown> | undefined;
  const isError =
    (resultBlock?.is_error === true) ||
    (typeof tur?.["status"] === "string" && tur["status"] === "failed");

  if (DELEGATE_TOOL_NAMES.has(block.name)) {
    const input = (block.input ?? {}) as Record<string, unknown>;
    return {
      id: block.id,
      parentId: null, // filled by caller
      kind: "delegate",
      uuid: assistantUuid,
      timestamp: resultRec?.timestamp,
      toolName: block.name,
      description: typeof input.description === "string" ? input.description : undefined,
      prompt: typeof input.prompt === "string" ? input.prompt : undefined,
      agentType:
        typeof tur?.["agentType"] === "string"
          ? (tur["agentType"] as string)
          : typeof input["subagent_type"] === "string"
            ? (input["subagent_type"] as string)
            : undefined,
      agentId: typeof tur?.["agentId"] === "string" ? (tur["agentId"] as string) : undefined,
      toolResultUserUuid: resultRec?.uuid,
      toolResultBlock: resultBlock ?? undefined,
      toolUseResult: tur,
      status: typeof tur?.["status"] === "string" ? (tur["status"] as string) : undefined,
      delegateContent: typeof tur?.["content"] === "string" ? (tur["content"] as string) : undefined,
      totalDurationMs: numeric(tur?.["totalDurationMs"]),
      totalTokens: numeric(tur?.["totalTokens"]),
      totalToolUseCount: numeric(tur?.["totalToolUseCount"]),
      delegateUsage: (tur?.["usage"] as Record<string, unknown>) ?? undefined,
      toolStats: (tur?.["toolStats"] as Record<string, unknown>) ?? undefined,
      isError,
      defaultFolded: true,
    };
  }
  return {
    id: block.id,
    parentId: null,
    kind: "tool_call",
    uuid: assistantUuid,
    timestamp: resultRec?.timestamp,
    toolName: block.name,
    toolInput: block.input,
    toolResultUserUuid: resultRec?.uuid,
    toolResultBlock: resultBlock ?? undefined,
    toolUseResult: tur,
    isError,
    defaultFolded: true,
  };
}

function numeric(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

// Build a forward map from tool_result user record uuid → owning
// tool_use id. Used to rewrite assistant.parentUuid (which points at
// the user record) to the owning tool_call Node id.
function buildResultUserToToolId(
  toolUseToResult: Map<string, RawRecord>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const [tuId, r] of toolUseToResult) {
    if (r.uuid) out.set(r.uuid, tuId);
  }
  return out;
}

// Resolve parentId for an assistant_call. The raw parentUuid usually
// points at either:
//   (a) the user record carrying a tool_result (= follow-up assistant
//       in a tool loop) — rewrite to the owning tool_call Node id
//   (b) the user_message itself (= first assistant in a turn) — keep
//       as the turn root id
//   (c) something outside this bucket — fall through to the turn root
//       (defensive; shouldn't happen for well-formed jsonl)
function resolveAssistantParent(
  parentUuid: string | null,
  turnRootUuid: string,
  toolUseToResult: Map<string, RawRecord>,
  resultUserToToolId: Map<string, string>,
): string {
  if (!parentUuid) return turnRootUuid;
  // Direct hit on a tool_result user record → its owning tool_call.
  const owningTool = resultUserToToolId.get(parentUuid);
  if (owningTool) return owningTool;
  // Direct hit on the turn root user message.
  if (parentUuid === turnRootUuid) return turnRootUuid;
  // Direct hit on a known tool_result via toolUseToResult — extra
  // lookup avoids missing edges when uuid maps differ.
  for (const r of toolUseToResult.values()) {
    if (r.uuid === parentUuid) {
      const blk = extractToolResultBlock(r);
      if (blk?.tool_use_id) return blk.tool_use_id;
    }
  }
  return turnRootUuid;
}

// Sort turnRoots in cross-bucket order, then walk each turn root's
// parentUuid backwards to find the previous turn (across non-prompt
// records and compact_boundary logicalParentUuid hops). Same algorithm
// as v0.1's linkChatNodeParents but resolves to Node ids.
function linkTurnRoots(
  turnRoots: Node[],
  index: Map<string, IndexedRecord>,
  terminalAssistantByPromptId: Map<string, string>,
): void {
  const userUuidToTurnRootId = new Map<string, string>();
  const turnRootByPromptId = new Map<string, Node>();
  for (const root of turnRoots) {
    userUuidToTurnRootId.set(root.uuid ?? root.id, root.id);
    if (root.promptId) turnRootByPromptId.set(root.promptId, root);
  }
  for (const root of turnRoots) {
    const ancestor0 = index.get(root.uuid ?? root.id);
    if (!ancestor0) continue;
    let cursor: string | null = ancestor0.parentUuid;
    let hops = 0;
    while (cursor && hops < 200) {
      const ancestorIdx = index.get(cursor);
      if (!ancestorIdx) break;
      // Hit another turn root → that's the parent. Prefer the prior
      // turn's terminal assistant_call (so the cross-turn arrow lands
      // on the most recent visible step) and fall back to the turn
      // root itself.
      const otherRootId = userUuidToTurnRootId.get(cursor);
      if (otherRootId && otherRootId !== root.id) {
        const prevRoot = turnRoots.find((t) => t.id === otherRootId);
        const terminal =
          prevRoot?.promptId && terminalAssistantByPromptId.get(prevRoot.promptId);
        root.parentId = terminal ?? otherRootId;
        break;
      }
      // compact_boundary hop.
      if (
        ancestorIdx.type === "system" &&
        ancestorIdx.subtype === "compact_boundary" &&
        !ancestorIdx.parentUuid &&
        ancestorIdx.logicalParentUuid
      ) {
        cursor = ancestorIdx.logicalParentUuid;
        hops += 1;
        continue;
      }
      // Hit any record whose promptId belongs to a different turn —
      // resolve via that turn's terminal assistant.
      if (ancestorIdx.promptId && ancestorIdx.promptId !== root.promptId) {
        const target = turnRootByPromptId.get(ancestorIdx.promptId);
        if (target) {
          const terminal = terminalAssistantByPromptId.get(ancestorIdx.promptId);
          root.parentId = terminal ?? target.id;
          break;
        }
      }
      cursor = ancestorIdx.parentUuid;
      hops += 1;
    }
  }
}

// (findLastAssistantInTurn removed — replaced by the
// ``terminalAssistantByPromptId`` precomputed map in buildNodeTree. The
// O(N) per-call scan was the M1 perf bottleneck on the 256MB session.)

// Aggregate computation: walk all descendants of the turn root and
// accumulate counts + token bar inputs. Mirrors what
// ``layoutDag.deriveCardData`` did in v0.5 so the M5 NodeCard for
// folded turn roots renders an identical chrome.
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
  // BFS over descendants — but stop at turn boundaries. After
  // cross-bucket linking, the next turn's user_message / compact may
  // sit under THIS turn's terminal assistant (so a continuation arrow
  // can connect them). Walking past that boundary would let us count
  // the next turn's assistants and overwrite lastAssistant with a
  // later-timestamp one from a different turn.
  const stack: string[] = [root.id];
  while (stack.length) {
    const id = stack.pop()!;
    const children = childrenByParent.get(id);
    if (!children) continue;
    for (const cid of children) {
      const c = nodes.get(cid);
      if (!c) continue;
      // Don't cross into a different turn's subtree.
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
  const assistantPreview = previewAssistantText(lastAssistant?.text ?? "");
  const usage = (lastAssistant?.usage ?? {}) as Record<string, unknown>;
  const num = (k: string): number =>
    typeof usage[k] === "number" ? (usage[k] as number) : 0;
  const contextTokens =
    num("input_tokens") + num("cache_creation_input_tokens") + num("cache_read_input_tokens");
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

function previewAssistantText(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= 80) return trimmed;
  return trimmed.slice(0, 79) + "…";
}

function detectSlashCommand(records: RawRecord[]): SlashCommandInfo | undefined {
  let name: string | undefined;
  let args: string | undefined;
  let stdout: string | undefined;
  for (const r of records) {
    if (r.type !== "user") continue;
    const c = r.message?.content;
    if (typeof c !== "string") continue;
    if (!name) {
      const m = c.match(/<command-name>([^<]*)<\/command-name>/);
      if (m) {
        name = m[1].trim();
        const a = c.match(/<command-args>([^<]*)<\/command-args>/);
        if (a) args = a[1].trim();
      }
    }
    if (!stdout) {
      const so = c.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/);
      if (so) stdout = stripAnsi(so[1]).trim();
    }
  }
  if (!name) return undefined;
  return { name, args: args || undefined, stdout: stdout || undefined };
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

function findScheduleWakeupAncestor(
  fireUuid: string,
  index: Map<string, IndexedRecord>,
  records: RawRecord[],
): string | undefined {
  const fire = index.get(fireUuid);
  if (!fire?.timestamp) return undefined;
  let bestId: string | undefined;
  let bestTs = "";
  for (const r of records) {
    if (r.type !== "assistant" || !r.timestamp) continue;
    if (r.timestamp >= fire.timestamp) continue;
    for (const b of blocksOf(r)) {
      if (b.type !== "tool_use") continue;
      const tu = b as { id?: string; name?: string };
      if (tu.name !== "ScheduleWakeup" || !tu.id) continue;
      if (r.timestamp > bestTs) {
        bestTs = r.timestamp;
        bestId = tu.id;
      }
    }
  }
  return bestId;
}

// ─── Convenience aggregate stats (used by tests / scripts) ──────────

export interface NodeTreeStats {
  totalNodes: number;
  turnRoots: number;
  llmCallCount: number;
  toolCallCount: number;
  delegateCount: number;
  compactCount: number;
  attachmentCount: number;
}

export function nodeTreeStats(tree: NodeTree): NodeTreeStats {
  let llmCallCount = 0;
  let toolCallCount = 0;
  let delegateCount = 0;
  let compactCount = 0;
  let attachmentCount = 0;
  // Turn root = a node that owns its own promptId bucket. After
  // cross-bucket linking compact turn roots get re-parented (their
  // logicalParentUuid hop lands on the prior turn's terminal
  // assistant), so we can't filter by parentId == null. Use promptId
  // membership against ``childrenByParent`` heuristic: a node is a
  // turn root when its kind is user_message OR (compact AND
  // !isCompactSummary already counted as inner-bucket dup).
  // Simpler and correct: count user_message + compact-with-promptId
  // since inner-bucket dup compacts have a #N suffix on id but still
  // share the same promptId — exclude those by id-shape check.
  for (const n of tree.nodes.values()) {
    switch (n.kind) {
      case "user_message":
        break;
      case "compact":
        compactCount += 1;
        break;
      case "assistant_call":
        llmCallCount += 1;
        break;
      case "tool_call":
        toolCallCount += 1;
        break;
      case "delegate":
        delegateCount += 1;
        break;
      case "attachment":
        attachmentCount += 1;
        break;
    }
  }
  // Turn roots — count via the explicit ``isTurnRoot`` flag set by
  // buildTurnNodes. Independent of dup-suffix string heuristics; works
  // for the rare "compact dup with unique uuid" case (5/139 in real
  // data) without false positives.
  let turnRoots = 0;
  for (const n of tree.nodes.values()) {
    if (n.isTurnRoot) turnRoots += 1;
  }
  return {
    totalNodes: tree.nodes.size,
    turnRoots,
    llmCallCount,
    toolCallCount,
    delegateCount,
    compactCount,
    attachmentCount,
  };
}

// `WorkNodeError` is referenced by the Node type; re-export so future
// consumers don't need to dig into legacy types.ts directly.
export type { WorkNodeError };
