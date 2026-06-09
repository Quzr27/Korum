# Korum

Spatial terminal workspace for developers: a macOS-focused Tauri app with an infinite canvas, xterm.js terminals, notes, a project file tree, read-only code windows, and usage-limit tracking.

## Commands

```bash
bun install
bunx tauri dev
bunx tauri build
bun run lint
bun run lint:fix
bun run typecheck
bun run test
bun run test:watch
cd src-tauri && cargo check
cd src-tauri && cargo test
```

Full pre-handoff check:

```bash
bun run lint && bun run typecheck && bun run test && cd src-tauri && cargo check
```

## Tech Stack

- Desktop shell: Tauri 2, WKWebView on macOS, bundle id `dev.quzr.korum`.
- Frontend: React 19, TypeScript, Vite 7, React Compiler, Tailwind CSS 4.
- UI: shadcn/ui Mira preset, Radix primitives, HugeIcons, bundled Iconify Material file icons.
- Terminal: `@xterm/xterm` 5 with Fit and Serialize addons; Rust PTY via `portable-pty` 0.9.
- Code viewer: Shiki 4 with 16 configured themes and lazy language/theme loading.
- Notes: `react-markdown` 10 with raw HTML omitted.
- Backend: Tauri commands, `Channel<Vec<u8>>` terminal streaming, `serde_json` storage, `reqwest` with rustls.
- File tree: `ignore`, `git2` with `vendored-openssl`, `notify-debouncer-mini`.
- Tests: Vitest/jsdom for frontend, Cargo tests for Rust.

## Environment Variables & Local Credentials

- `TAURI_DEV_HOST`: non-secret Vite dev server host override in `vite.config.ts`; used for Tauri dev/HMR.
- `SHELL`: non-secret backend runtime input used to choose the default terminal shell.
- `HOME`: non-secret backend runtime input used to locate local credential files.
- `CODEX_HOME`: backend-only path override for Codex auth; not secret by itself, but it points at secret material.
- `TERM`: backend-set terminal env value (`xterm-256color`) for spawned PTYs.
- `~/.claude/.credentials.json`: server-only secret credential file; never read, import, log, or bundle it in frontend code.
- macOS Keychain service `Claude Code-credentials`: server-only secret fallback; access stays in Rust.
- `$CODEX_HOME/auth.json` or `~/.codex/auth.json`: server-only secret credential file; never expose it to the client bundle.

There is no checked-in `.env.example` and no app DB layer in the current source.

## Code Style & Imports

- TypeScript strict mode; avoid `any`.
- Use `@/` for internal frontend imports.
- Tailwind first; custom CSS only for domain styling Tailwind cannot express cleanly.
- Never edit generated shadcn files in `src/components/ui/`; wrap or override at usage sites.
- Use semantic tokens (`bg-accent`, `text-foreground`) instead of hardcoded theme colors in JSX.
- Prefer `flex flex-col gap-*` over `space-y-*`.
- Prefer `size-*` over paired `w-* h-*` when dimensions are equal.

## Cross-Cutting Patterns

- `src/App.tsx` owns durable app state, persistence, active workspace/window, paste guard, quit guard, and terminal hydration.
- Tauri commands stay thin in `src-tauri/src/commands.rs`; real work lives in Rust domain modules.
- Frontend owns JSON state/settings schema; Rust storage validates shape and writes atomically.
- Performance-sensitive canvas/window paths use refs, direct DOM updates, memoization, and single commit points.
- PTY and xterm lifecycles are separate: Rust PTYs can survive React unmounts while xterm attaches/detaches.
- File and URL terminal links are parsed in pure frontend helpers and bridge to Tauri only for safe actions.

## Gotchas

- Do not change bundle identifier `dev.quzr.korum`; app data paths depend on it.
- Shiki requires `script-src 'wasm-unsafe-eval'` in Tauri CSP for release builds.
- Iconify CDN fetches are blocked by CSP; `main.tsx` must register the bundled Material icon collection.
- `git2` depends on OpenSSL; keep `vendored-openssl` for cross-architecture macOS release builds.
- Release behavior can diverge from dev; test `bunx tauri build` before tagging release changes.
- DMG installer: if `.background` / `.VolumeIcon.icns` icons (or a white gap when the window is stretched) appear in the installer window, it is only because Finder's "show hidden files" (⌘⇧.) is enabled — those are dot-prefixed support files revealed by that toggle. Normal users (toggle off) see a clean window; this is standard macOS behavior, not a packaging bug, and no DMG tool fully hides it under show-hidden. The DMG background image must stay exactly the window size (660x400) — a wider image adds a horizontal scrollbar. See `build-release-ci.md`.
- `LP/` is a separate static landing page and currently has independent release copy.

## Tooling

- Codegraph is configured locally through `.codegraph/`; when MCP tools are available, use `codegraph_context` first for where-is-X, architecture, flow, and impact questions.
- Use grep/read to confirm small exact details after codegraph, or when codegraph is unavailable/stale.
- If the Codex in-app Browser tools are available, use them for local frontend smoke checks after meaningful UI work.

## Working Principles

- Think before coding on non-trivial tasks; name the approach before changing files.
- Keep changes surgical and aligned with existing module boundaries.
- Verify claims against real source before documenting names, commands, paths, IPC commands, credentials, or schemas.
- Run the narrowest useful checks during development, then the full pre-handoff check for non-trivial implementation work.
- For substantial implementations, use reviewer and QA agents in parallel before final handoff.

## Documentation Self-Maintenance

- After adding a feature, component family, backend module, IPC command, setting, persisted field, or shared pattern, update the relevant rule file under `.claude/rules/`.
- Update this `CLAUDE.md` only for new top-level commands, dependencies, environment inputs, global conventions, or rule index changes.
- Skip documentation updates for small bug fixes, style-only tweaks, copy changes, and refactors that do not change behavior or patterns.
- Keep rule files path-scoped with real `paths:` globs so future sessions auto-load only the relevant context.

## Detailed Rules

- `.claude/rules/project-architecture.md` - app entry points, source layout, and feature boundaries.
- `.claude/rules/build-release-ci.md` - Bun/Tauri build commands, CI, release, CSP, and packaging notes.
- `.claude/rules/tauri-ipc-backend.md` - Rust command registration, IPC patterns, capabilities, and backend module rules.
- `.claude/rules/persistence-storage.md` - app state/settings persistence, schema ownership, and atomic storage.
- `.claude/rules/design-system.md` - shadcn, Tailwind, icons, CSS variables, z-index, and UI styling conventions.
- `.claude/rules/frontend-patterns.md` - React performance, refs, dialogs, local errors, and shared frontend habits.
- `.claude/rules/performance.md` - canvas motion, tether sync cadence, and single-file git status performance decisions.
- `.claude/rules/testing-quality.md` - Vitest, Cargo tests, mocks, and verification expectations.
- `.claude/rules/canvas-engine.md` - pan/zoom canvas, viewport culling, snapping, minimap, and arrange-grid behavior.
- `.claude/rules/terminal-system.md` - PTY/xterm lifecycle, hydration, live terminal selection, and WKWebView terminal issues.
- `.claude/rules/terminal-smart-links.md` - terminal URL/file path link parsing, resolution, and CodeWindow targeting.
- `.claude/rules/agent-status.md` - cross-vendor agent kind/activity detection, status IPC, canvas halo, minimap color, and session-only rules.
- `.claude/rules/workspaces-sidebar.md` - workspace model, sidebar, file drawer state, and active item navigation.
- `.claude/rules/file-tree.md` - file tree backend, git status, watchers, CRUD, and frontend tree behavior.
- `.claude/rules/code-window.md` - read-only code viewer, Shiki themes, diff mode, minimap, and file refresh.
- `.claude/rules/note-window.md` - note editing, markdown preview safety, and file-backed note loading.
- `.claude/rules/settings-system.md` - SettingsProvider, settings validation, migration, bootstrap cache, and DOM theme application.
- `.claude/rules/usage-limits.md` - Claude/Codex usage APIs, credentials, cache, backoff, and nullable buckets.
- `.claude/rules/keyboard-shortcuts.md` - global shortcuts, terminal shortcut interception, and shortcuts overlay.
- `.claude/rules/quit-paste-guards.md` - guarded app quit and multiline paste confirmation flows.
- `.claude/rules/landing-page.md` - static `LP/` site boundaries, assets, and version-copy caveat.

## Task Completion Summary

End every task with:

- **Agents used:** [list or "none - handled directly"]
- **Skills loaded:** [list]
- **Hooks fired:** [tooling/hooks/errors, or "none"]
- **Files changed:** [count + key files]
- **CLAUDE.md/rules updated:** yes/no
