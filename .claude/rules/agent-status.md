---
paths:
  - "src-tauri/src/agent_status.rs"
  - "src-tauri/src/pty.rs"
  - "src-tauri/src/commands.rs"
  - "src-tauri/src/lib.rs"
  - "src/types/index.ts"
  - "src/lib/agent-status.ts"
  - "src/lib/agent-status.test.ts"
  - "src/lib/agent-status-store.ts"
  - "src/lib/agent-status-store.test.ts"
  - "src/App.tsx"
  - "src/components/canvas/Canvas.tsx"
  - "src/components/canvas/TerminalWindow.tsx"
  - "src/components/layout/Sidebar.tsx"
  - "src/styles/app.css"
  - "src/styles/window.css"
---

# Agent Status

- `src-tauri/src/agent_status.rs` owns agent kind/activity detection and emits `korum://agent-status-changed`; frontend code receives only derived `AgentStatus`, never raw session/conversation content or Claude task summaries.
- Agent terminal registration is session-only: `register_agent_terminal`, `unregister_agent_terminal`, and `get_agent_statuses` use frontend terminal window ids, while backend PTY ids stay implementation details.
- Claude status prefers fixed-argument `claude agents --json` (which reports each live session's `pid`, `cwd`, and a `status` like `busy`/`idle`) with defensive JSON parsing. Correlate a session to a terminal by **pid** first (`claude` is its own process-group leader, so its pid equals the PTY foreground process group), since several sessions commonly share one repo cwd. Fall back to cwd correlation only when a single session owns the cwd; ambiguous/unmatched cwd falls through to per-terminal scrollback rather than guessing or hard-`unknown`.
- `claude agents --json` keeps `status: busy` for the whole turn, so Claude stays `working` between tool calls; escalate `working`→`waiting` only when the terminal's bottom rows show an approval/input prompt.
- Spawn `claude` with a resolved PATH (`claude_env_path`/`user_shell_path`), not bare. A Finder/Dock-launched macOS app only inherits a minimal PATH, so a bare `claude agents --json` returns ENOENT in release builds (works in `tauri dev` only because the launching terminal's PATH is inherited) — which silently drops the authoritative Claude status to the scrollback fallback. The login-shell PATH is resolved once via `$SHELL -ilc` and cached.
- Codex status is best-effort from recent PTY scrollback first, then a metadata-only `~/.codex/sessions` mtime fallback when exactly one Codex terminal can be associated. Do not read or forward Codex session file contents.
- Scrollback classification is hysteretic: a positive interrupt-hint marker (`esc to interrupt`, etc.) while output is streaming sets `working`; that stays sticky through large tool-output dumps and brief quiet think-gaps so green holds until a turn ends, then resolves to `idle` once quiet on a prompt. The poller keeps a per-terminal `last_working_at` memory for this; it is pruned to live registrations.
- Generic status should stay conservative. Recent ordinary output alone is not enough to mark an unknown terminal as `working`; working markers are kept high-precision (no bare `working`/`running`) so the sticky window never traps a plain shell green.
- `PtyState` keeps separate pending replay and rolling scrollback buffers. Do not re-use the pending attach buffer for status classification; it is drained on attach.
- `src/lib/agent-status-store.ts` is the single source of truth for statuses. Canvas/minimap consume it imperatively (`App` reads `getAgentStatusMap()` and projects to `.window[data-agent-activity]` + minimap styles, avoiding window re-renders on every poll). The sidebar subscribes via `useAgentActivities()` (`useSyncExternalStore`) so its per-terminal status dots stay correct across all workspaces; it never re-renders the canvas.
- Sidebar renders a per-terminal status dot (working/waiting solid + pulsing, idle faint, unknown hidden) and an aggregate dot on a collapsed workspace row, so status is visible without entering the workspace.
- Do not add agent status fields to `WindowState` persistence. Status must not appear in `state.json` after restart.
- Status colors are semantic CSS variables in `src/styles/app.css`; window halo/border styling lives in `src/styles/window.css`. `waiting` stays the strongest attention state; `idle`/`unknown` are muted/neutral (never blue — blue/accent is reserved for the focused window) and draw no window halo.
- Tests belong close to pure logic: Rust parser/classifier/pid-correlation tests in `agent_status.rs`; frontend presentation mapper tests in `src/lib/agent-status.test.ts` and store tests in `src/lib/agent-status-store.test.ts`.
