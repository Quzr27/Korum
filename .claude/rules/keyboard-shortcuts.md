---
paths:
  - "src/App.tsx"
  - "src/lib/terminal-shortcuts.ts"
  - "src/lib/terminal-shortcuts.test.ts"
  - "src/components/layout/ShortcutsOverlay.tsx"
  - "src/lib/xterm-session.ts"
  - "src/lib/war-room-shortcuts.ts"
  - "src/lib/war-room-shortcuts.test.ts"
---

# Keyboard Shortcuts

- Global shortcuts live on a document keydown listener in `App.tsx`.
- Modal guard blocks global shortcuts while quit, shortcuts, or create dialogs are open.
- Global shortcuts include new terminal, new note, close active window, new workspace, arrange grid, war-room mode, and shortcuts overlay.
- War-room mode toggles with Cmd/Ctrl+Shift+M from the `App.tsx` document keydown listener and must respect the same modal guard as other global shortcuts.
- Terminal shortcut interception lives in pure `handleTerminalShortcut()`.
- Cmd/Ctrl+C copies selected terminal text; if nothing is selected, allow SIGINT behavior.
- Cmd/Ctrl+V pastes through Tauri clipboard flow and may trigger multiline paste confirmation.
- Cmd/Ctrl+K clears viewport and sends form-feed behavior.
- Shift+Enter sends line feed.
- Intercepted terminal shortcuts must block both keydown and keyup to avoid xterm leaks.
- Shortcuts that App owns must return false from terminal handling so they can bubble to the document listener; keep terminal passthrough in sync when adding global shortcuts like war-room.
- `ShortcutsOverlay` is controlled by App state and uses shadcn Dialog plus ScrollArea.
- Add App-owned shortcuts to `ShortcutsOverlay` so the visible cheat sheet stays current.
