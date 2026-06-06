---
paths:
  - "src-tauri/src/agent_status.rs"
  - "src-tauri/src/pty.rs"
  - "src-tauri/src/commands.rs"
  - "src-tauri/src/lib.rs"
  - "src/types/index.ts"
  - "src/lib/agent-status.ts"
  - "src/lib/agent-status.test.ts"
  - "src/App.tsx"
  - "src/components/canvas/Canvas.tsx"
  - "src/components/canvas/TerminalWindow.tsx"
  - "src/styles/app.css"
  - "src/styles/window.css"
---

# Agent Status

- `src-tauri/src/agent_status.rs` owns agent kind/activity detection and emits `korum://agent-status-changed`; frontend code receives only derived `AgentStatus`, never raw session/conversation content or Claude task summaries.
- Agent terminal registration is session-only: `register_agent_terminal`, `unregister_agent_terminal`, and `get_agent_statuses` use frontend terminal window ids, while backend PTY ids stay implementation details.
- Claude status prefers fixed-argument `claude agents --json` with defensive JSON parsing. Match Claude sessions by canonical cwd/worktree; if multiple terminals share the same cwd, report `unknown` instead of guessing.
- Codex status is best-effort from recent PTY scrollback first, then a metadata-only `~/.codex/sessions` mtime fallback when exactly one Codex terminal can be associated. Do not read or forward Codex session file contents.
- Generic status should stay conservative. Recent ordinary output alone is not enough to mark an unknown terminal as `working`.
- `PtyState` keeps separate pending replay and rolling scrollback buffers. Do not re-use the pending attach buffer for status classification; it is drained on attach.
- `App` keeps agent statuses in a ref, not React durable state. Status events update `.window[data-agent-activity]`, minimap rect styles, and terminal status dots by direct DOM projection to avoid re-rendering all windows on every poll.
- Do not add agent status fields to `WindowState` persistence. Status must not appear in `state.json` after restart.
- Status colors are semantic CSS variables in `src/styles/app.css`; window halo/border styling lives in `src/styles/window.css`. `waiting` should remain the strongest attention state.
- Tests belong close to pure logic: Rust parser/classifier tests in `agent_status.rs`; frontend presentation mapper tests in `src/lib/agent-status.test.ts`.
