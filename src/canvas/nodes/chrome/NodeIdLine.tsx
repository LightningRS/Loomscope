// Click-to-copy node id line. Shared by ChatNodeCard + every WorkNode
// card so the "what id is this exactly" affordance is uniform across
// both layers (v0.6 redo M4 — chrome atoms shared per the NodeBase
// interop work).
//
// Behavior copied from the original ChatNodeCard implementation: state
// machine idle / copied / error, fades back to idle after a timeout,
// stops propagation so the click doesn't also trigger node selection.

import { useState } from "react";

import { copyToClipboardWithFallback } from "@/lib/clipboard";

type CopyState =
  | { kind: "idle" }
  | { kind: "copied" }
  | { kind: "error"; msg: string };

export function NodeIdLine({ nodeId }: { nodeId: string }) {
  const [state, setState] = useState<CopyState>({ kind: "idle" });

  const onClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const result = await copyToClipboardWithFallback(nodeId);
    if (result.ok) {
      setState({ kind: "copied" });
      window.setTimeout(() => setState({ kind: "idle" }), 900);
    } else {
      setState({ kind: "error", msg: result.reason });
      // Keep error visible longer so user can read.
      window.setTimeout(() => setState({ kind: "idle" }), 2500);
    }
  };

  const className = [
    "mt-1 cursor-pointer truncate font-mono text-[9px] text-center transition-colors",
    state.kind === "copied"
      ? "text-teal-600"
      : state.kind === "error"
        ? "text-rose-600"
        : "text-gray-400 hover:text-blue-500",
  ].join(" ");

  const display =
    state.kind === "copied"
      ? "已复制"
      : state.kind === "error"
        ? `✗ 复制失败：${state.msg}`
        : nodeId;

  const title =
    state.kind === "copied"
      ? "已复制"
      : state.kind === "error"
        ? `复制失败：${state.msg}`
        : nodeId;

  return (
    <div onClick={onClick} className={className} title={title} data-testid={`node-id-${nodeId}`}>
      {display}
    </div>
  );
}
