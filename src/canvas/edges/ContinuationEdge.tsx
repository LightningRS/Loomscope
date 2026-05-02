// continuation edge — Bezier curve, stroke colored by the target
// ChatNode's model. Mid-session model switches show up as different
// colored segments in the chain.
//
// Arrow marker uses a neutral slate-400 (always); minor color mismatch
// vs the per-model stroke is acceptable and avoids generating one
// marker per edge / per color.

import { BaseEdge, getBezierPath } from "@xyflow/react";
import type { EdgeProps } from "@xyflow/react";

import { colorForModel } from "@/canvas/modelColor";

const ARROW_COLOR = "#94a3b8"; // slate-400

export function ContinuationEdge(props: EdgeProps) {
  const targetModel = (props.data as { targetModel?: string } | undefined)?.targetModel;
  const stroke = colorForModel(targetModel);
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
      style={{ stroke, strokeWidth: 1.75 }}
      markerEnd="url(#arrow-continuation)"
    />
  );
}

// Shared marker definition — mounted once near the canvas root.
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
