// Core data model for Loomscope.
//
// **v0.6 in progress** — the legacy two-layer model
//   ChatFlow → ChatNode[] → WorkFlow → WorkNode[]
// is being collapsed into a single recursive ``Node`` tree (see
// ``src/parse/nodeTree.ts`` and the new types at the bottom of this
// file). Until M7 finishes the migration, both shapes coexist:
//   - Legacy types still drive store / canvas / components (untouched).
//   - The unified ``Node`` model is the new source of truth and feeds
//     M2-M7 consumers as we migrate them milestone by milestone.
//
// The legacy section keeps its v0.1-v0.5 shape exactly so M1 ships
// without breaking 227 existing tests. Once M7 lands, the legacy
// section gets deleted in one final cleanup commit.
//
// Spec: docs/design-data-model.md
// EdgeKind v0 renders the first 3; the remaining 5 are schema-only stubs.

export type EdgeKind =
  | "continuation" // v0
  | "spawn" // v0
  | "logical" // v0 (compact_boundary.logicalParentUuid → pre-compact tail)
  | "aggregation" // v0.5+ (brief / pack / sub-agent toolStats)
  | "retry" // v0.1 — pending retry-chain investigation
  | "reference" // v∞
  | "external_trigger" // v∞ (hook / external daemon)
  | "interruption"; // pending interruption-event investigation

export type WorkNodeKind =
  | "llm_call"
  | "tool_call"
  | "delegate"
  | "compact"
  | "attachment";

export type ChatNodeTrigger = "user" | "scheduled";
export type ChatFlowTrigger = "user" | "cron-fired";

export interface Edge {
  from: string;
  to: string;
  kind: EdgeKind;
}

// ─── WorkFlow layer ──────────────────────────────────────────────────────────

export interface ThinkingBlock {
  text: string;
  signature?: string;
}

export interface LlmCallNode {
  id: string; // assistant record uuid
  kind: "llm_call";
  parentUuid: string | null;
  requestId?: string;
  model?: string;
  text: string; // joined text blocks (often "")
  thinking: ThinkingBlock[];
  stopReason?: string;
  usage?: Record<string, unknown>;
  timestamp?: string;
  errors?: WorkNodeError[];
}

export interface ToolCallNode {
  id: string; // tool_use block id (toolu_…)
  kind: "tool_call";
  parentUuid: string | null; // assistant record uuid that owned the block
  toolName: string;
  input: unknown;
  resultUserUuid?: string; // user record carrying the matching tool_result
  resultBlock?: unknown; // raw `tool_result` block
  toolUseResult?: unknown; // raw record-level toolUseResult
  isError?: boolean;
  durationMs?: number;
  timestamp?: string;
}

export interface DelegateNode {
  id: string; // tool_use block id
  kind: "delegate";
  parentUuid: string | null;
  toolName: "Agent" | "Task" | string;
  agentType?: string; // from tool_result toolUseResult.agentType
  agentId?: string; // join key to sidecar `subagents/agent-<agentId>.jsonl`
  description?: string;
  prompt?: string;
  resultUserUuid?: string;
  status?: "completed" | "failed" | string;
  content?: string;
  totalDurationMs?: number;
  totalTokens?: number;
  totalToolUseCount?: number;
  usage?: Record<string, unknown>;
  toolStats?: Record<string, unknown>;
  toolUseResult?: unknown;
  isError?: boolean;
  timestamp?: string;
}

export interface CompactNode {
  id: string; // user record uuid (the one with isCompactSummary=true)
  kind: "compact";
  parentUuid: string | null;
  boundaryUuid?: string; // matching system/compact_boundary uuid
  logicalParentUuid?: string; // pre-compact tail
  trigger?: "auto" | "manual" | string;
  preTokens?: number;
  preCompactDiscoveredTools?: unknown;
  summaryText: string; // raw summary content
  timestamp?: string;
}

export interface AttachmentNode {
  id: string; // attachment record uuid
  kind: "attachment";
  parentUuid: string | null;
  attachmentType: string;
  raw: unknown;
  timestamp?: string;
}

export type WorkNode =
  | LlmCallNode
  | ToolCallNode
  | DelegateNode
  | CompactNode
  | AttachmentNode;

export interface WorkNodeError {
  type: string;
  message?: string;
}

export interface WorkFlow {
  nodes: WorkNode[];
  edges: Edge[];
}

// ─── ChatNode layer ──────────────────────────────────────────────────────────

export interface ChatNodeUserMessage {
  uuid: string;
  content: unknown; // string or block[] — preserved as-is
  timestamp?: string;
  attachments: AttachmentNode[];
}

export interface ChatNodeMeta {
  awaySummary?: { uuid: string; content: string; timestamp?: string };
  scheduledFireUuid?: string; // system/scheduled_task_fire uuid linked to this ChatNode
  fileHistorySnapshotUuids?: string[];
  permissionModeChanges?: Array<{ uuid: string; permissionMode: string }>;
  errors?: WorkNodeError[];
}

// CC slash-command invocation (e.g. /model, /compact, /cost) does NOT go
// through the LLM — CC handles it locally. Buckets as a single ChatNode
// with no assistant turn and three user records sharing one promptId:
//   #1 isMeta=true: <local-command-caveat>System note</local-command-caveat>
//   #2: <command-name>/NAME</command-name><command-args>ARGS</command-args>...
//   #3: <local-command-stdout>OUTPUT</local-command-stdout>
// Parser extracts the structured form into this field.
export interface SlashCommandInfo {
  name: string; // e.g. "/model" (with leading slash)
  args?: string; // contents of <command-args>; "" or undefined when none
  stdout?: string; // contents of <local-command-stdout>; ANSI escapes stripped
}

export interface ChatNode {
  id: string; // = promptId
  parentChatNodeId: string | null;
  rootUserUuid: string;
  userMessage: ChatNodeUserMessage;
  workflow: WorkFlow;
  trigger: ChatNodeTrigger;
  triggerSource?: { workNodeId: string };
  isCompactSummary: boolean;
  compactMetadata?: CompactNode;
  /** When set: this ChatNode is a slash-command invocation, not a real
   * conversation turn. Render specially. */
  slashCommand?: SlashCommandInfo;
  meta: ChatNodeMeta;
}

// ─── ChatFlow layer ──────────────────────────────────────────────────────────

export interface ChatFlow {
  id: string; // = sessionId
  mainJsonlPath: string;
  sidecarDir: string;
  cwd?: string;
  gitBranch?: string;
  createdAt?: string;
  lastUpdatedAt?: string;
  trigger: ChatFlowTrigger;
  triggerSource?: {
    sessionId: string;
    jsonlPath: string;
    sourceWorkNodeId: string;
  };
  chatNodes: ChatNode[];
  // Records that couldn't be placed into any ChatNode (no promptId, not a known
  // ChatFlow-level event). Kept for debugging / future passes.
  orphans: OrphanRecord[];
  // Top-level events not bound to a single ChatNode. ScheduleWakeup fires,
  // standalone permission-mode flips, etc.
  flowEvents: FlowEvent[];
}

export interface OrphanRecord {
  uuid?: string;
  type: string;
  reason: string;
}

export interface FlowEvent {
  type: "scheduled_task_fire" | "permission_mode" | "local_command" | string;
  uuid?: string;
  timestamp?: string;
  data?: unknown;
}

// ─── v0.6 unified Node tree ──────────────────────────────────────────────────
//
// Single recursive tree replaces the ChatFlow/ChatNode/WorkFlow/WorkNode
// stack. Every entity that v0.1-v0.5 represented as a separate type is
// now a ``Node`` differing only in ``kind`` + which optional fields it
// populates. Folding is **the** mechanism for visual density: per-kind
// defaults live in ``defaultFolded`` (set at parse time), the store
// layers user overrides on top.
//
// Why one type instead of a discriminated union per kind: the canvas
// renders a single ``<NodeCard>`` that branches on ``kind`` for chrome.
// A discriminated union would force every consumer through a switch
// statement, which we already had with WorkNode and is exactly the
// fragmentation v0.6 is trying to undo. Optional fields keyed by kind
// (documented inline) trade type-precision for code uniformity — it's
// the right trade for a viewer that has to render every kind anyway.

export type NodeKind =
  // Root of a "turn" — a user record (or slash-command body, or
  // ScheduleWakeup sentinel). promptId of the bucket is on this node.
  | "user_message"
  // One assistant record. Carries text + thinking blocks. tool_use
  // blocks emit separate ``tool_call`` / ``delegate`` children.
  | "assistant_call"
  // One tool_use block (non-Agent/Task) + its tool_result.
  | "tool_call"
  // Agent/Task tool_use + result. ``agentId`` (when present) anchors
  // sub-agent lazy-load (sidecar is a separate Node tree attached on
  // demand under this delegate).
  | "delegate"
  // isCompactSummary user record + paired compact_boundary metadata.
  | "compact"
  // file / edited_text_file / queued_command / invoked_skills /
  // compact_file_reference / skill_listing.
  | "attachment";

// Aggregate signals the parser pre-computes for a turn-root
// ``user_message`` so the folded card can render the v0.5-equivalent
// chrome (assistant preview + counts + token bar) without walking
// children at render time. Mirrors the data the legacy ChatNodeCard
// derived in ``layoutDag.ts`` so option-A folding visually matches v0.5.
export interface NodeAggregate {
  // Last assistant_call's text in the turn (terminal reply preview).
  assistantPreview: string;
  // Counts of immediate descendants by kind.
  llmCallCount: number;
  toolCallCount: number;
  delegateCount: number;
  attachmentCount: number;
  // Sum of thinking-block char counts under this turn (for the
  // ``▸ thinking Nk`` chip).
  thinkingChars: number;
  // Last assistant_call's usage snapshot (input + cache_creation +
  // cache_read) — drives the TokenBar denominator selection too.
  contextTokens: number;
  // From the last assistant_call's model field. Undefined for
  // slash-command-only turns (no LLM invocation).
  model?: string;
}

export interface Node {
  // Stable id. Conventions:
  //   - user_message: rootUserUuid (the chosen user record's uuid)
  //   - assistant_call: assistant record uuid
  //   - tool_call / delegate: tool_use block id (toolu_…)
  //   - compact: compact user record uuid (with #N suffix on dup)
  //   - attachment: attachment record uuid
  id: string;
  // Direct parent in the unified tree. ``null`` = top-level (a turn root
  // whose preceding ChatNode lives in a different session, or the
  // first turn of the session).
  parentId: string | null;
  kind: NodeKind;
  // Original record uuid (for cross-references / debugging). Same as
  // ``id`` for most kinds; tool_use kinds preserve the host
  // assistant uuid here so we can find which llm_call emitted them.
  uuid?: string;
  timestamp?: string;
  // Promptid the underlying record carried (or inherited via parentUuid
  // walk). Multiple Nodes share a promptId; not 1-1 with id.
  promptId?: string;
  // Default fold state computed at parse time. UI overrides accumulate
  // in store sets ``foldedNodeIds`` / ``expandedNodeIds`` and apply
  // on top.
  defaultFolded: boolean;
  // True iff this node is the root of a promptId bucket (= one of the
  // 1522 ChatNodes in legacy v0.5 vocabulary). Stable signal for stats
  // / breadcrumb / "this is a turn boundary" — independent of fold
  // state or cross-bucket linking re-parenting.
  isTurnRoot?: boolean;

  // ── user_message ─────────────────────────────────────────────────
  role?: "user" | "assistant" | "system";
  content?: unknown; // raw user record content (string or block[])
  attachments?: Array<{ uuid: string; type: string; raw: unknown }>;
  slashCommand?: SlashCommandInfo;
  awaySummary?: { uuid: string; content: string; timestamp?: string };
  trigger?: ChatNodeTrigger;
  triggerSource?: { workNodeId: string };
  fileHistorySnapshotUuids?: string[];
  permissionModeChanges?: Array<{ uuid: string; permissionMode: string }>;
  // Pre-computed aggregate (set on user_message kind only) — see
  // NodeAggregate above.
  aggregate?: NodeAggregate;

  // ── assistant_call ───────────────────────────────────────────────
  text?: string;
  thinking?: ThinkingBlock[];
  model?: string;
  stopReason?: string;
  usage?: Record<string, unknown>;
  requestId?: string;

  // ── tool_call / delegate ─────────────────────────────────────────
  toolName?: string;
  toolInput?: unknown;
  toolResultUserUuid?: string;
  toolResultBlock?: unknown;
  toolUseResult?: unknown;
  isError?: boolean;
  durationMs?: number;

  // ── delegate-specific ────────────────────────────────────────────
  agentId?: string;
  agentType?: string;
  description?: string;
  prompt?: string;
  status?: string;
  // The sub-agent's final reply text, surfaced from toolUseResult so
  // the folded delegate card can show a 1-line head without loading
  // the sidecar.
  delegateContent?: string;
  totalDurationMs?: number;
  totalTokens?: number;
  totalToolUseCount?: number;
  delegateUsage?: Record<string, unknown>;
  toolStats?: Record<string, unknown>;

  // ── compact ──────────────────────────────────────────────────────
  boundaryUuid?: string;
  logicalParentUuid?: string;
  compactTrigger?: "auto" | "manual" | string;
  preTokens?: number;
  preCompactDiscoveredTools?: unknown;
  summaryText?: string;
  isCompactSummary?: boolean;

  // ── attachment ───────────────────────────────────────────────────
  attachmentType?: string;
  attachmentRaw?: unknown;

  // Errors observed on the underlying record (api_error subtypes etc.).
  errors?: WorkNodeError[];
}

export interface NodeTree {
  // Session-level metadata mirrors the legacy ChatFlow header.
  id: string;
  mainJsonlPath: string;
  sidecarDir: string;
  cwd?: string;
  gitBranch?: string;
  createdAt?: string;
  lastUpdatedAt?: string;
  trigger: ChatFlowTrigger;
  triggerSource?: {
    sessionId: string;
    jsonlPath: string;
    sourceWorkNodeId: string;
  };
  // The forest. ``rootNodeIds`` are top-level (parentId = null);
  // typically there's exactly one (the first turn) but multi-root
  // sessions exist.
  rootNodeIds: string[];
  // All nodes, keyed by id for O(1) parent / child resolution. The
  // store consumes this directly and adds fold-state sets on top.
  nodes: Map<string, Node>;
  // Children index: parentId → sorted child ids. Built once at parse
  // time so layout / canvas don't have to walk ``nodes`` to enumerate
  // children. Sort key = timestamp (ascending), uuid as tiebreaker.
  childrenByParent: Map<string, string[]>;
  // Records that couldn't be placed into the tree (no promptId, not a
  // known flow event). Same semantics as legacy ChatFlow.orphans.
  orphans: OrphanRecord[];
  // Top-level events not bound to any single Node (ScheduleWakeup
  // fires, standalone permission-mode flips, etc.).
  flowEvents: FlowEvent[];
}
