// LRU cache for parsed ChatFlow — unit tests.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ChatFlow } from "@/data/types";
import {
  _peekKeysForTests,
  _resetForTests,
  buildCacheKey,
  getCached,
  getOrLoad,
  setCached,
} from "@/server/services/chatFlowCache";

function makeChatFlow(id: string): ChatFlow {
  return {
    id,
    mainJsonlPath: `/x/${id}.jsonl`,
    sidecarDir: `/x/${id}`,
    chatNodes: [],
    orphans: [],
    flowEvents: [],
    trigger: "user",
  };
}

let tmpDir: string;

beforeEach(async () => {
  _resetForTests();
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "loomscope-cache-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("getCached / setCached", () => {
  it("returns null on miss", () => {
    expect(getCached("missing")).toBeNull();
  });

  it("returns the stored ChatFlow on hit", () => {
    const cf = makeChatFlow("a");
    setCached("k1", cf);
    expect(getCached("k1")).toBe(cf);
  });

  it("LRU bumps a hit entry to the most-recently-used end", () => {
    setCached("k1", makeChatFlow("1"));
    setCached("k2", makeChatFlow("2"));
    setCached("k3", makeChatFlow("3"));
    expect(_peekKeysForTests()).toEqual(["k1", "k2", "k3"]);
    // Hit k1 → moves to end
    getCached("k1");
    expect(_peekKeysForTests()).toEqual(["k2", "k3", "k1"]);
  });

  it("evicts the least-recently-used entry when over MAX_ENTRIES", () => {
    // MAX_ENTRIES = 8 in the impl; insert 10 → 2 oldest evicted.
    for (let i = 0; i < 10; i += 1) {
      setCached(`k${i}`, makeChatFlow(String(i)));
    }
    const keys = _peekKeysForTests();
    expect(keys).toHaveLength(8);
    // k0 + k1 evicted (LRU); k2..k9 remain.
    expect(keys[0]).toBe("k2");
    expect(keys[7]).toBe("k9");
  });

  it("re-inserting an existing key bumps it to MRU without growing the cache", () => {
    setCached("k1", makeChatFlow("1"));
    setCached("k2", makeChatFlow("2"));
    expect(_peekKeysForTests()).toEqual(["k1", "k2"]);
    setCached("k1", makeChatFlow("1-updated"));
    expect(_peekKeysForTests()).toEqual(["k2", "k1"]);
    // Should be the new value
    expect(getCached("k1")?.mainJsonlPath).toBe("/x/1-updated.jsonl");
  });
});

describe("buildCacheKey", () => {
  it("includes entry mtime alone when closure is empty (single jsonl session)", async () => {
    const file = path.join(tmpDir, "lone.jsonl");
    await fs.writeFile(file, "{}");
    const key = await buildCacheKey("sid-1", [], file);
    expect(key).toMatch(/^sid-1:[\d.]+$/);
  });

  it("concatenates closure mtimes in BFS order (deterministic)", async () => {
    const a = path.join(tmpDir, "a.jsonl");
    const b = path.join(tmpDir, "b.jsonl");
    await fs.writeFile(a, "{}");
    await fs.writeFile(b, "{}");
    const closure = [
      { sessionId: "a", jsonlPath: a },
      { sessionId: "b", jsonlPath: b },
    ];
    const key = await buildCacheKey("sid-2", closure, a);
    // Format: "sid-2:<a_mtime>,<b_mtime>"
    expect(key).toMatch(/^sid-2:[\d.]+,[\d.]+$/);
  });

  it("changes when any closure member's mtime changes", async () => {
    const a = path.join(tmpDir, "a.jsonl");
    const b = path.join(tmpDir, "b.jsonl");
    await fs.writeFile(a, "{}");
    await fs.writeFile(b, "{}");
    const closure = [
      { sessionId: "a", jsonlPath: a },
      { sessionId: "b", jsonlPath: b },
    ];
    const k1 = await buildCacheKey("s", closure, a);
    // Force mtime change on b
    await new Promise((r) => setTimeout(r, 5));
    await fs.writeFile(b, "{}");
    const k2 = await buildCacheKey("s", closure, a);
    expect(k1).not.toBe(k2);
  });

  it("treats unreadable paths as mtime 0 (won't crash)", async () => {
    const ghost = path.join(tmpDir, "ghost.jsonl");
    const closure = [{ sessionId: "g", jsonlPath: ghost }];
    const key = await buildCacheKey("sg", closure, ghost);
    expect(key).toBe("sg:0");
  });
});

describe("getOrLoad", () => {
  it("returns cacheHit=false on first call and cacheHit=true on second", async () => {
    const file = path.join(tmpDir, "x.jsonl");
    await fs.writeFile(file, "{}");
    let loadCount = 0;
    const loader = async () => {
      loadCount += 1;
      return makeChatFlow("x");
    };
    const r1 = await getOrLoad({
      sessionId: "x",
      closure: [],
      fallbackJsonlPath: file,
      loader,
    });
    expect(r1.cacheHit).toBe(false);
    expect(loadCount).toBe(1);
    const r2 = await getOrLoad({
      sessionId: "x",
      closure: [],
      fallbackJsonlPath: file,
      loader,
    });
    expect(r2.cacheHit).toBe(true);
    expect(loadCount).toBe(1);
    expect(r2.chatFlow).toBe(r1.chatFlow);
  });

  it("invalidates when the underlying jsonl mtime changes", async () => {
    const file = path.join(tmpDir, "x.jsonl");
    await fs.writeFile(file, "{}");
    let loadCount = 0;
    const loader = async () => {
      loadCount += 1;
      return makeChatFlow(`x-${loadCount}`);
    };
    const r1 = await getOrLoad({
      sessionId: "x",
      closure: [],
      fallbackJsonlPath: file,
      loader,
    });
    expect(r1.cacheHit).toBe(false);
    // Bump mtime
    await new Promise((res) => setTimeout(res, 5));
    await fs.writeFile(file, "{}\n");
    const r2 = await getOrLoad({
      sessionId: "x",
      closure: [],
      fallbackJsonlPath: file,
      loader,
    });
    expect(r2.cacheHit).toBe(false);
    expect(loadCount).toBe(2);
    // Two different cached entries co-exist briefly until LRU eviction.
    expect(r2.chatFlow).not.toBe(r1.chatFlow);
  });
});
