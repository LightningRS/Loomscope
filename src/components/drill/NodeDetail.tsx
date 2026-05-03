// v0.6 M6 — unified NodeDetail for the DrillPanel.
//
// Replaces the v0.4-v0.5 split between ChatNodeDetail (ChatFlow layer)
// and WorkNodeDetail (5 WorkNode kinds). One component branches on
// ``Node.kind`` and renders the same detail content the legacy
// components produced — same MarkdownView / JsonView / DiffView /
// chunked tool-result loader / sub-agent drill button + cache wiring.
//
// Field name mapping (legacy → unified Node):
//   ChatNode.userMessage.content   → node.content
//   ChatNode.slashCommand          → node.slashCommand
//   LlmCallNode.text/thinking/...  → node.text/thinking/...
//   ToolCallNode.input             → node.toolInput
//   ToolCallNode.resultBlock       → node.toolResultBlock
//   DelegateNode.content           → node.delegateContent
//   DelegateNode.usage             → node.delegateUsage
//   CompactNode.trigger            → node.compactTrigger
//   AttachmentNode.raw             → node.attachmentRaw

import { memo, useEffect, useMemo, useRef } from "react";

import { JsonView } from "@/components/JsonView";
import { MarkdownView } from "@/components/MarkdownView";
import { DiffView, extractStructuredPatch } from "@/components/DiffView";
import {
  extractOverflowRefId,
} from "@/components/drill/WorkNodeDetail";
import { useToolResultChunks } from "@/components/drill/useToolResultChunks";
import { useStore } from "@/store/index";
import type { Node } from "@/data/types";

interface Props {
  node: Node;
  sessionId: string;
}

// Memo-wrapped — selection switches reuse the same Node reference
// from the parsed nodeTree, so identity comparison is sufficient.
// Skips the markdown / JsonView re-render on unrelated store updates
// (drill-panel-width drag, focus toggle, etc.).
export const NodeDetail = memo(NodeDetailImpl, (a, b) => a.node === b.node && a.sessionId === b.sessionId);

function NodeDetailImpl({ node, sessionId }: Props) {
  return (
    <div data-testid="node-detail" className="flex flex-col gap-3">
      <header className="space-y-1">
        <div className="text-[10px] uppercase tracking-wide text-gray-500">
          {labelForKind(node.kind)} · {node.kind}
        </div>
        <div className="font-mono text-[11px] text-gray-700 break-all">
          {node.id}
        </div>
        {node.timestamp && (
          <div className="font-mono text-[10px] text-gray-400">
            {node.timestamp}
          </div>
        )}
      </header>
      {node.kind === "user_message" && <UserMessageDetail node={node} />}
      {node.kind === "assistant_call" && <AssistantDetail node={node} />}
      {node.kind === "tool_call" && <ToolCallDetail node={node} sessionId={sessionId} />}
      {node.kind === "delegate" && <DelegateDetail node={node} sessionId={sessionId} />}
      {node.kind === "compact" && <CompactDetail node={node} />}
      {node.kind === "attachment" && <AttachmentDetail node={node} />}
    </div>
  );
}

function labelForKind(kind: Node["kind"]): string {
  switch (kind) {
    case "user_message":
      return "ChatNode";
    case "assistant_call":
      return "WorkNode";
    case "tool_call":
      return "WorkNode";
    case "delegate":
      return "WorkNode";
    case "compact":
      return "WorkNode";
    case "attachment":
      return "WorkNode";
  }
}

function Section({
  title,
  children,
  testId,
}: {
  title: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <section data-testid={testId}>
      <h3 className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">
        {title}
      </h3>
      <div className="rounded border border-gray-200 bg-white p-2.5">{children}</div>
    </section>
  );
}

// ── user_message (turn root) ────────────────────────────────────────

function UserMessageDetail({ node }: { node: Node }) {
  const userText = useMemo(() => extractText(node.content), [node]);
  const llmCount = node.aggregate?.llmCallCount ?? 0;
  const toolCount = (node.aggregate?.toolCallCount ?? 0) + (node.aggregate?.delegateCount ?? 0);
  const compactCount = 0; // counts not on aggregate; rare on turn root
  const attachCount = node.aggregate?.attachmentCount ?? 0;
  return (
    <>
      <Section title="用户消息">
        {userText ? (
          <MarkdownView className="prose prose-sm max-w-none text-[12px] text-gray-900">
            {userText}
          </MarkdownView>
        ) : (
          <JsonView value={node.content} />
        )}
      </Section>
      {node.aggregate?.assistantPreview && (
        <Section title="助手末次回复">
          <MarkdownView className="prose prose-sm max-w-none text-[12px] text-gray-900">
            {node.aggregate.assistantPreview}
          </MarkdownView>
        </Section>
      )}
      <Section title="WorkFlow 概览">
        <ul className="text-[11px] text-gray-700 space-y-0.5 font-mono">
          <li>llm_call: {llmCount}</li>
          <li>tool_call + delegate: {toolCount}</li>
          {compactCount > 0 && <li>compact: {compactCount}</li>}
          {attachCount > 0 && <li>attachment: {attachCount}</li>}
        </ul>
        <div className="mt-1 text-[10px] text-gray-400">
          双击 turn 节点展开内部 / 右键 → Focus on this subtree
        </div>
      </Section>
      {node.awaySummary && (
        <Section title="Away summary (recap)">
          <MarkdownView className="prose prose-sm max-w-none text-[12px] text-gray-700">
            {node.awaySummary.content}
          </MarkdownView>
        </Section>
      )}
      {node.slashCommand && (
        <Section title="Slash command">
          <div className="font-mono text-[11px] text-violet-700">
            {node.slashCommand.name}
            {node.slashCommand.args ? ` ${node.slashCommand.args}` : ""}
          </div>
          {node.slashCommand.stdout && (
            <pre className="mt-1 max-h-64 overflow-auto rounded bg-gray-50 border border-gray-200 p-2 text-[11px] font-mono text-gray-800 whitespace-pre-wrap">
              {node.slashCommand.stdout}
            </pre>
          )}
        </Section>
      )}
    </>
  );
}

// ── assistant_call ──────────────────────────────────────────────────

function AssistantDetail({ node }: { node: Node }) {
  return (
    <>
      <Section title="Model / Request">
        <ul className="text-[11px] text-gray-700 font-mono space-y-0.5">
          <li>model: {node.model ?? "—"}</li>
          {node.requestId && <li>requestId: {node.requestId}</li>}
          {node.stopReason && <li>stop_reason: {node.stopReason}</li>}
        </ul>
      </Section>
      <Section title="Text">
        {node.text ? (
          <MarkdownView className="prose prose-sm max-w-none text-[12px] text-gray-900">
            {node.text}
          </MarkdownView>
        ) : (
          <div className="text-[11px] italic text-gray-400">(空)</div>
        )}
      </Section>
      {node.thinking && node.thinking.length > 0 && (
        <Section title={`Thinking (${node.thinking.length} block${node.thinking.length === 1 ? "" : "s"})`}>
          <div className="space-y-1.5">
            {node.thinking.map((t, i) => (
              <div
                key={i}
                className="rounded border-l-2 border-blue-200 bg-blue-50/40 px-2 py-1 text-[11px] text-gray-700 whitespace-pre-wrap"
              >
                {t.text}
              </div>
            ))}
          </div>
        </Section>
      )}
      {node.usage && (
        <Section title="Usage">
          <JsonView value={node.usage} />
        </Section>
      )}
      {node.errors && node.errors.length > 0 && (
        <Section title="Errors">
          <ul className="text-[11px] text-rose-700 space-y-0.5">
            {node.errors.map((e, i) => (
              <li key={i}>
                <span className="font-mono">{e.type}</span>
                {e.message ? `: ${e.message}` : ""}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

// ── tool_call ───────────────────────────────────────────────────────

function ToolCallDetail({ node, sessionId }: { node: Node; sessionId: string }) {
  const patch = useMemo(() => extractStructuredPatch(node.toolUseResult), [node]);
  const overflowRefId = useMemo(() => extractOverflowRefId(node.toolResultBlock), [node]);
  return (
    <>
      <Section title="Tool">
        <ul className="text-[11px] text-gray-700 font-mono space-y-0.5">
          <li>name: {node.toolName}</li>
          {node.durationMs != null && <li>durationMs: {node.durationMs}</li>}
          {node.isError && (
            <li className="text-rose-700 font-semibold">✗ failed</li>
          )}
        </ul>
      </Section>
      <Section title="Input">
        {node.toolName === "Bash" && typeof (node.toolInput as Record<string, unknown> | null)?.command === "string" ? (
          <BashInputView input={node.toolInput as Record<string, unknown>} />
        ) : (
          <JsonView value={node.toolInput} />
        )}
      </Section>
      {patch ? (
        <Section title="Diff" testId="tool-result-diff-section">
          <DiffView hunks={patch.hunks} filePath={patch.filePath} />
        </Section>
      ) : null}
      {overflowRefId ? (
        <Section title={`Tool result (overflow · ${overflowRefId})`}>
          <ToolResultOverflow sessionId={sessionId} refId={overflowRefId} />
        </Section>
      ) : (
        <Section title="Tool result">
          {patch ? (
            <div className="text-[10px] italic text-gray-400">
              (详见上方 Diff 渲染；下面是原始 JSON)
            </div>
          ) : null}
          {node.toolResultBlock != null ? (
            <JsonView value={node.toolResultBlock} />
          ) : node.toolUseResult != null ? (
            <JsonView value={node.toolUseResult} />
          ) : (
            <div className="text-[11px] italic text-gray-400">(无 result)</div>
          )}
        </Section>
      )}
    </>
  );
}

function BashInputView({ input }: { input: Record<string, unknown> }) {
  const command = String(input.command ?? "");
  const description = typeof input.description === "string" ? input.description : null;
  const runInBg = input.run_in_background === true;
  return (
    <div className="space-y-1.5">
      {description && (
        <div className="text-[11px] text-gray-700">{description}</div>
      )}
      <pre className="m-0 rounded bg-gray-900 px-2 py-1.5 text-[11px] font-mono text-gray-100 overflow-x-auto whitespace-pre-wrap">
        {command}
      </pre>
      {runInBg && (
        <div className="text-[10px] text-amber-700">⏳ run_in_background</div>
      )}
    </div>
  );
}

function ToolResultOverflow({
  sessionId,
  refId,
}: {
  sessionId: string;
  refId: string;
}) {
  const { text, totalSize, loadedBytes, hasMore, loading, error, loadMore } =
    useToolResultChunks(sessionId, refId);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      if (!hasMore || loading) return;
      const { scrollTop, scrollHeight, clientHeight } = el;
      if (scrollHeight - (scrollTop + clientHeight) < 400) {
        loadMore();
      }
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, [hasMore, loading, loadMore]);
  return (
    <div className="space-y-1">
      <div className="text-[10px] text-gray-500 font-mono">
        {totalSize != null ? (
          <>
            {formatBytes(loadedBytes)} / {formatBytes(totalSize)} loaded
            {hasMore && " · 滚到底部加载更多"}
          </>
        ) : loading ? (
          "loading…"
        ) : (
          ""
        )}
      </div>
      <div
        ref={ref}
        className="max-h-[400px] overflow-auto rounded bg-gray-50 border border-gray-200 p-2 text-[11px] font-mono text-gray-800 whitespace-pre-wrap"
        data-testid="tool-result-overflow-scroll"
      >
        {text}
        {loading && (
          <div className="mt-1 text-[10px] text-gray-400">loading next chunk…</div>
        )}
      </div>
      {error && (
        <div className="text-[10px] text-rose-700">load failed: {error}</div>
      )}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

// ── delegate ────────────────────────────────────────────────────────

function DelegateDetail({ node, sessionId }: { node: Node; sessionId: string }) {
  const isAutoCompact = (node.agentId ?? "").startsWith("acompact-");
  const enterSubWorkflow = useStore((s) => s.enterSubWorkflow);
  const cacheEntry = useStore((s) =>
    node.agentId
      ? s.sessions.get(sessionId)?.subAgentCache.get(node.agentId) ?? null
      : null,
  );
  return (
    <>
      <Section title="Sub-agent">
        <ul className="text-[11px] text-gray-700 font-mono space-y-0.5">
          <li>agentType: {node.agentType ?? "—"}</li>
          {node.agentId && <li>agentId: {node.agentId}</li>}
          {node.status && <li>status: {node.status}</li>}
          {node.totalDurationMs != null && <li>totalDurationMs: {node.totalDurationMs}</li>}
          {node.totalTokens != null && <li>totalTokens: {node.totalTokens}</li>}
          {node.totalToolUseCount != null && (
            <li>totalToolUseCount: {node.totalToolUseCount}</li>
          )}
        </ul>
        {isAutoCompact && (
          <div className="mt-1.5 inline-flex items-center rounded bg-purple-200/80 px-1.5 py-0.5 text-[10px] font-semibold text-purple-900">
            ⊞ auto-compact agent
          </div>
        )}
        {node.agentId ? (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => enterSubWorkflow(sessionId, node.id)}
              className={[
                "inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] transition-colors",
                cacheEntry?.status === "loading"
                  ? "border-gray-200 bg-gray-50 text-gray-400 cursor-wait"
                  : "border-purple-300 bg-purple-50 text-purple-800 hover:border-purple-500 hover:bg-purple-100",
              ].join(" ")}
              disabled={cacheEntry?.status === "loading"}
              data-testid="drill-into-subagent"
            >
              {cacheEntry?.status === "loading" ? (
                <>⏳ Loading sub-agent…</>
              ) : (
                <>⤢ Drill into sub-agent</>
              )}
            </button>
            {cacheEntry?.status === "error" && (
              <div className="mt-1 text-[10px] text-rose-700">
                load failed: {cacheEntry.error ?? "unknown error"}
              </div>
            )}
            {/* v0.5 had a multi-ChatNode warning here; v0.6 unified
                tree renders sub-agent fully so the warning is gone. */}
          </div>
        ) : (
          <div className="mt-1.5 text-[10px] text-gray-400">
            (no agentId — sub-agent sidecar can't be located)
          </div>
        )}
      </Section>
      {cacheEntry?.meta?.worktreePath && (
        <Section title="Sub-agent meta">
          <ul className="text-[11px] text-gray-700 font-mono space-y-0.5">
            <li>worktreePath: {cacheEntry.meta.worktreePath}</li>
          </ul>
        </Section>
      )}
      {node.description && (
        <Section title="Description">
          <MarkdownView className="prose prose-sm max-w-none text-[12px] text-gray-900">
            {node.description}
          </MarkdownView>
        </Section>
      )}
      {node.prompt && (
        <Section title="Prompt">
          <MarkdownView className="prose prose-sm max-w-none text-[12px] text-gray-700">
            {node.prompt}
          </MarkdownView>
        </Section>
      )}
      {node.delegateContent && (
        <Section title="Content (final reply)">
          <MarkdownView className="prose prose-sm max-w-none text-[12px] text-gray-900">
            {node.delegateContent}
          </MarkdownView>
        </Section>
      )}
      {node.toolStats && (
        <Section title="Tool stats">
          <JsonView value={node.toolStats} />
        </Section>
      )}
      {node.delegateUsage && (
        <Section title="Usage">
          <JsonView value={node.delegateUsage} />
        </Section>
      )}
    </>
  );
}

// ── compact ─────────────────────────────────────────────────────────

function CompactDetail({ node }: { node: Node }) {
  return (
    <>
      <Section title="Compact">
        <ul className="text-[11px] text-gray-700 font-mono space-y-0.5">
          <li>trigger: {node.compactTrigger ?? "auto"}</li>
          {node.preTokens != null && <li>preTokens: {node.preTokens}</li>}
          {node.boundaryUuid && <li>boundaryUuid: {node.boundaryUuid}</li>}
          {node.logicalParentUuid && (
            <li>logicalParentUuid: {node.logicalParentUuid}</li>
          )}
        </ul>
        <div className="mt-1.5 text-[10px] text-gray-400">
          v0.7 才上 compact 完整交互（展开 pre-compact 原段）
        </div>
      </Section>
      <Section title="Summary">
        {node.summaryText ? (
          <MarkdownView className="prose prose-sm max-w-none text-[12px] text-gray-700">
            {node.summaryText}
          </MarkdownView>
        ) : (
          <div className="text-[11px] italic text-gray-400">(空)</div>
        )}
      </Section>
    </>
  );
}

// ── attachment ──────────────────────────────────────────────────────

function AttachmentDetail({ node }: { node: Node }) {
  return (
    <>
      <Section title="Attachment">
        <ul className="text-[11px] text-gray-700 font-mono space-y-0.5">
          <li>type: {node.attachmentType}</li>
        </ul>
        {node.attachmentType === "compact_file_reference" && (
          <div className="mt-1.5 text-[10px] text-gray-500">
            ⊠ original content compacted out of jsonl
          </div>
        )}
      </Section>
      <Section title="Raw">
        <JsonView value={node.attachmentRaw} />
      </Section>
    </>
  );
}

function extractText(content: unknown): string | null {
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
