// EffectiveContextView — renders the inbound context the focused
// ChatNode actually receives, after CC's auto-compact has truncated
// history.
//
// Layout (top → bottom):
//   1. CompactSummaryBanner (when cutoff exists) — the cutoff's
//      compactMetadata.summaryText with distinct chrome. Replaces
//      everything upstream in the LLM's actual context.
//   2. PostCompactTailBlock (only when cutoff is hybrid AND
//      summary.innerCompactLlmCallBoundaryIdx is defined) — the
//      hybrid's post-compact assistant rounds. Pre-compact rounds +
//      user prompt are HIDDEN because they're already in the summary.
//      Tools aren't rendered (would require lazy workflow.nodes
//      load); a small note links the user to the Conversation tab.
//   3. ConversationView slice — ancestors after cutoff + current
//      node's own bubble. Cutoff bubble itself is omitted via
//      `omitChatNodeIds` so its content (which would render
//      verbatim, duplicating the summary) is suppressed.
//
// For non-cutoff cases (no compact in chain): no banner, no tail
// block, ConversationView renders the full chain unchanged.
//
// For pure compact target case (target IS a compact ChatNode): show
// banner only; the cutoff bubble (= target) is omitted.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { LazyMarkdownView } from "@/components/MarkdownView";
import { ConversationView } from "@/components/drill/ConversationView";
import { findEffectiveContextCutoff } from "@/components/drill/effectiveContext";
import { findLatestLeafId } from "@/components/drill/pathUtils";
import type { ChatFlow, ChatNode } from "@/data/types";
import { useStore } from "@/store/index";

interface Props {
  sessionId: string;
  chatFlow: ChatFlow;
  drilledChatNode: ChatNode | null;
  viewMode: "chatflow" | "workflow" | "sub-chatflow";
}

export function EffectiveContextView({
  sessionId,
  chatFlow,
  drilledChatNode,
  viewMode,
}: Props) {
  const { t } = useTranslation();
  const selectedChatId = useStore(
    (s) => s.sessions.get(sessionId)?.selectedNodeId ?? null,
  );
  const focusedId = useMemo<string | null>(() => {
    if (viewMode === "workflow") return drilledChatNode?.id ?? null;
    // Mirror ConversationView's first-open behaviour: when no
    // ChatNode is explicitly selected, fall back to the chatflow's
    // latest leaf so the tab renders meaningful content immediately
    // (the most recent turn is what users want to inspect "what
    // context did this LLM call see"). Without this, the tab shows
    // only the placeholder hint until the user clicks a card,
    // which is inconsistent with the Conversation tab.
    if (selectedChatId) return selectedChatId;
    return findLatestLeafId(chatFlow);
  }, [viewMode, selectedChatId, drilledChatNode, chatFlow]);

  const cutoffId = useMemo(
    () => (focusedId ? findEffectiveContextCutoff(chatFlow, focusedId) : null),
    [chatFlow, focusedId],
  );

  const cutoffNode = useMemo<ChatNode | null>(() => {
    if (!cutoffId) return null;
    return chatFlow.chatNodes.find((c) => c.id === cutoffId) ?? null;
  }, [chatFlow, cutoffId]);

  // Hybrid post-compact tail: assistantText slice from boundary
  // forward. Empty array when (a) cutoff isn't hybrid, (b) boundary
  // idx is missing (older session pre-v0.11 schema), or (c) the
  // hybrid had no post-compact rounds (auto-compact fired right at
  // end_turn — rare). The block only renders when we have something
  // to show.
  const postCompactTailTexts = useMemo<string[]>(() => {
    if (!cutoffNode || !cutoffNode.hasInnerCompact) return [];
    const summary = cutoffNode.workflow.summary;
    if (!summary) return [];
    const idx = summary.innerCompactLlmCallBoundaryIdx;
    if (typeof idx !== "number") return [];
    return summary.assistantText.slice(idx);
  }, [cutoffNode]);

  // ConversationView omits the cutoff's own bubble. For pure compact:
  // the bubble would render its summaryText via fallbackText, which is
  // exactly what the banner already shows — duplicated content. For
  // hybrid: the bubble would render the full real user/assistant pair,
  // including pre-compact rounds already covered by the summary.
  const omitSet = useMemo(() => {
    if (!cutoffId) return null;
    return new Set([cutoffId]);
  }, [cutoffId]);

  if (!focusedId) {
    return (
      <div className="flex h-full items-center justify-center text-gray-400 text-[12px] px-3 text-center">
        {t("effective_context.placeholder_no_node")}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="px-3 pt-2 pb-1 text-[10px] text-gray-400 leading-snug border-b border-gray-100">
        {cutoffId
          ? t("effective_context.intro_with_cutoff")
          : t("effective_context.intro_no_cutoff")}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {cutoffNode?.compactMetadata?.summaryText && (
          <CompactSummaryBanner
            summaryText={cutoffNode.compactMetadata.summaryText}
            chatNodeId={cutoffNode.id}
            isHybrid={cutoffNode.hasInnerCompact === true}
          />
        )}
        {postCompactTailTexts.length > 0 && (
          <PostCompactTailBlock
            texts={postCompactTailTexts}
            chatNodeId={cutoffNode!.id}
          />
        )}
        <ConversationView
          sessionId={sessionId}
          chatFlow={chatFlow}
          focusLock={focusedId}
          headCutoffChatNodeId={cutoffId}
          omitChatNodeIds={omitSet}
        />
      </div>
    </div>
  );
}

// Renders the cutoff's compact summary text in distinct chrome
// (dashed teal border + label) so the truncation point is
// unmistakable. Mirrors the Canvas's CompactCard visual language.
function CompactSummaryBanner({
  summaryText,
  chatNodeId,
  isHybrid,
}: {
  summaryText: string;
  chatNodeId: string;
  isHybrid: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="m-3 mb-0 rounded-md border border-dashed border-teal-300 bg-teal-50/60 p-2"
      data-testid={`effective-cutoff-banner-${chatNodeId}`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-teal-800">
          {isHybrid
            ? t("effective_context.label_compact_summary_hybrid")
            : t("effective_context.label_compact_summary_pure")}
        </span>
        <span
          className="text-[10px] font-mono text-teal-700"
          title={chatNodeId}
        >
          {chatNodeId.slice(0, 8)}
        </span>
      </div>
      <LazyMarkdownView className="prose prose-sm max-w-none text-[12px] text-gray-800 leading-relaxed">
        {summaryText}
      </LazyMarkdownView>
    </div>
  );
}

// Renders the hybrid cutoff's post-compact assistant text rounds.
// These are the llm_call texts that fired AFTER the inline compact
// fired — they're verbatim context the next ChatNode sees, and not
// captured by the summary above. Tool pills are omitted (would
// require lazy workflow.nodes load); a hint links users to the
// Conversation tab for full tool-pill detail.
function PostCompactTailBlock({
  texts,
  chatNodeId,
}: {
  texts: string[];
  chatNodeId: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="m-3 mt-2 mb-0 rounded-md border border-amber-200 bg-amber-50/40 p-2"
      data-testid={`effective-post-compact-tail-${chatNodeId}`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-800">
          {t("effective_context.label_post_compact_tail")}
        </span>
        <span
          className="text-[10px] font-mono text-amber-700"
          title={chatNodeId}
        >
          {chatNodeId.slice(0, 8)}
        </span>
      </div>
      <div className="space-y-2">
        {texts.map((text, i) => (
          <LazyMarkdownView
            key={i}
            className="prose prose-sm max-w-none text-[12px] text-gray-800 leading-relaxed"
          >
            {text}
          </LazyMarkdownView>
        ))}
      </div>
      <div className="mt-1.5 text-[10px] italic text-amber-700/80">
        {t("effective_context.post_compact_tail_note")}
      </div>
    </div>
  );
}
