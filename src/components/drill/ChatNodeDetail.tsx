// Drill-panel content when ChatFlow is the active view: shows a single
// selected ChatNode's full user message + final assistant reply +
// inner WorkFlow summary. Markdown is enabled via MarkdownView so
// formatted LLM output reads naturally; raw fall-back used when
// content isn't a string (e.g. user message is a structured block
// array with attachments).

import { memo, useMemo } from "react";

import { MarkdownView } from "@/components/MarkdownView";
import { JsonView } from "@/components/JsonView";
import { distinctToolUseFiles, nodeOwnFileChanges } from "@/canvas/layoutDag";
import type { ChatFlow, ChatNode, LlmCallNode, WorkFlow } from "@/data/types";
import { useChatNodeWorkflow } from "@/store/workflowHooks";

interface Props {
  chatNode: ChatNode;
  // v0.8.1 #9: needed to walk parentChatNodeId for selfDelta vs
  // ancestor-snapshot subtraction. Same scope ChatFlow as DrillPanel
  // resolves (top-level or sub-agent).
  chatFlow: ChatFlow;
  // v0.10 lazy ChatFlow B4: passed through to useChatNodeWorkflow so
  // the panel can lazy-fetch this ChatNode's workflow.nodes when it
  // arrived as a lite stub.
  sessionId: string;
}

// Memoized — selection switches happen frequently (every canvas
// click) and the markdown pipeline is the dominant cost. Skip the
// full re-render when ChatNode identity hasn't changed.
export const ChatNodeDetail = memo(
  ChatNodeDetailImpl,
  (a, b) =>
    a.chatNode === b.chatNode &&
    a.chatFlow === b.chatFlow &&
    a.sessionId === b.sessionId,
);

function ChatNodeDetailImpl({ chatNode, chatFlow, sessionId }: Props) {
  const userText = useMemo(() => extractText(chatNode.userMessage.content), [chatNode]);

  // v0.10 lazy ChatFlow B4: workflow.nodes may not be loaded yet (lite
  // ChatFlow ships them empty). The hook fires the fetch and returns
  // status; counts come from summary so the overview section never
  // blocks on lazy load. Only the assistant-reply body waits for
  // ready.
  const access = useChatNodeWorkflow(sessionId, chatNode);
  const lastLlm = useMemo(() => {
    if (!access.workflow) return null;
    return findLastLlmCallInWorkflow(access.workflow);
  }, [access.workflow]);

  const summary = chatNode.workflow.summary;
  // Counts read from summary when present (always true for top-level
  // lite responses) so the overview surfaces immediately. Fall back
  // to walking nodes for hand-built test fixtures + sub-agent
  // ChatNodes (their nodes ship inline).
  const llmCount =
    summary?.llmCount ??
    chatNode.workflow.nodes.filter((n) => n.kind === "llm_call").length;
  const toolCount =
    summary?.toolCount ??
    chatNode.workflow.nodes.filter(
      (n) => n.kind === "tool_call" || n.kind === "delegate",
    ).length;
  // compact / attachment counts aren't on summary (canvas card doesn't
  // render them); when workflow is lazy-loaded we pull from the
  // post-load nodes, otherwise defer to inline.
  const nodesForExtraCounts = access.workflow?.nodes ?? chatNode.workflow.nodes;
  const compactCount = nodesForExtraCounts.filter((n) => n.kind === "compact").length;
  const attachCount = nodesForExtraCounts.filter((n) => n.kind === "attachment").length;
  const totalNodes = llmCount + toolCount + compactCount + attachCount;

  return (
    <div data-testid="chat-node-detail" className="flex flex-col gap-3">
      <header className="space-y-1">
        <div className="text-[10px] uppercase tracking-wide text-gray-500">
          ChatNode
        </div>
        <div className="font-mono text-[11px] text-gray-700 break-all">
          {chatNode.id}
        </div>
        {chatNode.userMessage.timestamp && (
          <div className="font-mono text-[10px] text-gray-400">
            {chatNode.userMessage.timestamp}
          </div>
        )}
      </header>

      <Section title="用户消息">
        {userText ? (
          <MarkdownView className="prose prose-sm max-w-none text-[12px] text-gray-900">
            {userText}
          </MarkdownView>
        ) : (
          <JsonView value={chatNode.userMessage.content} />
        )}
      </Section>

      <Section title="助手末次回复">
        {access.status === "pending" ? (
          <div
            data-testid="assistant-reply-loading"
            className="text-[11px] italic text-gray-400"
          >
            正在加载…
          </div>
        ) : access.status === "error" ? (
          <div className="text-[11px] italic text-rose-600">
            加载失败: {access.error}
          </div>
        ) : lastLlm ? (
          <AssistantReply node={lastLlm} />
        ) : (
          <div className="text-[11px] italic text-gray-400">(无 assistant 回复)</div>
        )}
      </Section>

      <Section title="WorkFlow 概览">
        <ul className="text-[11px] text-gray-700 space-y-0.5 font-mono">
          <li>llm_call: {llmCount}</li>
          <li>tool_call + delegate: {toolCount}</li>
          {compactCount > 0 && <li>compact: {compactCount}</li>}
          {attachCount > 0 && <li>attachment: {attachCount}</li>}
          <li className="text-gray-400">total: {totalNodes}</li>
        </ul>
        <div className="mt-1 text-[10px] text-gray-400">
          点 ChatNode 上的「⤢ 进入工作流」查看 WorkFlow 详情
        </div>
      </Section>

      {chatNode.meta.awaySummary && (
        <Section title="Away summary (recap)">
          <MarkdownView className="prose prose-sm max-w-none text-[12px] text-gray-700">
            {chatNode.meta.awaySummary.content}
          </MarkdownView>
        </Section>
      )}

      <NodeOwnFileChangesSection chatNode={chatNode} chatFlow={chatFlow} />
      <FileHistorySnapshotsSection chatNode={chatNode} />

      {chatNode.slashCommand && (
        <Section title="Slash command">
          <div className="font-mono text-[11px] text-violet-700">
            {chatNode.slashCommand.name}
            {chatNode.slashCommand.args ? ` ${chatNode.slashCommand.args}` : ""}
          </div>
          {chatNode.slashCommand.stdout && (
            <pre className="mt-1 max-h-64 overflow-auto rounded bg-gray-50 border border-gray-200 p-2 text-[11px] font-mono text-gray-800 whitespace-pre-wrap">
              {chatNode.slashCommand.stdout}
            </pre>
          )}
        </Section>
      )}
    </div>
  );
}

function AssistantReply({ node }: { node: LlmCallNode }) {
  return (
    <div className="space-y-2">
      {node.text ? (
        <MarkdownView className="prose prose-sm max-w-none text-[12px] text-gray-900">
          {node.text}
        </MarkdownView>
      ) : (
        <div className="text-[11px] italic text-gray-400">(无文本)</div>
      )}
      {node.thinking.length > 0 && (
        <details className="text-[11px]">
          <summary className="cursor-pointer text-gray-500 hover:text-blue-600">
            ▸ {node.thinking.length} thinking block
            {node.thinking.length === 1 ? "" : "s"}
          </summary>
          <div className="mt-1 space-y-1.5">
            {node.thinking.map((t, i) => (
              <div
                key={i}
                className="rounded border-l-2 border-blue-200 bg-blue-50/40 px-2 py-1 text-[11px] text-gray-700 whitespace-pre-wrap"
              >
                {t.text}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">
        {title}
      </h3>
      <div className="rounded border border-gray-200 bg-white p-2.5">{children}</div>
    </section>
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

function findLastLlmCallInWorkflow(workflow: WorkFlow): LlmCallNode | null {
  const llms = workflow.nodes.filter(
    (n): n is LlmCallNode => n.kind === "llm_call",
  );
  return llms.length > 0 ? llms[llms.length - 1] : null;
}

// "session 触及文件" — side-by-side comparison of file-history-snapshot
// (CC's `trackedFileBackups` snapshot — its INTERNAL Read/Edit/Write
// backup index, NOT `git status` output, despite the misleading early
// design notes) against the ChatNode's WorkFlow tool_use file paths
// (Edit/Write/MultiEdit/NotebookEdit). Lets the reader spot side-
// effect modifications — a path the backup tracker recorded but no
// Edit/Write touched typically came from a Bash mutation, sub-agent,
// or hook.
//
// Path-level row format:
//   <path>    [📸 snapshot]    [🔧 tool_use]
// Both columns present  → normal black                — declared edit
// Only snapshot         → amber + ⚠ in tool_use cell  — likely side-effect
//                                                       (Bash / sub-agent /
//                                                       hook), or just a
//                                                       Read (backup tracker
//                                                       doesn't distinguish)
// Only tool_use         → amber + 🔧 in snapshot cell — write didn't make
//                                                       it to backups (rare)
//
// v0.8.1 #9: "本节点新触及文件" — paths newly entering the cumulative
// `trackedFileBackups` set at THIS node, plus tool_use paths. Strips
// the inherited cumulative set from ancestors. See `nodeOwnFileChanges`
// for the algorithm.
function NodeOwnFileChangesSection({
  chatNode,
  chatFlow,
}: {
  chatNode: ChatNode;
  chatFlow: ChatFlow;
}) {
  const paths = useMemo(
    () => Array.from(nodeOwnFileChanges(chatNode, chatFlow)).sort(),
    [chatNode, chatFlow],
  );
  const toolUsePaths = useMemo(() => distinctToolUseFiles(chatNode), [chatNode]);
  if (paths.length === 0) return null;
  return (
    <Section title={`本节点新触及文件 (${paths.length})`}>
      <div
        data-testid="node-own-file-changes"
        className="text-[11px] font-mono"
      >
        {paths.map((path) => {
          const inTool = toolUsePaths.has(path);
          return (
            <div
              key={path}
              data-testid={`nofc-row-${path}`}
              className="flex items-center gap-2 py-0.5 text-gray-800"
              title={
                inTool
                  ? "本节点 tool_use 显式改 (Edit/Write/...)"
                  : "首次出现在 CC trackedFileBackups 中（相对祖先最近一次 snapshot）— 可能是 Read / Bash / sub-agent / hook 触及"
              }
            >
              <span className="text-gray-400">{inTool ? "🔧" : "📸"}</span>
              <span className="break-all">{path}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-1 text-[10px] text-gray-400">
        相对祖先节点最近一次 trackedFileBackups 快照新增的文件 + 本节点
        tool_use 显式改的文件。包含 Read（CC 内部 backup tracker 不区分读写）。
        剔除了 session 累积触及集合（即在祖先节点已经触及过的）。
      </div>
    </Section>
  );
}

function FileHistorySnapshotsSection({ chatNode }: { chatNode: ChatNode }) {
  const snapshots = chatNode.meta.fileHistorySnapshots ?? [];
  // Latest snapshot wins — represents the cumulative trackedFileBackups
  // index at the end of this turn. (Earlier snapshots are dropped: CC
  // accumulates monotonically across the session, so the last frame
  // already supersets every earlier frame.)
  const latest = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
  const snapshotPaths = new Set(latest?.trackedFiles ?? []);
  const toolUsePaths = distinctToolUseFiles(chatNode);
  const union = Array.from(new Set([...snapshotPaths, ...toolUsePaths])).sort();
  if (union.length === 0) return null;
  return (
    <Section title={`session 触及文件 (${union.length})`}>
      <div
        data-testid="file-history-snapshot-list"
        className="text-[11px] font-mono"
      >
        <div className="mb-1 grid grid-cols-[1fr_auto_auto] gap-x-2 text-[9px] uppercase tracking-wide text-gray-400">
          <div>path</div>
          <div
            className="text-center"
            title="出现在最新 trackedFileBackups 中（CC 内部 Read/Edit/Write 备份索引）"
          >
            📸 backups
          </div>
          <div className="text-center" title="出现在 ChatNode 的 tool_use input.file_path 中">
            🔧 tool_use
          </div>
        </div>
        {union.map((path) => {
          const inSnap = snapshotPaths.has(path);
          const inTool = toolUsePaths.has(path);
          // Backup-only: in trackedFileBackups but no Edit/Write tool_use
          // claimed this path. Could be Read / Bash mutation / sub-agent.
          const readOrSideEffect = inSnap && !inTool;
          // Reverse mismatch: tool_use claims write but trackedFileBackups
          // didn't record it (rare).
          const ghostWrite = inTool && !inSnap;
          const rowClass = readOrSideEffect || ghostWrite ? "text-amber-700" : "text-gray-800";
          return (
            <div
              key={path}
              data-testid={`fh-row-${path}`}
              className={`grid grid-cols-[1fr_auto_auto] gap-x-2 py-0.5 ${rowClass}`}
              title={
                readOrSideEffect
                  ? "在 backup 索引但无显式 Edit/Write — 多半是 Read，少数情况是 Bash / sub-agent / hook 改的"
                  : ghostWrite
                    ? "tool_use 声称改了但 backup 索引没追到 — 罕见"
                    : path
              }
            >
              <div>{path}</div>
              <div className="text-center" data-testid={`fh-${path}-snap`}>
                {inSnap ? (readOrSideEffect ? "📸" : "✓") : "—"}
              </div>
              <div className="text-center" data-testid={`fh-${path}-tool`}>
                {inTool ? (ghostWrite ? "🔧" : "✓") : readOrSideEffect ? "⚠" : "—"}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1 text-[10px] text-gray-400">
        backups：CC 内部 `trackedFileBackups` 索引——session 累积的 Read/Edit/Write 触及路径，<strong>不是 git 工作区 dirty</strong>（commit 后不会减少）；
        tool_use：本节点 Edit/Write/MultiEdit/NotebookEdit 显式改的路径。
        amber 行 = 两边对不上（多半是 Read，少数是副作用 / ghost write）。要看仅本节点首次触及的，看上方"本节点新触及文件"。
        （要看真 git 工作区 dirty 集合 → backlog B：实时 git status 视图）
      </div>
    </Section>
  );
}
