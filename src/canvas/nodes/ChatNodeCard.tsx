// Visual chrome for a single ChatNode (ChatFlow layer).
//
// Per `design-visual-language.md` "视觉 token" 章节:
//   - Loomscope/Agentloom 共享色板：teal/rose/amber/purple/blue/gray
//   - text-[10px] colored micro-headers 标节
//   - bg-{color}-200/80 + text-{color}-900 saturated chips 标状态
//   - text-xs body / font-mono text-[10px] 元数据
//
// v0.2 omits token bar/duration aggregation — needs WorkFlow.usage walk
// (lands in v0.3 inner WorkFlow).  Compact rich chrome is v0.6.

import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";

import type { ChatNodeRFNode } from "@/canvas/layoutDag";

export function ChatNodeCard({ data, selected }: NodeProps<ChatNodeRFNode>) {
  const cn = data.chatNode;
  const compact = data.isCompactSummary;
  const triggerSchedule = cn.trigger === "scheduled";

  const containerClass = [
    "group/card relative rounded-md border bg-white shadow-sm transition-colors",
    "px-3 py-2 text-xs leading-snug",
    compact
      ? "border-dashed border-teal-300 bg-teal-50"
      : "border-gray-300 hover:border-gray-400",
    selected ? "ring-2 ring-blue-400 ring-offset-1" : "",
  ].join(" ");

  return (
    <div
      className={containerClass}
      style={{ width: 320, minHeight: 130 }}
      data-testid={`chat-node-${cn.id}`}
    >
      <Handle type="target" position={Position.Left} className="!bg-gray-400" />

      {/* Top row: kind chip (left) + id (right) */}
      <div className="flex items-center justify-between mb-1.5">
        {compact ? (
          <span className="inline-flex items-center gap-0.5 rounded bg-teal-200/80 px-1 py-0.5 text-[10px] font-semibold text-teal-900">
            ⊞ compact
          </span>
        ) : triggerSchedule ? (
          <span className="inline-flex items-center gap-0.5 rounded bg-amber-200/80 px-1 py-0.5 text-[10px] font-semibold text-amber-900">
            ⏰ scheduled
          </span>
        ) : (
          <span className="text-[10px] text-gray-400 font-medium">chat</span>
        )}
        <span className="font-mono text-[10px] text-gray-400">{cn.id.slice(0, 8)}</span>
      </div>

      {/* User message section */}
      <div className="mb-1.5">
        <div className="text-[10px] text-blue-600 mb-0.5 font-medium">用户</div>
        <div className="text-xs text-gray-900 break-words">
          {data.userPreview || <span className="italic text-gray-300">(空)</span>}
        </div>
      </div>

      {/* Agent reply section */}
      <div className="mb-1.5">
        <div className="text-[10px] text-purple-600 mb-0.5 font-medium">Agent</div>
        <div className="text-xs text-gray-900 break-words">
          {data.assistantPreview || <span className="italic text-gray-300">(无回复)</span>}
        </div>
      </div>

      {/* Bottom stats row */}
      <div className="mt-2 flex items-center gap-3 text-[10px] text-gray-500 border-t border-gray-100 pt-1">
        <span className="inline-flex items-center gap-1">
          <span className="text-blue-500">🧠</span>
          <span className="font-mono">{data.llmCount}</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="text-amber-500">🔧</span>
          <span className="font-mono">{data.toolCount}</span>
        </span>
        {data.totalThinkingChars > 0 && (
          <span className="text-gray-400 font-mono">
            ▸ thinking {Math.round(data.totalThinkingChars / 100) / 10}k
          </span>
        )}
      </div>

      <Handle type="source" position={Position.Right} className="!bg-gray-400" />
    </div>
  );
}
