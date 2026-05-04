// v0.8 fork closure resolver. Given an entry sessionId + the project
// directory it lives in, find every other jsonl file in the same
// directory that's part of the same `forkedFrom` chain — both
// ancestors (the entry session was forked from them) and descendants
// (other sessions forked from the entry, transitively).
//
// Algorithm (per design choice 1A — eager closure遍历):
//   1. List all .jsonl files in the project directory (skip subagents/
//      tool-results/ remote-agents/ subdirs — those are sidecar data).
//   2. For each candidate jsonl, peek its first record to extract
//      sessionId + (optional) forkedFrom.sessionId. We use only the
//      first record because CC writes session-uniform fields on every
//      record — the first is enough to identify the file. Costs O(N
//      jsonls × first-line read) ≈ O(100ms) on a 21-file project; the
//      single linear scan replaces an O(N²) "scan all files for every
//      hop" naive walk.
//   3. Build sessionId → jsonlPath + sessionId → parentSessionId maps;
//      derive inverse parentSessionId → [childSessionIds] for the
//      forward edge.
//   4. BFS from the entry sessionId: at each visited sid, enqueue its
//      parent (via forkedFrom) AND its children (via inverse map).
//      `seen` set prevents re-enqueuing.
//
// Returns BFS-ordered closure with the entry session at index 0.
// Empty array when the entry session's jsonl can't be found in the
// project dir (caller surfaces 404).

import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { createReadStream } from "node:fs";
import readline from "node:readline";

export interface ClosureMember {
  sessionId: string;
  jsonlPath: string;
}

export interface FindForkClosureOptions {
  /** Absolute path to the project directory containing the entry
   * session's jsonl (and any potential fork siblings). */
  projectDir: string;
  /** The session the user requested. Closure starts here. */
  entrySessionId: string;
}

interface JsonlInfo {
  sessionId: string;
  jsonlPath: string;
  forkedFromSessionId: string | null;
}

export async function findForkClosure(
  opts: FindForkClosureOptions,
): Promise<ClosureMember[]> {
  const { projectDir, entrySessionId } = opts;
  const all = await scanProjectJsonls(projectDir);
  const bySid = new Map<string, JsonlInfo>();
  const childrenOf = new Map<string, string[]>();
  for (const info of all) {
    if (!bySid.has(info.sessionId)) bySid.set(info.sessionId, info);
    if (info.forkedFromSessionId) {
      const list = childrenOf.get(info.forkedFromSessionId) ?? [];
      list.push(info.sessionId);
      childrenOf.set(info.forkedFromSessionId, list);
    }
  }

  if (!bySid.has(entrySessionId)) return [];
  const seen = new Set<string>([entrySessionId]);
  const queue: string[] = [entrySessionId];
  const out: ClosureMember[] = [];
  while (queue.length > 0) {
    const sid = queue.shift()!;
    const info = bySid.get(sid);
    if (!info) continue;
    out.push({ sessionId: sid, jsonlPath: info.jsonlPath });
    // Walk parent chain via forkedFrom.sessionId.
    if (info.forkedFromSessionId && !seen.has(info.forkedFromSessionId)) {
      seen.add(info.forkedFromSessionId);
      queue.push(info.forkedFromSessionId);
    }
    // Walk forward to descendants via inverse map.
    for (const childSid of childrenOf.get(sid) ?? []) {
      if (!seen.has(childSid)) {
        seen.add(childSid);
        queue.push(childSid);
      }
    }
  }
  return out;
}

// List all `.jsonl` files directly under projectDir. Subdirs (subagents/
// tool-results/ remote-agents/ etc.) are session-owned sidecars — they
// don't carry forkedFrom relations to other top-level sessions, so we
// skip them. Returns one JsonlInfo per file (sessionId + parsed
// forkedFrom from the first record).
async function scanProjectJsonls(projectDir: string): Promise<JsonlInfo[]> {
  let entries: string[];
  try {
    entries = await fsp.readdir(projectDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const out: JsonlInfo[] = [];
  for (const name of entries) {
    if (!name.endsWith(".jsonl")) continue;
    const jsonlPath = path.join(projectDir, name);
    const stat = await fsp.stat(jsonlPath).catch(() => null);
    if (!stat?.isFile()) continue;
    const peek = await peekFirstRecord(jsonlPath).catch(() => null);
    if (!peek) continue;
    out.push({
      sessionId: peek.sessionId,
      jsonlPath,
      forkedFromSessionId: peek.forkedFromSessionId,
    });
  }
  return out;
}

interface PeekedRecord {
  sessionId: string;
  forkedFromSessionId: string | null;
}

// Read just the first non-empty line of a jsonl, parse it, and pull
// the two fields we need. CC writes sessionId on every record, so the
// first record is sufficient. forkedFrom is on every copied record in
// a fork session jsonl — if the very first record of the jsonl was
// produced by `/branch`'s copy step, it'll have forkedFrom; if the
// session is original (or the first record is a NEW one not from
// /branch's copy phase) it won't. CC `/branch` always emits forkedFrom
// on the FIRST record of a fork jsonl (the copies come before any new
// records by construction), so this single-line scan correctly
// classifies every fork jsonl.
async function peekFirstRecord(jsonlPath: string): Promise<PeekedRecord | null> {
  const stream = createReadStream(jsonlPath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      const t = line.trim();
      if (!t) continue;
      let obj: unknown;
      try {
        obj = JSON.parse(t);
      } catch {
        return null;
      }
      if (!obj || typeof obj !== "object") return null;
      const o = obj as { sessionId?: unknown; forkedFrom?: unknown };
      if (typeof o.sessionId !== "string") return null;
      let forkedFromSessionId: string | null = null;
      if (
        o.forkedFrom &&
        typeof o.forkedFrom === "object" &&
        typeof (o.forkedFrom as { sessionId?: unknown }).sessionId === "string"
      ) {
        forkedFromSessionId = (o.forkedFrom as { sessionId: string }).sessionId;
      }
      return { sessionId: o.sessionId, forkedFromSessionId };
    }
    return null;
  } finally {
    // readline's iterator usually closes the stream on completion, but
    // when we break early we need to make sure the descriptor is
    // released — node's createReadStream lazy-closes, but explicit is
    // safer for the sync test path.
    rl.close();
    stream.destroy();
  }
}
