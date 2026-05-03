// compact WorkNode card — folded preview only (v0.3 baseline). Full
// compact三色 chrome (auto teal / manual purple / failed rose) per
// design-visual-language is shipped here; the **expand → original
// pre-compact ChatNode sequence** drill behavior is v0.6.
//
// Note this is the WorkFlow-layer compact card (compact landed inside
// the inner WorkFlow of the post-compact ChatNode). The ChatFlow-layer
// compact node visual is already in ChatNodeCard via the
// ``isCompactSummary`` accent — that's the parent ChatNode chrome,
// distinct from the WorkNode rendered here.

import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";

import {
  WF_NODE_SIZE,
  compactSummaryPreview,
  type CompactRFNode,
} from "@/canvas/layoutWorkflow";
import { useIsWorkNodeSelected } from "@/store/selectionHooks";
import { handleStyle, workNodeChromeClass } from "./cardChrome";

export function CompactCard({ id, data }: NodeProps<CompactRFNode>) {
  const n = data.workNode;
  const trigger = n.trigger ?? "auto";
  // ``manual`` = user typed /compact (uncommon, worth highlighting).
  // ``auto`` = harness fired at context-window threshold (most common).
  const accent = trigger === "manual" ? "purple-compact" : "teal";
  const summary = compactSummaryPreview(n);
  const selected = useIsWorkNodeSelected(id);

  return (
    <div
      className={[
        workNodeChromeClass(accent, selected),
        // Dashed border per design-visual-language compact convention —
        // signals "this is a fold marker", not a normal node.
        "border-dashed",
      ].join(" ")}
      style={{ width: WF_NODE_SIZE.compact.width }}
      data-testid={`worknode-compact-${n.id}`}
      data-worknode-kind="compact"
      data-compact-trigger={trigger}
    >
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        style={handleStyle(data.hasIncomingEdge)}
      />
      <div className="flex items-center gap-1 mb-1">
        <span>⊞</span>
        <span
          className={[
            "text-[10px] font-medium",
            trigger === "manual" ? "text-purple-700" : "text-teal-700",
          ].join(" ")}
        >
          compact
        </span>
        <span
          className={[
            "ml-1 inline-flex items-center rounded px-1 py-0.5 text-[9px] font-semibold",
            trigger === "manual"
              ? "bg-purple-200/80 text-purple-900"
              : "bg-teal-200/80 text-teal-900",
          ].join(" ")}
        >
          {trigger === "manual" ? "✎ manual" : "🤖 auto"}
        </span>
        {n.preTokens != null && (
          <span className="ml-auto font-mono text-[9px] text-gray-500">
            {formatTokensShort(n.preTokens)} →
          </span>
        )}
      </div>
      {summary && (
        <div className="text-[10px] text-gray-700 break-words line-clamp-3 italic">
          {summary}
        </div>
      )}
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        style={handleStyle(data.hasOutgoingEdge)}
      />
    </div>
  );
}

function formatTokensShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}
