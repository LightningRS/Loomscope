// logical edge — dashed gray Bezier with a小 outline arrow head. Used
// in the ChatFlow layer to draw the反向弧 from a compact ChatNode
// back to the pre-compact tail ChatNode that its logicalParentUuid
// references (per design-visual-language.md "logical: 虚线浅灰 + 反向弧").
//
// source = compact ChatNode (visually right, time later)
// target = pre-compact tail ChatNode (visually left, time earlier)
//
// React Flow's default Bezier with sourcePosition=Right + targetPosition=Left
// + sourceX > targetX (because we point backwards in time on an LR
// layout) naturally produces a loop-back path: out the source's right,
// up and around, into the target's left. That's exactly the "反向弧"
// the spec calls for — no custom path math needed.

import { BaseEdge, getBezierPath } from "@xyflow/react";
import type { EdgeProps } from "@xyflow/react";

const LOGICAL_COLOR = "#94a3b8"; // slate-400 — same hue as continuation but de-emphasised via dashed stroke

export function LogicalEdge(props: EdgeProps) {
  const [d] = getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
    // Higher curvature than continuation to make the loop visually
    // distinct — 0.6 vs 0.25 — so the arc doesn't get visually
    // confused with a regular continuation when nodes are close.
    curvature: 0.6,
  });
  return (
    <BaseEdge
      id={props.id}
      path={d}
      style={{
        stroke: LOGICAL_COLOR,
        strokeWidth: 1.25,
        strokeDasharray: "4 3",
      }}
      markerEnd="url(#arrow-logical)"
    />
  );
}

export function LogicalArrowDefs() {
  return (
    <defs>
      <marker
        id="arrow-logical"
        viewBox="0 0 10 10"
        refX="9"
        refY="5"
        markerWidth="5"
        markerHeight="5"
        orient="auto"
      >
        {/* Outline arrow — slightly smaller than continuation/spawn so
            the logical edge doesn't compete visually with主链 edges. */}
        <path
          d="M 0 0 L 10 5 L 0 10 z"
          fill="none"
          stroke={LOGICAL_COLOR}
          strokeWidth="1.25"
        />
      </marker>
    </defs>
  );
}
