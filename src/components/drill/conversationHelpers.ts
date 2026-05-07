// Pure helpers extracted from ConversationView.tsx to keep that
// module a clean component-only export — required so React Fast
// Refresh can hot-update the conversation panel instead of forcing
// a full page reload (mixing component + non-component exports
// trips the "incompatible" warning).
//
// Functions here:
//   - extractText: pull the human-readable text out of CC's
//     polymorphic `userMessage.content` (string OR block array).
//   - allAssistantTextsFromWorkflow: every llm_call's text, in DAG
//     order, empty-text rounds dropped.
//   - assistantTextsForChatNode: the 5-tier fallback used by both
//     the bubble renderer and the lazy-pack token estimator
//     (workflow.nodes → summary.assistantText → compact summary →
//     slash stdout → []).
//   - lastAssistantTextFromWorkflow: backwards-compat single-text
//     accessor for non-bubble callers.
//   - estimateTokens: rough char/4 estimator used by packStartIdx.
//   - packStartIdx: lazy-pack window resolver (v0.8.1 #4).

import type {
  ChatNode,
  LlmCallNode,
  WorkFlow,
} from "@/data/types";

export function extractText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (block && typeof block === "object") {
        const b = block as { type?: string; text?: unknown };
        if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
      }
    }
    return parts.length > 0 ? parts.join("\n\n") : null;
  }
  return null;
}

// Return EVERY non-empty llm_call.text from a workflow, in DAG-array
// order (= turn order, since the parser appends nodes as they appear
// in the JSONL stream). One ChatNode often contains multiple
// llm_call rounds — between each round are tool_calls the assistant
// invoked. v0.10 ConversationView previously rendered just the LAST
// round; users with multi-tool sessions saw only the final summary
// and lost intermediate reasoning. Rendering all rounds keeps the
// bubble in sync with the WorkFlow canvas's `n_chains` indication.
export function allAssistantTextsFromWorkflow(
  workflow: WorkFlow | null,
): string[] {
  if (!workflow) return [];
  const out: string[] = [];
  for (const n of workflow.nodes) {
    if (n.kind !== "llm_call") continue;
    const t = (n as LlmCallNode).text;
    if (t && t.trim().length > 0) out.push(t);
  }
  return out;
}

// EN: Resolve the assistant text(s) for a ChatNode. Priority:
//   1. workflow.nodes (loaded → most authoritative)
//   2. summary.assistantText[] (v0.9.2 — full per-round text shipped
//      with lite ChatFlow; bubble renders WITHOUT waiting for the
//      workflow lazy fetch, so user message + assistant message
//      arrive together)
//   3. compactMetadata.summaryText (compact ChatNodes — inline)
//   4. slashCommand.stdout (slash command ChatNodes — inline)
//   5. [] (skeleton path)
//
// `summary.assistantPreview` (80-char truncated) was REMOVED from
// the fallback chain in v0.9.1 — it caused the "shrink-then-expand"
// flash on every session open. v0.9.2's full assistantText[]
// replaces both the placeholder role AND the lazy-fetch round trip.
//
// 中: 优先级 (1) 已 load 的 workflow → (2) lite summary.assistantText
// 全文 → (3) compact / (4) slash → (5) 空（走 skeleton）。bubble
// 不再需要等 workflow lazy fetch 就能展示完整 assistant 文本。
export function assistantTextsForChatNode(
  workflow: WorkFlow | null,
  cn: ChatNode,
): string[] {
  if (workflow) {
    const all = allAssistantTextsFromWorkflow(workflow);
    if (all.length > 0) return all;
  }
  const fromSummary = cn.workflow.summary?.assistantText;
  if (fromSummary && fromSummary.length > 0) return fromSummary;
  if (cn.compactMetadata?.summaryText) return [cn.compactMetadata.summaryText];
  if (cn.slashCommand?.stdout) return [cn.slashCommand.stdout];
  return [];
}

// Backwards-compat single-text helper for non-bubble call sites that
// only need a brief preview (search, MessageMeta last-llm resolver).
// Returns the LAST text — same as v0.10 behaviour.
export function lastAssistantTextFromWorkflow(
  workflow: WorkFlow | null,
  cn: ChatNode,
): string | null {
  const all = assistantTextsForChatNode(workflow, cn);
  return all.length > 0 ? all[all.length - 1] : null;
}

function estimateTokens(cn: ChatNode): number {
  const u = extractText(cn.userMessage.content) ?? "";
  // v0.10 lazy ChatFlow B5: estimateTokens runs at packStartIdx time
  // (when we don't yet have the full workflow). Use the summary
  // preview for the lite path; once workflow loads the bubble
  // re-renders with the full markdown but estimate-driven slice
  // boundaries are stable enough on previews (the truncation cap is
  // 80 chars; small undercount on edge cases is fine).
  const summary = cn.workflow.summary;
  const a =
    lastAssistantTextFromWorkflow(cn.workflow, cn) ??
    summary?.assistantPreview ??
    "";
  return Math.ceil((u.length + a.length) / 4);
}

export function packStartIdx(
  path: string[],
  byId: Map<string, ChatNode>,
  endIdx: number,
  budget: number,
): number {
  let used = 0;
  let i = endIdx;
  while (i > 0) {
    const cn = byId.get(path[i - 1]);
    const tokens = cn ? estimateTokens(cn) : 0;
    // Always include at least one ChatNode even if it busts budget;
    // otherwise an oversized leaf would render an empty viewport.
    if (i < endIdx && used + tokens > budget) break;
    used += tokens;
    i -= 1;
  }
  return i;
}
