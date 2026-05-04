// Global keyboard navigation. Vim-ish: j/k for prev/next ChatNode in
// the current path, Enter to drill into the focused ChatNode's
// WorkFlow, Esc to pop the drill stack.
//
// Only ChatNode-level navigation is wired. WorkFlow-level j/k could
// land later but isn't on the v0.10 list.
//
// Stale-closure-proof: handler reads fresh state via useStore.getState()
// at fire time, so this hook can mount once at the App level with an
// empty deps array.

import { useEffect } from "react";

import { resolvePath, findLatestLeafId } from "@/components/drill/pathUtils";
import { useStore } from "@/store/index";

export function useKeyboardNav(): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Skip while user is typing into an input / textarea / editable.
      // Defensive even though Loomscope has no composers yet — we'll
      // get them in v∞.2 and this avoids hijacking those keys.
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) {
        return;
      }
      // Don't interfere with modifier-key combos (browser shortcuts).
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const s = useStore.getState();
      const sid = s.activeSessionId;
      if (!sid) return;
      const sess = s.sessions.get(sid);
      const chatFlow = sess?.chatFlow ?? null;
      if (!chatFlow) return;

      // For nav purposes the "scope" is the top-level chatFlow; in
      // sub-chatflow drill we let user esc out first to navigate the
      // outer flow. (Inner sub-chatflow keyboard nav can come later;
      // pathUtils.resolvePath only knows the top-level fork map.)
      const drillStack = sess?.drillStack ?? [];

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        const sel =
          sess?.selectedNodeId ?? findLatestLeafId(chatFlow) ?? null;
        const { path } = resolvePath(chatFlow, sel);
        const idx = sel ? path.indexOf(sel) : path.length - 1;
        const nextId = path[idx + 1];
        if (nextId) s.setSelected(sid, nextId);
        return;
      }

      if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        const sel =
          sess?.selectedNodeId ?? findLatestLeafId(chatFlow) ?? null;
        const { path } = resolvePath(chatFlow, sel);
        const idx = sel ? path.indexOf(sel) : path.length - 1;
        if (idx > 0) s.setSelected(sid, path[idx - 1]);
        return;
      }

      if (e.key === "Enter") {
        if (drillStack.length === 0 && sess?.selectedNodeId) {
          // Only enter WorkFlow from top-level ChatFlow view, not when
          // already drilled (drillStack non-empty).
          e.preventDefault();
          s.enterWorkflow(sid, sess.selectedNodeId);
        }
        return;
      }

      if (e.key === "Escape") {
        if (drillStack.length > 0) {
          e.preventDefault();
          s.exitWorkflow(sid);
        }
        return;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}
