// Token-usage bar. Blue → amber → rose as the context fills.
//
// Originally lived inside ChatNodeCard for ChatFlow-layer rendering;
// extracted as a chrome atom in v0.6 redo M4 so WorkNode kinds that
// represent a model invocation (llm_call / delegate / compact) can
// surface the same visual signal. tool_call and attachment skip it
// per design抉择 4 — they don't carry their own model attribution.

import { TOKEN_BAR_DEFAULT_MAX, formatTokensKM } from "@/canvas/layoutDag";

export function TokenBar({
  tokens,
  maxTokens,
}: {
  tokens: number;
  maxTokens?: number | null;
}) {
  const denom = maxTokens && maxTokens > 0 ? maxTokens : TOKEN_BAR_DEFAULT_MAX;
  const pct = Math.min(100, (tokens / denom) * 100);
  const color =
    pct >= 90 ? "bg-rose-500" : pct >= 70 ? "bg-amber-400" : "bg-blue-400";
  return (
    <div className="mt-1" title={`${tokens} / ${formatTokensKM(denom)} tokens`}>
      <div className="flex items-center justify-between text-[9px] text-gray-500 mb-0.5">
        <span>{formatTokensKM(tokens)}</span>
        <span>{pct.toFixed(0)}%</span>
      </div>
      <div className="h-1 w-full rounded-full bg-gray-200 overflow-hidden">
        <div
          className={`h-1 rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
