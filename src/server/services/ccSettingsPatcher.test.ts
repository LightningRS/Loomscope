// CC settings.json patcher — read / add / remove of Loomscope hook
// entries. The risky operation in PR 3, so test coverage is dense:
// preservation of third-party content, idempotence, atomicity sanity,
// malformed-input refusal.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  HOOK_EVENTS_LIST,
  _setSettingsPathForTests,
  addLoomscopeHooks,
  buildPasteableSnippet,
  getHookStatus,
  removeLoomscopeHooks,
} from "@/server/services/ccSettingsPatcher";

const PORT = 5174;

let tmpDir: string;
let settingsFile: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "loomscope-patcher-"));
  settingsFile = path.join(tmpDir, "settings.json");
  _setSettingsPathForTests(settingsFile);
});

afterEach(async () => {
  _setSettingsPathForTests(null);
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("getHookStatus", () => {
  it("settingsExists=false when file is missing; all events missing", async () => {
    const s = await getHookStatus(PORT);
    expect(s.settingsExists).toBe(false);
    expect(s.configured).toEqual([]);
    expect(s.missing).toEqual([...HOOK_EVENTS_LIST]);
  });

  it("classifies entries based on URL match (port-aware)", async () => {
    await fs.writeFile(
      settingsFile,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              type: "http",
              url: `http://localhost:${PORT}/api/cc-hook?event=PreToolUse`,
            },
          ],
          // Different port → NOT ours
          PostToolUse: [
            {
              type: "http",
              url: "http://localhost:9999/api/cc-hook?event=PostToolUse",
            },
          ],
          // Third-party hook on a Loomscope-tracked event
          PostCompact: [{ type: "command", command: "/usr/bin/notify" }],
        },
      }),
    );
    const s = await getHookStatus(PORT);
    expect(s.configured).toEqual(["PreToolUse"]);
    expect(s.missing).toContain("PostToolUse");
    expect(s.missing).toContain("PostCompact");
  });

  it("malformed JSON → malformed=true, no exception", async () => {
    await fs.writeFile(settingsFile, "{not-valid-json");
    const s = await getHookStatus(PORT);
    expect(s.malformed).toBe(true);
  });
});

describe("addLoomscopeHooks", () => {
  it("creates settings.json with all 11 events when file is missing", async () => {
    const status = await addLoomscopeHooks(PORT);
    expect(status.configured).toEqual([...HOOK_EVENTS_LIST]);
    expect(status.missing).toEqual([]);

    const raw = await fs.readFile(settingsFile, "utf8");
    const parsed = JSON.parse(raw) as { hooks: Record<string, unknown[]> };
    expect(Object.keys(parsed.hooks).sort()).toEqual([...HOOK_EVENTS_LIST].sort());
  });

  it("preserves third-party top-level keys", async () => {
    await fs.writeFile(
      settingsFile,
      JSON.stringify({
        env: { FOO: "bar" },
        cleanupPeriodDays: 30,
      }),
    );
    await addLoomscopeHooks(PORT);
    const raw = await fs.readFile(settingsFile, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed.env).toEqual({ FOO: "bar" });
    expect(parsed.cleanupPeriodDays).toBe(30);
  });

  it("preserves third-party hook entries on the same event names", async () => {
    await fs.writeFile(
      settingsFile,
      JSON.stringify({
        hooks: {
          PreToolUse: [{ type: "command", command: "echo external" }],
        },
      }),
    );
    await addLoomscopeHooks(PORT);
    const raw = await fs.readFile(settingsFile, "utf8");
    const parsed = JSON.parse(raw) as {
      hooks: { PreToolUse: Array<{ type: string }> };
    };
    expect(parsed.hooks.PreToolUse).toHaveLength(2);
    expect(parsed.hooks.PreToolUse.some((e) => e.type === "command")).toBe(true);
    expect(parsed.hooks.PreToolUse.some((e) => e.type === "http")).toBe(true);
  });

  it("idempotent — re-adding doesn't duplicate Loomscope entries", async () => {
    await addLoomscopeHooks(PORT);
    await addLoomscopeHooks(PORT);
    const raw = await fs.readFile(settingsFile, "utf8");
    const parsed = JSON.parse(raw) as {
      hooks: { PreToolUse: Array<{ type: string }> };
    };
    expect(parsed.hooks.PreToolUse).toHaveLength(1);
  });

  it("refuses to write when existing file is malformed JSON", async () => {
    await fs.writeFile(settingsFile, "{not-valid-json");
    const status = await addLoomscopeHooks(PORT);
    expect(status.malformed).toBe(true);
    // Original content unchanged
    const raw = await fs.readFile(settingsFile, "utf8");
    expect(raw).toBe("{not-valid-json");
  });
});

describe("removeLoomscopeHooks", () => {
  it("strips Loomscope entries while preserving third-party ones", async () => {
    await fs.writeFile(
      settingsFile,
      JSON.stringify({
        env: { KEEP: "yes" },
        hooks: {
          PreToolUse: [
            { type: "command", command: "echo external" },
            {
              type: "http",
              url: `http://localhost:${PORT}/api/cc-hook?event=PreToolUse`,
            },
          ],
          PostToolUse: [
            {
              type: "http",
              url: `http://localhost:${PORT}/api/cc-hook?event=PostToolUse`,
            },
          ],
        },
      }),
    );
    await removeLoomscopeHooks(PORT);
    const raw = await fs.readFile(settingsFile, "utf8");
    const parsed = JSON.parse(raw) as {
      env: Record<string, string>;
      hooks?: Record<string, unknown[]>;
    };
    expect(parsed.env.KEEP).toBe("yes");
    // PreToolUse keeps the third-party entry
    expect(parsed.hooks?.PreToolUse).toEqual([
      { type: "command", command: "echo external" },
    ]);
    // PostToolUse had only ours → removed entirely
    expect(parsed.hooks?.PostToolUse).toBeUndefined();
  });

  it("removes the empty `hooks` key when nothing remains", async () => {
    await addLoomscopeHooks(PORT);
    await removeLoomscopeHooks(PORT);
    const raw = await fs.readFile(settingsFile, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed.hooks).toBeUndefined();
  });

  it("idempotent on a file with no Loomscope entries", async () => {
    await fs.writeFile(settingsFile, JSON.stringify({ env: { X: "y" } }));
    const before = await fs.readFile(settingsFile, "utf8");
    await removeLoomscopeHooks(PORT);
    const after = await fs.readFile(settingsFile, "utf8");
    // The atomic rewrite re-formats with 2-space indent, so byte-
    // equality isn't guaranteed; structural match is.
    expect(JSON.parse(after)).toEqual(JSON.parse(before));
  });

  it("no-op + non-throwing when settings.json doesn't exist", async () => {
    await expect(removeLoomscopeHooks(PORT)).resolves.toMatchObject({
      settingsExists: false,
    });
  });
});

describe("buildPasteableSnippet", () => {
  it("produces a valid JSON snippet covering all 11 events", () => {
    const snippet = buildPasteableSnippet(PORT);
    const parsed = JSON.parse(snippet) as {
      hooks: Record<string, Array<{ url: string }>>;
    };
    expect(Object.keys(parsed.hooks).sort()).toEqual([...HOOK_EVENTS_LIST].sort());
    for (const event of HOOK_EVENTS_LIST) {
      expect(parsed.hooks[event][0].url).toContain(`event=${event}`);
      expect(parsed.hooks[event][0].url).toContain(`localhost:${PORT}`);
    }
  });
});
