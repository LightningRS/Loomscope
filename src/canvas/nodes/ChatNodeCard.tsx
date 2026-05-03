// Visual chrome for a single ChatNode (ChatFlow layer).
//
// Faithfully ports Agentloom ChatFlowNodeCard's signature look so the
// two projects feel like family:
//   - w-52 (208px) narrow card, rounded-lg, p-2.5
//   - 3px colored left-accent strip based on state
//   - whole-card bg color when special state (compact/scheduled/root)
//   - selected: ring-2 ring-blue-200 + border-blue-500
//   - TokenBar at the bottom (blue → amber → rose gradient)
//   - text-[10px] colored micro-headers per section
//
// Loomscope-specific: handles are non-interactive (viewer mode) and
// invisible when no edge connects.

import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";

import { type ChatNodeRFNode } from "@/canvas/layoutDag";
import { NodeIdLine } from "@/canvas/nodes/chrome/NodeIdLine";
import { TokenBar } from "@/canvas/nodes/chrome/TokenBar";
import { useStore } from "@/store/index";
import { useIsChatNodeSelected } from "@/store/selectionHooks";

export function ChatNodeCard({ id, data }: NodeProps<ChatNodeRFNode>) {
  const cn = data.chatNode;
  // Selection now subscribes per-card from the store rather than
  // arriving via NodeProps. The canvas wrapper used to recompute
  // `decoratedNodes = nodes.map(...)` on every selection change, which
  // re-allocated all 1500 cards' object identities and forced React
  // Flow to reconcile the entire graph. Subscribing per-card means
  // 1498 cards see `false → false` and skip re-render.
  const selected = useIsChatNodeSelected(id);
  const compact = data.isCompactSummary;
  const triggerSchedule = cn.trigger === "scheduled";
  const slash = data.slashCommand;
  const isRoot = cn.parentChatNodeId === null && !data.hasIncomingEdge;
  const isLeaf =
    !data.hasOutgoingEdge && !isRoot && !compact && !triggerSchedule && !slash;

  // Slash-command ChatNodes get their own dedicated card body — no
  // 用户/助手 sections, no 进入工作流, no token bar, no stats. They're
  // not LLM turns; they're CC-side actions.
  if (slash) {
    return (
      <SlashCommandCard
        cn={cn}
        slash={slash}
        selected={selected}
        hasIncoming={data.hasIncomingEdge}
        hasOutgoing={data.hasOutgoingEdge}
      />
    );
  }

  // Background tint by primary state.
  const bgClass = compact
    ? "bg-teal-50"
    : triggerSchedule
      ? "bg-amber-50"
      : isRoot
        ? "bg-blue-50/60"
        : isLeaf
          ? "bg-green-50"
          : "bg-white";

  // 3px left accent strip — Agentloom signature.
  const accentClass = compact
    ? "border-l-[3px] border-l-teal-500"
    : triggerSchedule
      ? "border-l-[3px] border-l-amber-500"
      : isRoot
        ? "border-l-[3px] border-l-blue-400"
        : isLeaf
          ? "border-l-[3px] border-l-green-400"
          : "";

  // Border color around the rest of the card.
  const borderClass = selected
    ? "border-blue-500 ring-2 ring-blue-200"
    : compact
      ? "border-teal-300"
      : triggerSchedule
        ? "border-amber-300"
        : isLeaf
          ? "border-green-300"
          : "border-gray-300 hover:border-gray-400";

  return (
    <div
      className={[
        "group/card relative w-52 rounded-lg border shadow-sm p-2.5 text-xs",
        "transition-colors leading-snug",
        bgClass,
        accentClass,
        borderClass,
      ].join(" ")}
      data-testid={`chat-node-${cn.id}`}
    >
      {/* Handles — invisible 0×0 when no edge connects (viewer mode). */}
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        style={
          data.hasIncomingEdge
            ? { background: "#94a3b8", width: 5, height: 5, border: "none" }
            : { background: "transparent", width: 0, height: 0, border: "none" }
        }
      />

      {/* State chip — only for functional events (compact / scheduled).
          chat / root / leaf are visually inferable from the colored left
          accent strip + position; no need to repeat as text. */}
      {(compact || triggerSchedule) && (
        <div className="flex items-center mb-1.5">
          {compact ? (
            <span className="inline-flex items-center gap-0.5 rounded bg-teal-200/80 px-1 py-0.5 text-[10px] font-semibold text-teal-900">
              ⊞ compact
            </span>
          ) : (
            <span className="inline-flex items-center gap-0.5 rounded bg-amber-200/80 px-1 py-0.5 text-[10px] font-semibold text-amber-900">
              ⏰ scheduled
            </span>
          )}
        </div>
      )}

      {/* User message — label gray-500 to match Agentloom convention.
          Strings hardcoded zh-CN for v0.2; will move to i18n bundle when
          react-i18next phase lands (key: chatflow.user / chatflow.assistant).
          Future en-US: "User" / "Assistant". */}
      <div className="mb-1.5">
        <div className="text-[10px] text-gray-500 mb-0.5">用户</div>
        <div className="text-[11px] text-gray-900 break-words line-clamp-2">
          {data.userPreview || <span className="italic text-gray-300">(空)</span>}
        </div>
      </div>

      {/* Assistant reply */}
      <div className="mb-1.5">
        <div className="text-[10px] text-gray-500 mb-0.5">助手</div>
        <div className="text-[11px] text-gray-900 break-words line-clamp-2">
          {data.assistantPreview || <span className="italic text-gray-300">(无回复)</span>}
        </div>
      </div>

      {/* Enter-WorkFlow drill button — always visible (Agentloom convention).
          Compact ChatNodes don't have inner WorkFlow (already summarized),
          so the button is hidden for them. We also hide for ChatNodes
          with empty WorkFlow (slash-command paths handled separately
          above; this catches edge cases like compact-summary-only). */}
      {!compact && cn.workflow.nodes.length > 0 && (
        <DrillButton chatNodeId={cn.id} />
      )}

      {/* Token bar */}
      {data.contextTokens > 0 && (
        <TokenBar tokens={data.contextTokens} maxTokens={data.maxContextTokens} />
      )}

      {/* Stats row */}
      <div className="mt-1.5 flex items-center gap-2.5 text-[10px] text-gray-500 border-t border-gray-200/60 pt-1">
        <span className="inline-flex items-center gap-0.5">
          <span className="text-blue-500">🧠</span>
          <span className="font-mono">{data.llmCount}</span>
        </span>
        <span className="inline-flex items-center gap-0.5">
          <span className="text-amber-500">🔧</span>
          <span className="font-mono">{data.toolCount}</span>
        </span>
        {data.totalThinkingChars > 0 && (
          <span className="text-gray-400 font-mono">
            ▸{Math.round(data.totalThinkingChars / 100) / 10}k
          </span>
        )}
        {data.fileTouchCount > 0 && (
          <span
            className="inline-flex items-center gap-0.5"
            title={`本轮文件改动 (${data.fileTouchCount} 个)`}
            data-testid={`chat-node-${cn.id}-file-touch`}
          >
            <span className="text-gray-400">📁</span>
            <span className="font-mono">{data.fileTouchCount}</span>
          </span>
        )}
      </div>

      {/* Full UUID centered at bottom — Agentloom convention. CSS truncate
          if doesn't fit. Click to copy (Agentloom NodeIdLine pattern). */}
      <NodeIdLine nodeId={cn.id} />

      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        style={
          data.hasOutgoingEdge
            ? { background: "#94a3b8", width: 5, height: 5, border: "none" }
            : { background: "transparent", width: 0, height: 0, border: "none" }
        }
      />

    </div>
  );
}

// Slash-command card — minimal chrome: violet accent, ⚡ command name,
// stdout body (mono, multi-line), id at bottom.
function SlashCommandCard({
  cn,
  slash,
  selected,
  hasIncoming,
  hasOutgoing,
}: {
  cn: import("@/data/types").ChatNode;
  slash: NonNullable<import("@/data/types").ChatNode["slashCommand"]>;
  selected: boolean;
  hasIncoming: boolean;
  hasOutgoing: boolean;
}) {
  const containerClass = [
    "group/card relative w-52 rounded-lg border shadow-sm p-2.5 text-xs",
    "transition-colors leading-snug bg-violet-50",
    "border-l-[3px] border-l-violet-500",
    selected ? "border-violet-500 ring-2 ring-violet-200" : "border-violet-300",
  ].join(" ");
  return (
    <div className={containerClass} data-testid={`chat-node-${cn.id}`}>
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        style={
          hasIncoming
            ? { background: "#94a3b8", width: 5, height: 5, border: "none" }
            : { background: "transparent", width: 0, height: 0, border: "none" }
        }
      />

      {/* Command header — violet chip with ⚡ + /name */}
      <div className="flex items-center mb-1.5">
        <span className="inline-flex items-center gap-0.5 rounded bg-violet-200/80 px-1 py-0.5 text-[10px] font-semibold text-violet-900">
          ⚡ {slash.name}
          {slash.args ? ` ${slash.args}` : ""}
        </span>
      </div>

      {/* Stdout (if any) */}
      {slash.stdout && (
        <div className="mb-1.5">
          <div className="text-[10px] text-gray-500 mb-0.5">输出</div>
          <pre className="text-[11px] text-gray-900 break-words whitespace-pre-wrap font-mono line-clamp-4 m-0">
            {slash.stdout}
          </pre>
        </div>
      )}

      <NodeIdLine nodeId={cn.id} />

      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        style={
          hasOutgoing
            ? { background: "#94a3b8", width: 5, height: 5, border: "none" }
            : { background: "transparent", width: 0, height: 0, border: "none" }
        }
      />
    </div>
  );
}

// Drill-down button — pushes a ``chatnode`` frame onto the session's
// drillStack, switching the main viewport to WorkFlowCanvas. Pulled out
// as its own component so the store subscription is tied to the button
// and doesn't re-render the whole ChatNodeCard when ``activeSessionId``
// changes for unrelated reasons.
function DrillButton({ chatNodeId }: { chatNodeId: string }) {
  const enter = useStore((s) => s.enterWorkflow);
  const activeId = useStore((s) => s.activeSessionId);
  return (
    <button
      type="button"
      className="mt-1 flex w-full items-center justify-center gap-1 rounded border border-gray-200 bg-gray-50 px-2 py-1 text-[10px] text-gray-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 transition-colors"
      onClick={(e) => {
        e.stopPropagation();
        if (!activeId) return;
        enter(activeId, chatNodeId);
      }}
      data-testid={`enter-workflow-${chatNodeId}`}
    >
      <span>⤢</span>
      <span>进入工作流</span>
    </button>
  );
}

