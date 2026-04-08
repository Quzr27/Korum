# Changelog

All notable changes to Korum will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/).

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