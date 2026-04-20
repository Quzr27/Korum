# Changelog

All notable changes to Korum will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/).

## [0.2.1-alpha] - 2026-04-20

### Fixed
- **Usage limits card stuck on stale value** — Anthropic started returning `"resets_at": null` for zero-utilization buckets (e.g. `seven_day_sonnet`). The Rust `UsageBucket.resets_at` was non-nullable, so serde rejected the whole response → frontend silently fell back to the last cached value (the "stuck at 57%" bug). `resets_at` is now `Option<String>` in both Rust and TS; `formatTimeUntil` handles null gracefully
- **Race on toggle off/on of usage card** — module-level `fetchInFlight` combined with a per-instance `mountedRef` could apply an in-flight fetch's result to a freshly-remounted card. Replaced with a per-effect `alive` flag (same pattern as FileTree)
- **Orphan "Claude" section header** — when all buckets were null but `extra_usage.is_enabled === false`, the card rendered an empty Claude header. Tightened `hasClaude` to check `is_enabled === true`

### Added
- **Opus and OAuth apps rows** in the usage card (`seven_day_opus`, `seven_day_oauth_apps` buckets from the OAuth usage endpoint)
- **Credits row** — new `extra_usage` field exposes monthly credit pool (used/limit, currency-aware symbol, utilization %)

### Changed
- `CodexUsageBucket.resets_at` is now `Option<String>` (was `String`) for consistency with the Claude side
- Bumped usage cache key to `korum-usage-claude-v2`; pre-v2 key removed on first load

## [0.2.0-alpha] - 2026-04-11

### Added
- **File tree sidebar** — per-workspace file browser with .gitignore filtering, git status badges (M/A/D/?), folder child counts, show-ignored toggle, context menu CRUD (create/rename/delete), debounced file watcher, watcher error indicator
- **Code viewer** — read-only CodeWindow with Shiki syntax highlighting (16 themes, lazy language + theme loading), line numbers, inline diff view (Changes mode), theme selector with color swatches, minimap with click-to-navigate, auto-refresh on file changes
- **Material file icons** — 200+ file/folder icon mappings via @iconify/react + material-icon-theme (bundled, no CDN)
- **Language detection** — file extension → Shiki language mapping (~40 extensions + special filenames)
- **Drag/resize hook** — shared `useDragResize` for all window types (GPU-accelerated transform, zero re-renders during motion)
- **Process detection** — foreground process polling with status dots in sidebar + titlebar

### Fixed
- **Release build: icons not loading** — bundled icon collection via `addCollection()` at startup (CSP blocked CDN fetch)
- **Release build: code viewer blank** — added `'wasm-unsafe-eval'` to CSP for Shiki's Oniguruma WASM engine

### Internal
- 58 new tests: `confine_path` (6), `confine_new_path` (4), `read_directory` (7) with .gitignore coverage, `detectLanguage` (10), `getFileIconName` (31)
- New Rust module: `file_tree.rs` (directory reading, git status, file CRUD, path confinement, file watching)
- Path confinement security: all mutating file ops verified against workspace root

## [0.1.1-alpha] - 2026-04-08

### Added
- **Usage limits card** — live Claude Code & OpenAI Codex usage tracking via OAuth APIs (5-min polling, localStorage cache, 429 backoff)
- **Paste protection dialog** — confirmation prompt before pasting large content into terminal

### Changed
- Extracted `useXtermSession` hook from TerminalWindow (cleaner terminal lifecycle)
- Added `VisibilityProvider` for single-listener broadcast on focus/unlock
- CSS scale compensation for xterm mouse events extracted to `xterm-mouse-compat.ts`

### Fixed
- Strengthened TypeScript type safety across frontend (eliminated loose types, stricter generics)

### Internal
- Added unit tests for paste dialog, visibility context, and xterm mouse compat
- Added `card` and `progress` shadcn components
- New Rust modules: `claude_usage.rs`, `codex_usage.rs` (OAuth token refresh, Keychain fallback)

## [0.1.0-alpha] - 2026-04-04

> Initial public alpha of Korum — a spatial terminal workspace for developers. Feedback welcome.

### Added

#### Core
- Infinite canvas with pan and zoom
- Terminal windows powered by xterm.js and portable-pty
- Markdown note windows with live preview

#### Workspace
- Workspace system backed by project folders or scratch spaces
- Collapsible sidebar with workspace tree
- Session persistence (window positions, sizes, and terminal content survive restarts)

#### UX & Controls
- Keyboard shortcuts overlay (Cmd+Shift+?)
- Context menu (right-click canvas for new terminal, note, arrange grid)
- Double-click canvas to quick-open terminal
- Quit guard with save confirmation

#### Customization
- Settings panel with 25 terminal themes and 5 canvas atmospheres
- Configurable terminal font, font size, and zoom speed

#### Reliability
- Atomic file storage with backup fallback
- Empty canvas state with onboarding hints

### Known Issues

- macOS only (Linux/Windows not yet supported or tested)
- App is not code-signed (Gatekeeper will show a warning on first launch)