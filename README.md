# Loomscope

Visual viewer for Claude Code session transcripts (`.jsonl`). Renders the linear transcript file as a DAG canvas of turns, tool calls, and sub-agent invocations — same display family as [Agentloom](https://github.com/usingnamespacestc/Agentloom), adapted to Claude Code's data model.

> Read-only by design (v0). Live observation + interactive control land in v∞.

## What it shows

- **ChatFlow canvas** — every user prompt + assistant turn in the session as a node; forks (`/branch` / mid-session restore) render as DAG branches; compact summaries fold inline; hover over a card to pan, click to drill in.
- **WorkFlow canvas** — drill into a turn to see the inner tool-call graph (`llm_call → tool_call → llm_call`); sub-agents (`Task` / `Agent` delegations) expand into nested ChatFlows recursively.
- **Conversation panel** — Claude-App-style chat bubbles for the focused linear path; markdown-rendered with syntax-highlighted code blocks, expandable tool pills, branch selectors at fork points.
- **Live tail** — chokidar + SSE picks up jsonl appends within ~80 ms; the canvas adds new ChatNodes / WorkNodes as they land. Selection auto-follows the leaf when you're sitting on it.
- **Permission banner** *(v∞.0)* — when CC asks for a tool-permission confirmation in the terminal, a yellow strip appears in the browser so you know why the session looks paused.

## What's shipped

Detailed history in [`docs/plan.md`](docs/plan.md) and [`docs/devlog.md`](docs/devlog.md).

| Version | Highlights |
|---|---|
| v0.1 | Two-pass JSONL parser, 5 WorkNode kinds, 256 MB session loads in ~2 s |
| v0.2-0.4 | Hono backend, Zustand store, dagre LR layout, drill panel + 5 node-detail views, chunked tool-result lazy-load |
| v0.5 | Sub-agent real nesting via sidecar `subagents/agent-X.jsonl` |
| v0.6 | Data-model unification (NodeBase + ChatNode/WorkNode), recursive sub-ChatFlow |
| v0.7 | Compact handling — file-history-snapshot binding via messageId, pre-compact range fold |
| v0.8 | Fork browsing — `/branch`-spawned forks merged into one ChatFlow with a fork tree view |
| v0.9 | File-tail spike: chokidar + SSE live tail, sidecar watch, workspace scanner, header live indicator |
| v0.10 | Lazy ChatFlow B1-B5 (`workflow.nodes` lazy-fetch), markdown viewport-gated render, viewport-driven workflow fetch + lookahead, M0+M1+M2 incremental parser, persistent disk cache |
| v∞.0 | CC `settings.json` HTTP hooks → SSE; `/api/cc-hook` endpoint with per-installation secret; `PermissionRequest` banner; `~/.claude/settings.json` patcher + onboarding modal; Header hook-status chip |

## Run

```sh
git clone https://github.com/usingnamespacestc/Loomscope.git
cd Loomscope
npm install
npm run dev    # frontend http://localhost:5175 (Vite proxies /api → backend on 5174)
```

`npm run dev` boots both the Hono backend (`tsx watch src/server/cli.ts`) and the Vite frontend dev server. The frontend's `/api/*` requests are proxied to the backend so everything works from one origin.

For a single-process production-ish run (one Hono serving both API + built frontend on port 5174):

```sh
npm run build      # vite build → dist/
npm run start      # tsx src/server/cli.ts (auto-detects dist/ and serves it)
```

### Open a session

The sidebar lists every Claude Code project under `~/.claude/projects/` with a session count per project. Click a project to expand its sessions, click a session to render. The sidebar is live — new jsonl files appearing on disk show up without manual refresh.

### Wire CC hooks (optional, recommended)

Loomscope's "live tail" already picks up everything in the jsonl. The `settings.json` hooks add what's NOT in the jsonl — most importantly **PermissionRequest** events that show up as a banner in the browser when CC pauses for terminal y/n confirmation.

On first launch Loomscope detects missing hooks and pops a modal:

- **One-click auto-add** writes Loomscope's hook entries into `~/.claude/settings.json` atomically (preserves every other key + every third-party hook on the same event names).
- **Copy + paste** shows the JSON snippet so you can merge it manually.
- **暂不开启** dismisses with a localStorage flag so you don't get pestered.

Either path needs a `LOOMSCOPE_SECRET` shell export — the modal generates the secret on first launch, persists to `~/.loomscope/secret`, and shows the exact line to paste into your `.zshrc` / `.bashrc`. CC's `allowedEnvVars` whitelist substitutes it into the hook header at fire time, defending against same-host hook forgery.

The Header chip (`🪝 11/11`) shows status at a glance.

## Architecture

Mode A (single-user local) is the default. Backend binds to `127.0.0.1:5174`; CORS is strict same-origin; the CC hook endpoint uses a per-installation secret instead of CSRF (server-to-server fire path). For remote viewing, terminate at the local machine and tunnel — Tailscale, SSH `-L`, or Cloudflare Tunnel are all clean fits.

Detailed designs in `docs/`:
- [design-data-model.md](docs/design-data-model.md) — JSONL → ChatNode / WorkNode mapping, sidecar mechanics, fork semantics
- [design-architecture.md](docs/design-architecture.md) — Hono routes, Zustand slices, SSE wiring, hook event flow, security model
- [design-visual-language.md](docs/design-visual-language.md) — node visual conventions
- [plan.md](docs/plan.md) — version-by-version roadmap
- [devlog.md](docs/devlog.md) — chronological dev notes

## Stack

Vite 8 + React 18 + TypeScript 5.6 + Tailwind 3 + `@xyflow/react` 12 + `@dagrejs/dagre` for layout · Hono 4 + chokidar 5 on the backend · Zustand 5 for state · Vitest 4 for tests.

## Tests

```sh
npm test          # 559 tests
npm run typecheck
```

## Status

v0.10 is the current "polished read-only viewer" line. v∞.0 read-only remote observation + permission visibility is shipped. Live writes (v∞.1 new session / v∞.2 leaf continuation / v∞.3 mid-graph fork via Agent SDK) are the next major phase.

## License

MIT (planned for v1.0 release; not finalised).
