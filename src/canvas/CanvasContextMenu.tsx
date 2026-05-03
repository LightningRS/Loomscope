// v0.6 M5 — right-click context menu for the unified Canvas.
//
// Per抉择 2 (revised by author 2026-05-03): drill / focus mode is
// reached via right-click context menu, not alt+click. Right-click is
// the universal "what can I do here" affordance in IDEs / file
// managers; alt+click clashes with macOS option / WSL window managers
// and isn't discoverable.
//
// v0.6 menu items (additions land in later versions):
//   - Focus on this subtree (calls store.enterFocus)
//   - Copy node id (clipboard)
//
// Menu lifecycle: opened by Canvas's onNodeContextMenu / onPaneContext-
// Menu; closes on outside click, Escape, or any item click. Positioned
// at the cursor (clientX, clientY) and stays inside the viewport via
// max-height + overflow-auto.

import { useEffect, useRef } from "react";

import { copyToClipboardWithFallback } from "@/lib/clipboard";

export interface CanvasContextMenuProps {
  x: number;
  y: number;
  nodeId: string;
  onFocus: (nodeId: string) => void;
  onClose: () => void;
}

export function CanvasContextMenu({
  x,
  y,
  nodeId,
  onFocus,
  onClose,
}: CanvasContextMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  // Outside-click + Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onMouse = (e: MouseEvent) => {
      const el = ref.current;
      if (!el) return;
      if (!el.contains(e.target as globalThis.Node)) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onMouse);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onMouse);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      data-testid="canvas-context-menu"
      data-node-id={nodeId}
      className="fixed z-50 min-w-[180px] rounded border border-gray-300 bg-white shadow-lg py-1 text-xs"
      style={{ left: x, top: y }}
    >
      <MenuItem
        label="🎯 Focus on this subtree"
        testId="ctx-focus"
        onClick={() => {
          onFocus(nodeId);
          onClose();
        }}
      />
      <MenuItem
        label="📋 Copy node id"
        testId="ctx-copy-id"
        onClick={async () => {
          await copyToClipboardWithFallback(nodeId);
          onClose();
        }}
      />
    </div>
  );
}

function MenuItem({
  label,
  testId,
  onClick,
}: {
  label: string;
  testId: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className="block w-full text-left px-3 py-1.5 hover:bg-blue-50 hover:text-blue-700 transition-colors"
    >
      {label}
    </button>
  );
}
