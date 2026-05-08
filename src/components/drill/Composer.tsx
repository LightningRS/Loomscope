// v∞.1 prep — composer input box at the bottom of the Conversation tab.
//
// This is a UI shell for now: textarea + send button + drag-resizable
// height. Submit is a no-op placeholder (logs + clears) until v∞.1
// wires it to the Agent SDK `query()` flow. Style mirrors Agentloom's
// ComposerFooter (top-edge drag handle, light gray surround, white
// textarea, blue rounded send button) so users moving between the two
// projects feel at home.
//
// Resize: drag the top edge up/down to grow/shrink. Height clamped to
// [MIN, MAX] and persisted in localStorage so it survives refresh.
// Pointer-capture on the handle so a fast drag that leaves the bar
// doesn't lose the gesture (mirrors the canvas resize pattern).

import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as RPointerEvent } from "react";
import { useTranslation } from "react-i18next";

const MIN_HEIGHT = 80;
const MAX_HEIGHT = 480;
const DEFAULT_HEIGHT = 120;
const STORAGE_KEY = "loomscope:composer:height";

interface Props {
  // Disabled while SDK isn't wired. When eventually true, Send becomes
  // active and clears + dispatches the typed text. v∞.1 will flip it.
  disabled?: boolean;
  // Placeholder override for callers that want a custom hint (e.g.
  // "type to spawn a new session" vs "continue this session").
  placeholder?: string;
}

export function Composer({ disabled = true, placeholder }: Props) {
  const { t } = useTranslation();
  const [height, setHeight] = useState<number>(() => loadHeight());
  const [text, setText] = useState("");
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);
  const handleRef = useRef<HTMLDivElement | null>(null);

  // Persist height as user drags. Throttling not needed at human-drag
  // rates, but only writes once per setHeight call thanks to the
  // useEffect guard pattern below.
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(height));
    } catch {
      /* localStorage may be disabled/full — ignore */
    }
  }, [height]);

  const onPointerDown = useCallback(
    (e: RPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      dragRef.current = { startY: e.clientY, startH: height };
      handleRef.current?.setPointerCapture(e.pointerId);
    },
    [height],
  );

  const onPointerMove = useCallback(
    (e: RPointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      const delta = dragRef.current.startY - e.clientY;
      const next = clamp(
        dragRef.current.startH + delta,
        MIN_HEIGHT,
        MAX_HEIGHT,
      );
      setHeight(next);
    },
    [],
  );

  const onPointerUp = useCallback(
    (e: RPointerEvent<HTMLDivElement>) => {
      dragRef.current = null;
      try {
        handleRef.current?.releasePointerCapture(e.pointerId);
      } catch {
        /* releaseCapture throws if capture was never set — ignore */
      }
    },
    [],
  );

  const canSend = !disabled && text.trim().length > 0;

  const onSend = () => {
    if (!canSend) return;
    // v∞.1 will replace this with the actual SDK query dispatch.
    // For now: log + clear so the UI is responsive but no API call
    // happens.
    console.log("[loomscope:composer] submit (placeholder):", text);
    setText("");
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Cmd+Enter / Ctrl+Enter submits; plain Enter inserts newline.
    // Matches Agentloom ergonomics and avoids accidental submits when
    // typing multi-line prompts.
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div
      data-testid="composer"
      className="flex flex-col flex-shrink-0"
      style={{ height, minHeight: MIN_HEIGHT }}
    >
      {/* Drag handle: top-edge bar with a centered visual grip. Grows
          on hover so users notice it's interactive. */}
      <div
        ref={handleRef}
        data-testid="composer-resize-handle"
        className="group flex h-1.5 cursor-row-resize items-center justify-center border-t border-gray-200 bg-white hover:bg-blue-50"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div className="h-0.5 w-8 rounded-full bg-gray-300 group-hover:bg-blue-400" />
      </div>

      <div className="flex min-h-0 flex-1 flex-col bg-gray-50 px-3 py-2">
        {disabled && (
          <div className="mb-1 text-[10px] italic text-gray-400">
            {t("composer.placeholder_notice")}
          </div>
        )}
        <div className="flex min-h-0 flex-1 gap-2">
          <textarea
            data-testid="composer-input"
            className="min-h-0 flex-1 resize-none rounded border border-gray-200 bg-white px-2 py-1 text-[12px] text-gray-700 placeholder:text-gray-400 focus:border-blue-300 focus:outline-none disabled:bg-gray-100 disabled:text-gray-400"
            placeholder={placeholder ?? t("composer.placeholder_input")}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={disabled}
            rows={3}
          />
          <button
            type="button"
            data-testid="composer-send"
            disabled={!canSend}
            onClick={onSend}
            className="self-end rounded bg-blue-500 px-3 py-1 text-[12px] text-white hover:bg-blue-600 disabled:bg-gray-300 disabled:text-gray-500"
            title={t("composer.send_tooltip")}
          >
            {t("composer.send")}
          </button>
        </div>
      </div>
    </div>
  );
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function loadHeight(): number {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (!v) return DEFAULT_HEIGHT;
    const n = Number(v);
    if (!Number.isFinite(n)) return DEFAULT_HEIGHT;
    return clamp(n, MIN_HEIGHT, MAX_HEIGHT);
  } catch {
    return DEFAULT_HEIGHT;
  }
}
