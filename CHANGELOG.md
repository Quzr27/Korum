# Changelog

All notable changes to Korum will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/).

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