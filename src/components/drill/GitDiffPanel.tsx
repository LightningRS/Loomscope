// v0.11 Git tab — per-ChatNode commit history with lazy diff load.
//
// Hierarchy (3 levels, all collapsible):
//   ▸ <repo path>  (N commits)                    ← repo level
//     ▸ <sha 7-char>  <subject>                    ← commit level
//       ▸ <file/path>                              ← file level
//         <unified diff>                           ← lazy fetched on file expand
//
// Default fold:
//   - repo:    expanded (usually 1 repo, no point hiding it)
//   - commit:  collapsed (just hash + subject + file count visible)
//   - file:    visible at commit level after expand (path + status)
//   - diff:    collapsed by default; click file row to load + show
//
// Phase 4 wiring (separate commit) adds bi-directional highlight
// with WorkFlow tool_use cards via the store's hover/focus state.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useStore } from "@/store";
import type { ChatNode, GitCommitRef } from "@/data/types";

interface Props {
  sessionId: string;
  chatNode: ChatNode | null;
}

interface FilesResp {
  ok: true;
  files: Array<{ path: string; status: string }>;
}

interface DiffResp {
  ok: true;
  text: string;
}

interface ErrResp {
  ok: false;
  code: string;
  detail?: string;
}

async function fetchFiles(
  sid: string,
  repo: string,
  sha: string,
): Promise<FilesResp | ErrResp> {
  const url = `/api/sessions/${sid}/git/diff?repo=${encodeURIComponent(repo)}&sha=${encodeURIComponent(sha)}`;
  const r = await fetch(url);
  return (await r.json()) as FilesResp | ErrResp;
}

async function fetchDiff(
  sid: string,
  repo: string,
  sha: string,
  file: string,
): Promise<DiffResp | ErrResp> {
  const url = `/api/sessions/${sid}/git/diff?repo=${encodeURIComponent(repo)}&sha=${encodeURIComponent(sha)}&file=${encodeURIComponent(file)}`;
  const r = await fetch(url);
  return (await r.json()) as DiffResp | ErrResp;
}

export function GitDiffPanel({ sessionId, chatNode }: Props) {
  const { t } = useTranslation();
  const commits = chatNode?.meta.commits ?? [];

  // Group commits by repo (most ChatNodes have just one). MUST be
  // declared before any early return to satisfy the Rules of Hooks
  // — when the user navigates from a ChatNode WITH commits to one
  // without (or vice versa), the hook count must stay constant.
  const byRepo = useMemo(() => {
    const m = new Map<string, GitCommitRef[]>();
    for (const c of commits) {
      const list = m.get(c.repo) ?? [];
      list.push(c);
      m.set(c.repo, list);
    }
    return m;
  }, [commits]);

  if (!chatNode) {
    return (
      <div className="text-[12px] italic text-gray-400">
        {t("git_panel.placeholder_no_node")}
      </div>
    );
  }
  if (commits.length === 0) {
    return (
      <div className="text-[12px] italic text-gray-400">
        {t("git_panel.placeholder_no_commits")}
      </div>
    );
  }

  return (
    <div data-testid="git-diff-panel" className="space-y-3 text-[12px]">
      {Array.from(byRepo.entries()).map(([repo, repoCommits]) => (
        <RepoSection
          key={repo}
          sessionId={sessionId}
          repo={repo}
          commits={repoCommits}
        />
      ))}
    </div>
  );
}

function RepoSection({
  sessionId,
  repo,
  commits,
}: {
  sessionId: string;
  repo: string;
  commits: GitCommitRef[];
}) {
  const { t } = useTranslation();
  return (
    <section data-testid={`git-repo-${repo}`} className="space-y-1">
      <header className="flex items-baseline gap-1.5 text-[11px] text-gray-700 font-mono">
        <span className="text-gray-400">📁</span>
        <span className="break-all">{repo}</span>
        <span className="text-gray-400">
          {t("git_panel.repo_commit_count", { count: commits.length })}
        </span>
      </header>
      <ul className="space-y-1 pl-3 border-l border-gray-200">
        {commits.map((c) => (
          <li key={`${c.repo}-${c.sha}`}>
            <CommitRow sessionId={sessionId} commit={c} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function CommitRow({
  sessionId,
  commit,
}: {
  sessionId: string;
  commit: GitCommitRef;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<Array<{ path: string; status: string }> | null>(
    commit.files
      ? commit.files.map((p) => ({ path: p, status: "" }))
      : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const ensureLoaded = useCallback(async () => {
    if (files != null || loading) return;
    setLoading(true);
    try {
      const r = await fetchFiles(sessionId, commit.repo, commit.sha);
      if (r.ok) setFiles(r.files);
      else setError(`${r.code}${r.detail ? `: ${r.detail}` : ""}`);
    } finally {
      setLoading(false);
    }
  }, [files, loading, sessionId, commit.repo, commit.sha]);

  return (
    <div
      data-testid={`git-commit-${commit.sha}`}
      className="rounded border border-gray-200 bg-white"
    >
      <button
        type="button"
        onClick={() => {
          if (!open) void ensureLoaded();
          setOpen((v) => !v);
        }}
        data-testid={`git-commit-toggle-${commit.sha}`}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11px] hover:bg-gray-50"
      >
        <span className="font-mono text-[10px] text-gray-400">
          {open ? "▾" : "▸"}
        </span>
        <span className="font-mono text-amber-700">{commit.sha.slice(0, 7)}</span>
        <span className="text-gray-700 truncate">
          {commit.subject ?? <em className="text-gray-400">{t("git_panel.no_subject")}</em>}
        </span>
        {files && (
          <span className="ml-auto font-mono text-[10px] text-gray-400">
            {t("git_panel.files_count", { count: files.length })}
          </span>
        )}
      </button>
      {open && (
        <div className="border-t border-gray-100 px-2 py-1">
          {loading && (
            <div className="text-[11px] italic text-gray-400">
              {t("git_panel.loading_files")}
            </div>
          )}
          {error && (
            <div className="text-[11px] italic text-rose-600">{error}</div>
          )}
          {files && files.length === 0 && (
            <div className="text-[11px] italic text-gray-400">
              {t("git_panel.no_files")}
            </div>
          )}
          {files && files.length > 0 && (
            <ul className="space-y-0.5">
              {files.map((f) => (
                <li key={f.path}>
                  <FileRow
                    sessionId={sessionId}
                    repo={commit.repo}
                    sha={commit.sha}
                    file={f}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function FileRow({
  sessionId,
  repo,
  sha,
  file,
}: {
  sessionId: string;
  repo: string;
  sha: string;
  file: { path: string; status: string };
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [diff, setDiff] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fileRowRef = useRef<HTMLDivElement | null>(null);

  // Phase 4 cross-component highlight: workflow hover writes file
  // path into store; we read & reflect.
  const hoveredFromWorkflow = useStore(
    (s) => s.gitFileHoverFromWorkflow ?? null,
  );
  const focusedFromWorkflow = useStore(
    (s) => s.gitFileFocusFromWorkflow ?? null,
  );
  const setGitFileHoverFromPanel = useStore((s) => s.setGitFileHoverFromPanel);
  const isHoveredCross = hoveredFromWorkflow === file.path;
  const isFocusedCross = focusedFromWorkflow === file.path;

  // When workflow focus targets this file, auto-expand + scroll.
  useEffect(() => {
    if (!isFocusedCross) return;
    if (!open) {
      setOpen(true);
      void ensureDiff();
    }
    fileRowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFocusedCross]);

  const ensureDiff = useCallback(async () => {
    if (diff != null || loading) return;
    setLoading(true);
    try {
      const r = await fetchDiff(sessionId, repo, sha, file.path);
      if (r.ok) setDiff(r.text);
      else setError(`${r.code}${r.detail ? `: ${r.detail}` : ""}`);
    } finally {
      setLoading(false);
    }
  }, [diff, loading, sessionId, repo, sha, file.path]);

  return (
    <div
      ref={fileRowRef}
      data-testid={`git-file-${file.path}`}
      data-hovered-cross={isHoveredCross || isFocusedCross ? "true" : "false"}
      onMouseEnter={() => setGitFileHoverFromPanel(file.path)}
      onMouseLeave={() => setGitFileHoverFromPanel(null)}
      className={[
        "rounded border transition-colors",
        isHoveredCross || isFocusedCross
          ? "border-blue-400 bg-blue-50/50"
          : "border-transparent",
      ].join(" ")}
    >
      <button
        type="button"
        onClick={() => {
          if (!open) void ensureDiff();
          setOpen((v) => !v);
        }}
        data-testid={`git-file-toggle-${file.path}`}
        className="flex w-full items-center gap-1.5 px-2 py-0.5 text-left text-[11px] hover:bg-gray-50"
      >
        <span className="font-mono text-[10px] text-gray-400">
          {open ? "▾" : "▸"}
        </span>
        {file.status && (
          <span
            className={[
              "font-mono text-[10px] inline-flex items-center justify-center w-4 h-4 rounded",
              file.status.startsWith("A")
                ? "bg-emerald-100 text-emerald-700"
                : file.status.startsWith("D")
                  ? "bg-rose-100 text-rose-700"
                  : file.status.startsWith("M")
                    ? "bg-amber-100 text-amber-700"
                    : "bg-gray-100 text-gray-600",
            ].join(" ")}
            title={file.status}
          >
            {file.status[0]}
          </span>
        )}
        <span className="font-mono text-gray-700 truncate break-all">
          {file.path}
        </span>
      </button>
      {open && (
        <div className="border-t border-gray-100 px-2 py-1">
          {loading && (
            <div className="text-[11px] italic text-gray-400">
              {t("git_panel.loading_diff")}
            </div>
          )}
          {error && (
            <div className="text-[11px] italic text-rose-600">{error}</div>
          )}
          {diff && (
            <pre
              data-testid={`git-diff-${file.path}`}
              className="overflow-auto rounded bg-gray-50 p-2 text-[11px] font-mono whitespace-pre"
            >
              {diff}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// Force `Fragment` to be referenced (some bundlers tree-shake when
// it's "unused"). Keeps the diff between commits readable on rebase.
export const _Fragment = Fragment;
