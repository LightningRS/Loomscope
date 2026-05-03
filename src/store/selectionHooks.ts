// Per-node selection subscriptions.
//
// Why this exists: ChatNodeCard / WorkNode cards used to read `selected`
// from React Flow's NodeProps, with the canvas wrapper computing
// `decoratedNodes = nodes.map((n) => ({ ...n, selected: ... }))` on
// every selection change. That gave every node a fresh object identity
// per click, so React Flow reconciled the entire 1500-card graph each
// time — measured 458 ms round-trip on a 256MB session in v0.4.
//
// These hooks let each card subscribe directly to "is this id the
// selected one?" through a Zustand selector that returns a boolean.
// Default Object.is equality means 1498 cards see `false → false` and
// don't re-render; only the deselect + new-select pair flips state and
// re-renders. That cuts the worst-case re-render count from N to 2.

import { useStore } from "@/store/index";

/** True iff `id` is the currently selected ChatNode in the active session. */
export function useIsChatNodeSelected(id: string): boolean {
  return useStore((s) => {
    const sid = s.activeSessionId;
    if (!sid) return false;
    return s.sessions.get(sid)?.selectedNodeId === id;
  });
}

/** True iff `id` is the currently selected WorkNode in the active session. */
export function useIsWorkNodeSelected(id: string): boolean {
  return useStore((s) => {
    const sid = s.activeSessionId;
    if (!sid) return false;
    return s.sessions.get(sid)?.workflowSelectedNodeId === id;
  });
}

/**
 * v0.6 unified selection hook — returns true iff `id` is selected at
 * EITHER the ChatFlow layer (legacy ``selectedNodeId``) or the
 * WorkFlow layer (legacy ``workflowSelectedNodeId``). During the
 * v0.6 transition (M2 → M5) both writers coexist; once M5 collapses
 * selection per抉择 3 the WorkFlow check becomes a no-op and this
 * hook becomes the canonical selector.
 *
 * Per-card subscription model is preserved exactly: each card
 * subscribes to one boolean, and identity-equal returns short-circuit
 * Zustand's render diff so 1498 cards still skip re-render on a
 * single-node selection change.
 */
export function useIsNodeSelected(id: string): boolean {
  return useStore((s) => {
    const sid = s.activeSessionId;
    if (!sid) return false;
    const sess = s.sessions.get(sid);
    if (!sess) return false;
    return sess.selectedNodeId === id || sess.workflowSelectedNodeId === id;
  });
}
