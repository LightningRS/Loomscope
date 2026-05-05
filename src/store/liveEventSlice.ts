// v0.9.1: tracks SSE connection state per channel so the Header live
// indicator can show green/amber/red. App.tsx owns the EventSource
// lifecycle and calls setLiveStatus on readyState transitions.
//
// subscribeSession / unsubscribeSession remain as no-op stubs from the
// pre-v0.9 v∞.0 sketch — kept so existing tests still pass; v∞.0 will
// flesh them out when hook event reconciliation lands.

import type { StateCreator } from "zustand";

import type { LiveEventSlice, LoomscopeStore } from "@/store/types";

export const createLiveEventSlice: StateCreator<
  LoomscopeStore,
  [],
  [],
  LiveEventSlice
> = (set) => ({
  ssePending: new Map<string, unknown>(),
  liveStatus: { session: "idle", workspaces: "idle" },
  setLiveStatus: (channel, state) =>
    set((s) => ({
      liveStatus: { ...s.liveStatus, [channel]: state },
    })),
  // No-ops; v∞.0 hook reconciliation will replace.
  subscribeSession: () => undefined,
  unsubscribeSession: () => undefined,
});
