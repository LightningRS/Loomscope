// @vitest-environment node
//
// CC hook onboarding route — end-to-end test that the GET status +
// POST patch endpoints behave as expected through the full app
// pipeline (CSRF bypass, JSON shape, error paths).

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "@/server/app";
import { _setCacheRootForTests } from "@/server/services/chatFlowDiskCache";
import {
  HOOK_EVENTS_LIST,
  _setSettingsPathForTests,
} from "@/server/services/ccSettingsPatcher";

let tmpRoot: string;
let app: ReturnType<typeof createApp>;
let settingsFile: string;
const SECRET = "c".repeat(64);

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "loomscope-onboard-"));
  settingsFile = path.join(tmpRoot, "settings.json");
  _setCacheRootForTests(path.join(tmpRoot, "disk-cache"));
  _setSettingsPathForTests(settingsFile);
  app = createApp({
    rootDir: tmpRoot,
    csrfToken: "csrf-token",
    allowedOrigin: "http://localhost:5174",
    hookSecret: SECRET,
  });
});

afterEach(async () => {
  _setCacheRootForTests(null);
  _setSettingsPathForTests(null);
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("GET /api/cc-hook-onboarding/status", () => {
  it("reports settingsExists=false + all events missing on a clean machine", async () => {
    const res = await app.request("/api/cc-hook-onboarding/status");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      settingsExists: boolean;
      configured: string[];
      missing: string[];
      shellRcSnippet: string;
      pasteableJson: string;
    };
    expect(body.settingsExists).toBe(false);
    expect(body.missing).toEqual([...HOOK_EVENTS_LIST]);
    expect(body.shellRcSnippet).toBe(`export LOOMSCOPE_SECRET=${SECRET}`);
    expect(body.pasteableJson).toContain("X-Loomscope-Secret");
  });

  it("reports configured events when our hooks are present (CC matcher schema)", async () => {
    await fs.writeFile(
      settingsFile,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "",
              hooks: [
                {
                  type: "http",
                  url: "http://localhost:5174/api/cc-hook?event=PreToolUse",
                },
              ],
            },
          ],
        },
      }),
    );
    const res = await app.request("/api/cc-hook-onboarding/status");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      configured: string[];
      missing: string[];
    };
    expect(body.configured).toEqual(["PreToolUse"]);
    expect(body.missing.length).toBe(HOOK_EVENTS_LIST.length - 1);
  });
});

describe("POST /api/cc-hook-onboarding/patch", () => {
  it("mode=add writes settings.json with all 11 events in CC matcher schema", async () => {
    const res = await app.request("/api/cc-hook-onboarding/patch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "add" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { configured: string[] };
    expect(body.configured.sort()).toEqual([...HOOK_EVENTS_LIST].sort());
    // Verify file shape: matcher entries wrapping action arrays.
    const raw = await fs.readFile(settingsFile, "utf8");
    const parsed = JSON.parse(raw) as {
      hooks: Record<
        string,
        Array<{ matcher: string; hooks: Array<{ type: string }> }>
      >;
    };
    expect(Object.keys(parsed.hooks).sort()).toEqual([...HOOK_EVENTS_LIST].sort());
    for (const event of HOOK_EVENTS_LIST) {
      const entries = parsed.hooks[event];
      expect(entries[0].matcher).toBe("");
      expect(Array.isArray(entries[0].hooks)).toBe(true);
    }
  });

  it("mode=remove strips Loomscope entries (matcher schema) while preserving others", async () => {
    await fs.writeFile(
      settingsFile,
      JSON.stringify({
        env: { KEEP: "yes" },
        hooks: {
          PreToolUse: [
            {
              matcher: "",
              hooks: [
                {
                  type: "http",
                  url: "http://localhost:5174/api/cc-hook?event=PreToolUse",
                },
              ],
            },
            {
              matcher: "Bash",
              hooks: [{ type: "command", command: "echo external" }],
            },
          ],
        },
      }),
    );
    const res = await app.request("/api/cc-hook-onboarding/patch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "remove" }),
    });
    expect(res.status).toBe(200);
    const raw = await fs.readFile(settingsFile, "utf8");
    const parsed = JSON.parse(raw) as {
      env: Record<string, string>;
      hooks?: {
        PreToolUse?: Array<{
          matcher: string;
          hooks: Array<{ type: string }>;
        }>;
      };
    };
    expect(parsed.env.KEEP).toBe("yes");
    // Loomscope entry removed; third-party Bash entry kept verbatim.
    expect(parsed.hooks?.PreToolUse).toHaveLength(1);
    expect(parsed.hooks?.PreToolUse?.[0].matcher).toBe("Bash");
  });

  it("409 when existing settings.json is malformed", async () => {
    await fs.writeFile(settingsFile, "{not-valid-json");
    const res = await app.request("/api/cc-hook-onboarding/patch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "add" }),
    });
    expect(res.status).toBe(409);
    // Original content untouched.
    expect(await fs.readFile(settingsFile, "utf8")).toBe("{not-valid-json");
  });

  it("400 on invalid mode", async () => {
    const res = await app.request("/api/cc-hook-onboarding/patch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "delete-all-the-things" }),
    });
    expect(res.status).toBe(400);
  });

  it("does NOT require X-Loomscope-Token (CSRF bypass for same-origin onboarding flow)", async () => {
    // No CSRF header. Should still succeed because the path is in
    // CSRF_BYPASS_PATHS.
    const res = await app.request("/api/cc-hook-onboarding/patch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "add" }),
    });
    expect(res.status).toBe(200);
  });
});
