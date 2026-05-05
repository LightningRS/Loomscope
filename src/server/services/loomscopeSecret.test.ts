// LOOMSCOPE_SECRET service — file persistence, regeneration on
// corrupt file, constant-time compare.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  _setSecretPathForTests,
  getOrCreateSecret,
  readSecretIfExists,
  timingSafeEqualHex,
} from "@/server/services/loomscopeSecret";

let tmpDir: string;
let secretFile: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "loomscope-secret-"));
  secretFile = path.join(tmpDir, ".loomscope", "secret");
  _setSecretPathForTests(secretFile);
});

afterEach(async () => {
  _setSecretPathForTests(null);
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("getOrCreateSecret", () => {
  it("creates a 64-char hex secret on first call when none exists", async () => {
    const s = await getOrCreateSecret();
    expect(s).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(s)).toBe(true);
    // Persisted to disk
    const onDisk = (await fs.readFile(secretFile, "utf8")).trim();
    expect(onDisk).toBe(s);
  });

  it("reads back the persisted secret on subsequent calls (across processes)", async () => {
    const s1 = await getOrCreateSecret();
    // Simulate a fresh process by clearing in-memory cache via path
    // override toggle (the function reads from disk on every call
    // since it doesn't cache in-process — it relies on the file).
    const s2 = await getOrCreateSecret();
    expect(s2).toBe(s1);
  });

  it("regenerates if the on-disk value is corrupt (wrong length)", async () => {
    await fs.mkdir(path.dirname(secretFile), { recursive: true });
    await fs.writeFile(secretFile, "tooshort", "utf8");
    const s = await getOrCreateSecret();
    expect(s).toHaveLength(64);
    expect(s).not.toBe("tooshort");
  });

  it("regenerates if the on-disk value contains non-hex chars", async () => {
    await fs.mkdir(path.dirname(secretFile), { recursive: true });
    await fs.writeFile(secretFile, "z".repeat(64), "utf8");
    const s = await getOrCreateSecret();
    expect(/^[0-9a-f]{64}$/.test(s)).toBe(true);
    expect(s).not.toBe("z".repeat(64));
  });
});

describe("readSecretIfExists", () => {
  it("returns null when no secret file exists", async () => {
    expect(await readSecretIfExists()).toBeNull();
  });

  it("returns the secret when one exists + is valid", async () => {
    const created = await getOrCreateSecret();
    expect(await readSecretIfExists()).toBe(created);
  });

  it("returns null when the file is corrupt rather than regenerating", async () => {
    await fs.mkdir(path.dirname(secretFile), { recursive: true });
    await fs.writeFile(secretFile, "garbage", "utf8");
    expect(await readSecretIfExists()).toBeNull();
  });
});

describe("timingSafeEqualHex", () => {
  it("returns true for equal strings", () => {
    expect(timingSafeEqualHex("abc123", "abc123")).toBe(true);
  });

  it("returns false for different equal-length strings", () => {
    expect(timingSafeEqualHex("abc123", "abc124")).toBe(false);
  });

  it("returns false for different-length strings", () => {
    expect(timingSafeEqualHex("abc", "abc1")).toBe(false);
  });

  it("returns true for empty strings", () => {
    expect(timingSafeEqualHex("", "")).toBe(true);
  });
});
