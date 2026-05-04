// Viewport-anchored fold toggle. Without anchoring, every fold /
// unfold triggers a full dagre relayout — every node's position
// shifts, the viewport stays put, and the user loses their place.
//
// Strategy: capture the host compact's screen-space position before
// the fold mutation, then after layout settles read its new position
// and shift the viewport by the delta. The host compact is the
// "semantic anchor": it's always visible regardless of fold state
// (fold → host stays + chatFold appears upstream; unfold → host
// stays + chatFold disappears), so we never lose the reference
// point.
//
// Provided by ChatFlowCanvas's CanvasInner; consumed by
// CompactFoldToggleButton (on a compact's "展开/折叠 pre-compact"
// button) and ChatFoldNodeCard (click-to-unfold). Both fall back to
// the raw store actions when the context is absent (= unit tests
// rendering the components in isolation).

import { createContext, useContext } from "react";

export interface FoldAnchorAPI {
  // Toggle, fold, unfold — same shape as the store actions but with
  // viewport anchoring layered on top. ``compactId`` is always the
  // HOST compact's ChatNode id (= the one that stays visible across
  // the toggle).
  toggle: (compactId: string) => void;
  fold: (compactId: string) => void;
  unfold: (compactId: string) => void;
}

export const FoldAnchorContext = createContext<FoldAnchorAPI | null>(null);

export function useFoldAnchor(): FoldAnchorAPI | null {
  return useContext(FoldAnchorContext);
}
