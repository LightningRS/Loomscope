// EN (v∞.0 PR 3): read + patch CC's `~/.claude/settings.json` to wire
// in Loomscope's 11 hooks. The risky operation in this PR — we're
// modifying a config file the user owns — so the contract is:
//
//   1. Never write without explicit caller intent. The route layer
//      requires a POST with `{ mode: "add" | "remove" }`; defaults
//      stay read-only.
//   2. Preserve every other key in the file. We touch ONLY
//      `settings.hooks[<our 11 events>]` arrays and only entries
//      whose URL marks them as ours (`/api/cc-hook` on the
//      configured localhost port). Third-party hooks for the same
//      events sit alongside, untouched.
//   3. Atomic write via tmp-file + rename so a torn write can't
//      half-corrupt the file.
//   4. Refuse to write if the existing file is malformed JSON.
//      Better to surface the parse error than overwrite a file
//      the user manually broke (or that has comments / trailing
//      commas they intended).
//
// 中: 改用户的 ~/.claude/settings.json 是这个 PR 最危险的操作。规则：
// 默认只读、显式 mode 才写、保留其它所有 key、原子写、拒绝写入畸形
// 文件。我们只动 settings.hooks[<我们的 11 个事件>] 里 URL 指向本机
// /api/cc-hook 的 entry，其它 hook 完全不碰。

import { promises as fsp } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { HOOK_EVENTS } from "@/server/services/hookEventBus";

export const HOOK_EVENTS_LIST = [...HOOK_EVENTS] as readonly string[];

const DEFAULT_SETTINGS_PATH = path.join(os.homedir(), ".claude", "settings.json");

let settingsPathOverride: string | null = null;

/** Test helper. */
export function _setSettingsPathForTests(p: string | null): void {
  settingsPathOverride = p;
}

function settingsPath(): string {
  return settingsPathOverride ?? DEFAULT_SETTINGS_PATH;
}

interface CcHookEntry {
  type?: string;
  url?: string;
  headers?: Record<string, string>;
  allowedEnvVars?: string[];
  timeout?: number;
  // any other fields the user / CC version uses — preserved
  // verbatim by `JSON.parse / JSON.stringify` round-trip.
  [k: string]: unknown;
}

interface CcSettings {
  hooks?: Record<string, CcHookEntry[]>;
  [k: string]: unknown;
}

export interface HookStatus {
  /** Path to the settings file we inspected (resolved). */
  settingsPath: string;
  /** Whether the file exists at all. False = first-time CC user. */
  settingsExists: boolean;
  /** Events we found a Loomscope hook entry for. Subset of the 11. */
  configured: string[];
  /** Events still needing a Loomscope hook entry. */
  missing: string[];
  /** True iff parsing the existing file failed — caller must NOT
   * attempt a patch in this state; surface error to user. */
  malformed?: boolean;
}

/**
 * Read settings.json + classify each of our 11 events as
 * configured / missing. Also exposes whether the file exists at all
 * (different UX: "first-time CC user" vs "existing user without us").
 */
export async function getHookStatus(loomscopePort: number): Promise<HookStatus> {
  const p = settingsPath();
  let raw: string;
  try {
    raw = await fsp.readFile(p, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        settingsPath: p,
        settingsExists: false,
        configured: [],
        missing: [...HOOK_EVENTS_LIST],
      };
    }
    throw err;
  }
  let parsed: CcSettings;
  try {
    parsed = JSON.parse(raw) as CcSettings;
  } catch {
    return {
      settingsPath: p,
      settingsExists: true,
      configured: [],
      missing: [...HOOK_EVENTS_LIST],
      malformed: true,
    };
  }
  const hooks = (parsed.hooks ?? {}) as Record<string, CcHookEntry[]>;
  const configured: string[] = [];
  for (const event of HOOK_EVENTS_LIST) {
    const entries = hooks[event];
    if (
      Array.isArray(entries) &&
      entries.some((e) => isOurHookEntry(e, loomscopePort))
    ) {
      configured.push(event);
    }
  }
  const missing = HOOK_EVENTS_LIST.filter((e) => !configured.includes(e));
  return { settingsPath: p, settingsExists: true, configured, missing };
}

/**
 * Add Loomscope hook entries for any of the 11 events that don't
 * already have one. Existing entries (including non-Loomscope ones)
 * are preserved. Returns the post-patch status.
 *
 * Safe to call repeatedly — already-configured events are skipped.
 *
 * Refuses to write if existing file is malformed JSON; caller must
 * surface that error to the user instead of silently overwriting.
 */
export async function addLoomscopeHooks(
  loomscopePort: number,
): Promise<HookStatus> {
  const p = settingsPath();
  const { parsed, raw } = await safeReadOrEmpty(p);
  if (raw !== null && parsed === null) {
    // Malformed — DO NOT WRITE. Caller's job to surface the error.
    return {
      settingsPath: p,
      settingsExists: true,
      configured: [],
      missing: [...HOOK_EVENTS_LIST],
      malformed: true,
    };
  }
  const settings: CcSettings = parsed ?? {};
  const hooks: Record<string, CcHookEntry[]> = (settings.hooks ?? {}) as Record<
    string,
    CcHookEntry[]
  >;
  for (const event of HOOK_EVENTS_LIST) {
    const existing: CcHookEntry[] = Array.isArray(hooks[event])
      ? hooks[event]
      : [];
    if (existing.some((e) => isOurHookEntry(e, loomscopePort))) {
      // Already there — leave the user's other entries untouched
      // alongside ours.
      hooks[event] = existing;
      continue;
    }
    hooks[event] = [...existing, buildHookEntry(event, loomscopePort)];
  }
  settings.hooks = hooks;
  await atomicWriteSettings(p, settings);
  return getHookStatus(loomscopePort);
}

/**
 * Strip Loomscope's hook entries from settings.json. Other entries
 * (including third-party hooks for the same event names) are
 * preserved. Empty arrays + dangling event keys are cleaned up so
 * the file doesn't accumulate empty `"PreToolUse": []`.
 *
 * Idempotent — no-op when nothing of ours is present.
 */
export async function removeLoomscopeHooks(
  loomscopePort: number,
): Promise<HookStatus> {
  const p = settingsPath();
  const { parsed, raw } = await safeReadOrEmpty(p);
  if (raw === null) {
    // No file → nothing to remove. Nothing to write either; just
    // report the current (empty) status.
    return getHookStatus(loomscopePort);
  }
  if (parsed === null) {
    return {
      settingsPath: p,
      settingsExists: true,
      configured: [],
      missing: [...HOOK_EVENTS_LIST],
      malformed: true,
    };
  }
  const settings: CcSettings = parsed;
  const hooks = (settings.hooks ?? {}) as Record<string, CcHookEntry[]>;
  for (const event of HOOK_EVENTS_LIST) {
    const filtered =
      Array.isArray(hooks[event])
        ? hooks[event].filter((e) => !isOurHookEntry(e, loomscopePort))
        : [];
    if (filtered.length === 0) {
      delete hooks[event];
    } else {
      hooks[event] = filtered;
    }
  }
  if (Object.keys(hooks).length === 0) {
    delete settings.hooks;
  } else {
    settings.hooks = hooks;
  }
  await atomicWriteSettings(p, settings);
  return getHookStatus(loomscopePort);
}

/**
 * Build the JSON snippet a user can paste manually if they don't
 * want Loomscope to touch their settings.json. Uses literal
 * `$LOOMSCOPE_SECRET` so the user's CC sees the env var via the
 * `allowedEnvVars` whitelist and substitutes at fire time.
 */
export function buildPasteableSnippet(loomscopePort: number): string {
  const hooks: Record<string, CcHookEntry[]> = {};
  for (const event of HOOK_EVENTS_LIST) {
    hooks[event] = [buildHookEntry(event, loomscopePort)];
  }
  return JSON.stringify({ hooks }, null, 2);
}

// ─── internals ───────────────────────────────────────────────────────

function buildHookEntry(eventName: string, port: number): CcHookEntry {
  return {
    type: "http",
    url: `http://localhost:${port}/api/cc-hook?event=${eventName}`,
    headers: { "X-Loomscope-Secret": "$LOOMSCOPE_SECRET" },
    allowedEnvVars: ["LOOMSCOPE_SECRET"],
    timeout: 5,
  };
}

function isOurHookEntry(entry: CcHookEntry | unknown, port: number): boolean {
  if (!entry || typeof entry !== "object") return false;
  const url = (entry as CcHookEntry).url;
  if (typeof url !== "string") return false;
  // Match `http://localhost:<port>/api/cc-hook` — be tolerant of
  // query string / scheme / etc.
  return url.includes(`localhost:${port}/api/cc-hook`);
}

async function safeReadOrEmpty(
  p: string,
): Promise<{ raw: string | null; parsed: CcSettings | null }> {
  let raw: string;
  try {
    raw = await fsp.readFile(p, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { raw: null, parsed: null };
    }
    throw err;
  }
  // Empty / whitespace-only file is treated as empty object.
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { raw, parsed: {} };
  }
  try {
    return { raw, parsed: JSON.parse(trimmed) as CcSettings };
  } catch {
    return { raw, parsed: null };
  }
}

async function atomicWriteSettings(p: string, settings: CcSettings): Promise<void> {
  const json = JSON.stringify(settings, null, 2) + "\n";
  await fsp.mkdir(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}.${Date.now()}`;
  try {
    await fsp.writeFile(tmp, json, { encoding: "utf8" });
    await fsp.rename(tmp, p);
  } catch (err) {
    void fsp.unlink(tmp).catch(() => {});
    throw err;
  }
}
