// v∞.1 prep — composer input box at the bottom of the Conversation tab.
//
// Style mirrors claude.ai's web composer: rounded card with subtle
// border + shadow, transparent textarea filling the body, bottom row
// with a "+" attachment placeholder (left), model chip + send arrow
// (right). The disabled-state notice sits BELOW the card as a tiny
// disclaimer, mirroring claude.ai's "Claude is AI and can make
// mistakes" footer line.
//
// Settings popover (click the model chip): pick model / effort / fast
// mode. Selection persists to localStorage; v∞.1 reads these when
// dispatching SDK queries. The chip stays the only visible affordance
// (collapses model + advanced settings into one entry point) so the
// composer surface stays close to claude.ai's clean look.
//
// Resize: drag the top edge up/down. Height clamped to [MIN, MAX]
// and persisted in localStorage so it survives refresh. Pointer
// capture on the handle so a fast drag that leaves the bar doesn't
// lose the gesture.
//
// Submit is a no-op placeholder until v∞.1 wires it to the Agent SDK
// `query()` flow.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { PointerEvent as RPointerEvent } from "react";
import { useTranslation } from "react-i18next";

const MIN_HEIGHT = 96;
const MAX_HEIGHT = 480;
const DEFAULT_HEIGHT = 140;
const HEIGHT_KEY = "loomscope:composer:height";
const SETTINGS_KEY = "loomscope:composer:settings";

// Model list mirrors what Claude Code's `--model` flag accepts. Order
// = canonical "newest first" so Opus 4.7 (latest) is the default
// pick. v∞.1 may turn this into a server-fed list driven by the
// installed CC binary's `--list-models` if/when SDK exposes it.
const MODELS = [
  { id: "claude-opus-4-7", label: "Opus 4.7" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5" },
] as const;

const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
type Effort = (typeof EFFORT_LEVELS)[number];

interface ComposerSettings {
  model: string;
  effort: Effort;
  fastMode: boolean;
}

const DEFAULT_SETTINGS: ComposerSettings = {
  model: "claude-opus-4-7",
  effort: "medium",
  fastMode: false,
};

interface Props {
  // Disabled while SDK isn't wired. When eventually true, Send becomes
  // active and clears + dispatches the typed text. v∞.1 will flip it.
  disabled?: boolean;
  // Placeholder override for callers that want a custom hint.
  placeholder?: string;
  // Notification of height changes during drag. Parent uses this to
  // bump the conversation scroll container's scrollTop in lockstep
  // so the bottom-relative view stays put regardless of whether the
  // user was scrolled-to-bottom or somewhere mid-conversation.
  // Without this, dragging composer up while mid-conversation leaves
  // visible content frozen and the bottom row gets covered by the
  // growing composer.
  onResize?: (deltaPx: number) => void;
}

export function Composer({ disabled = true, placeholder, onResize }: Props) {
  const { t } = useTranslation();
  const [height, setHeight] = useState<number>(() => loadHeight());
  const [text, setText] = useState("");
  const [settings, setSettings] = useState<ComposerSettings>(() =>
    loadSettings(),
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);
  const handleRef = useRef<HTMLDivElement | null>(null);
  const menuWrapRef = useRef<HTMLDivElement | null>(null);

  // Persist height + settings to localStorage so refresh preserves UX.
  useEffect(() => {
    try {
      window.localStorage.setItem(HEIGHT_KEY, String(height));
    } catch {
      /* ignore */
    }
  }, [height]);
  useEffect(() => {
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* ignore */
    }
  }, [settings]);

  // Click-outside to close the menu. Single document listener active
  // only while the menu is open keeps this cheap.
  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!menuWrapRef.current) return;
      if (menuWrapRef.current.contains(e.target as Node)) return;
      setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

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
      // Functional setState so we read the freshest committed height
      // (ref-tracked startH is the drag-anchor height; height state
      // changes mid-drag if user lifts past clamp boundaries).
      setHeight((cur) => {
        const heightDelta = next - cur;
        if (heightDelta !== 0 && onResize) {
          // composer +Δ means viewport -Δ → scrollTop must move by
          // +Δ to keep the same bottom edge visible. Same sign holds
          // when composer shrinks (Δ < 0 → scrollTop decreases).
          onResize(heightDelta);
        }
        return next;
      });
    },
    [onResize],
  );

  const onPointerUp = useCallback((e: RPointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    try {
      handleRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  const canSend = !disabled && text.trim().length > 0;

  const onSend = () => {
    if (!canSend) return;
    // v∞.1 replaces this with the actual SDK query dispatch.
    console.log(
      "[loomscope:composer] submit (placeholder):",
      text,
      settings,
    );
    setText("");
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Cmd/Ctrl+Enter submits; plain Enter inserts newline.
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onSend();
    }
  };

  const modelLabel =
    MODELS.find((m) => m.id === settings.model)?.label ?? settings.model;

  return (
    <div
      data-testid="composer"
      className="flex flex-col flex-shrink-0 bg-gray-50"
      style={{ height, minHeight: MIN_HEIGHT }}
    >
      <div
        ref={handleRef}
        data-testid="composer-resize-handle"
        className="group flex h-1.5 cursor-row-resize items-center justify-center border-t border-gray-200 hover:bg-blue-50"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div className="h-0.5 w-8 rounded-full bg-gray-300 group-hover:bg-blue-400" />
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-3 pt-2 pb-1">
        <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-gray-200 bg-white px-3 py-2 shadow-sm transition-shadow focus-within:border-gray-300 focus-within:shadow">
          <textarea
            data-testid="composer-input"
            className="min-h-0 flex-1 resize-none border-0 bg-transparent text-[13px] leading-relaxed text-gray-800 placeholder:text-gray-400 focus:outline-none disabled:text-gray-400"
            placeholder={placeholder ?? t("composer.placeholder_input")}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={disabled}
          />
          <div className="flex flex-shrink-0 items-center justify-between pt-1">
            {/* Left: attachment placeholder. v∞.2 will wire this. */}
            <button
              type="button"
              disabled
              data-testid="composer-attach"
              title={t("composer.attach_tooltip")}
              className="flex h-7 w-7 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <PlusIcon />
            </button>

            {/* Right: settings chip + send arrow. The chip is a
                popover trigger (model + effort + fast mode all in
                one menu). Wrapping div anchors the popover and is
                also the click-outside boundary. */}
            <div ref={menuWrapRef} className="relative flex items-center gap-1.5">
              <button
                type="button"
                data-testid="composer-settings-trigger"
                onClick={() => setMenuOpen((v) => !v)}
                title={t("composer.settings_tooltip")}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-100"
              >
                <span className="font-mono">{modelLabel}</span>
                {settings.fastMode && (
                  <span
                    className="rounded bg-amber-100 px-1 text-[9px] font-semibold uppercase tracking-wide text-amber-700"
                    title={t("composer.fast_chip_tooltip")}
                  >
                    {t("composer.fast_chip")}
                  </span>
                )}
                {settings.effort !== "medium" && (
                  <span
                    className="rounded bg-blue-100 px-1 text-[9px] font-semibold text-blue-700"
                    title={t("composer.effort_chip_tooltip", {
                      level: settings.effort,
                    })}
                  >
                    {settings.effort}
                  </span>
                )}
                <ChevronDownIcon />
              </button>

              {menuOpen && (
                <SettingsMenu
                  settings={settings}
                  onChange={setSettings}
                  onClose={() => setMenuOpen(false)}
                  t={t}
                />
              )}

              <button
                type="button"
                data-testid="composer-send"
                disabled={!canSend}
                onClick={onSend}
                title={t("composer.send_tooltip")}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-900 text-white transition-colors hover:bg-gray-700 disabled:bg-gray-200 disabled:text-gray-400"
              >
                <ArrowUpIcon />
              </button>
            </div>
          </div>
        </div>

        {disabled && (
          <div className="mt-1 px-2 text-center text-[10px] italic text-gray-400">
            {t("composer.placeholder_notice")}
          </div>
        )}
      </div>
    </div>
  );
}

// Popover anchored above the trigger chip. Three sections: model
// (radio list), effort (pill row), fast mode (toggle). Selections
// flow back to the parent via `onChange`; persistence happens there.
function SettingsMenu({
  settings,
  onChange,
  onClose,
  t,
}: {
  settings: ComposerSettings;
  onChange: (next: ComposerSettings) => void;
  onClose: () => void;
  t: (k: string, opts?: Record<string, unknown>) => string;
}) {
  return (
    <div
      data-testid="composer-settings-menu"
      // bottom-full + right-0 anchors above the chip (composer sits
      // at the panel bottom — no room below). w-56 = compact but
      // enough for "Sonnet 4.6" + chevrons.
      className="absolute bottom-full right-0 mb-2 w-56 rounded-lg border border-gray-200 bg-white p-2 shadow-lg"
    >
      <div className="mb-2">
        <div className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
          {t("composer.menu_model")}
        </div>
        <div className="flex flex-col gap-0.5">
          {MODELS.map((m) => (
            <button
              key={m.id}
              type="button"
              data-testid={`composer-model-${m.id}`}
              onClick={() => {
                onChange({ ...settings, model: m.id });
                onClose();
              }}
              className={`flex items-center justify-between rounded px-2 py-1 text-left text-[12px] hover:bg-gray-100 ${
                settings.model === m.id
                  ? "bg-gray-100 font-semibold text-gray-900"
                  : "text-gray-700"
              }`}
            >
              <span>{m.label}</span>
              <span className="font-mono text-[10px] text-gray-400">
                {m.id}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="mb-2">
        <div className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
          {t("composer.menu_effort")}
        </div>
        <div className="flex gap-0.5">
          {EFFORT_LEVELS.map((e) => (
            <button
              key={e}
              type="button"
              data-testid={`composer-effort-${e}`}
              onClick={() => onChange({ ...settings, effort: e })}
              className={`flex-1 rounded px-1.5 py-1 text-[10px] transition-colors ${
                settings.effort === e
                  ? "bg-blue-500 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {e}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between rounded px-1 py-1">
        <div className="flex flex-col">
          <span className="text-[12px] text-gray-700">
            {t("composer.menu_fast_mode")}
          </span>
          <span className="text-[10px] text-gray-400">
            {t("composer.menu_fast_mode_hint")}
          </span>
        </div>
        <button
          type="button"
          data-testid="composer-fast-toggle"
          role="switch"
          aria-checked={settings.fastMode}
          onClick={() =>
            onChange({ ...settings, fastMode: !settings.fastMode })
          }
          className={`relative h-5 w-9 rounded-full transition-colors ${
            settings.fastMode ? "bg-amber-500" : "bg-gray-300"
          }`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
              settings.fastMode ? "left-4" : "left-0.5"
            }`}
          />
        </button>
      </div>
    </div>
  );
}

function PlusIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function ArrowUpIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  );
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function loadHeight(): number {
  try {
    const v = window.localStorage.getItem(HEIGHT_KEY);
    if (!v) return DEFAULT_HEIGHT;
    const n = Number(v);
    if (!Number.isFinite(n)) return DEFAULT_HEIGHT;
    return clamp(n, MIN_HEIGHT, MAX_HEIGHT);
  } catch {
    return DEFAULT_HEIGHT;
  }
}

function loadSettings(): ComposerSettings {
  try {
    const v = window.localStorage.getItem(SETTINGS_KEY);
    if (!v) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(v) as Partial<ComposerSettings>;
    return {
      model:
        typeof parsed.model === "string" &&
        MODELS.some((m) => m.id === parsed.model)
          ? parsed.model
          : DEFAULT_SETTINGS.model,
      effort: (EFFORT_LEVELS as readonly string[]).includes(
        parsed.effort as string,
      )
        ? (parsed.effort as Effort)
        : DEFAULT_SETTINGS.effort,
      fastMode:
        typeof parsed.fastMode === "boolean"
          ? parsed.fastMode
          : DEFAULT_SETTINGS.fastMode,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}
