// continuation edge — neutral slate-400 Bezier curve. Per-model colored
// ribbon overlay (ModelRibbonLayer) is shown only on edge hover.

import { BaseEdge, getBezierPath } from "@xyflow/react";
import type { EdgeProps } from "@xyflow/react";

const ARROW_COLOR = "#94a3b8"; // slate-400

export function ContinuationEdge(props: EdgeProps) {
  const [d] = getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
    curvature: 0.25,
  });
  return (
    <BaseEdge
      id={props.id}
      path={d}
      style={{ stroke: ARROW_COLOR, strokeWidth: 1.5 }}
      markerEnd="url(#arrow-continuation)"
    />
  );
}

export function ContinuationArrowDefs() {
  return (
    <defs>
      <marker
        id="arrow-continuation"
        viewBox="0 0 10 10"
        refX="9"
        refY="5"
        markerWidth="6"
        markerHeight="6"
        orient="auto"
      >
        <path d="M 0 0 L 10 5 L 0 10 z" fill={ARROW_COLOR} />
      </marker>
    </defs>
  );
}
