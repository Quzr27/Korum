---
paths:
  - "src/lib/settings/**"
  - "src/lib/settings-context.tsx"
  - "src/components/layout/SettingsPanel.tsx"
  - "src/components/layout/UsageLimitsCard.tsx"
  - "src/components/layout/ZoomSpeedControl.tsx"
  - "src/main.tsx"
  - "src/styles/app.css"
  - "src-tauri/src/storage.rs"
---

# Settings System

- `SettingsProvider` wraps the app in `src/main.tsx` and exposes validated settings through React context.
- `main.tsx` applies bootstrap settings before first render to avoid theme flash.
- Settings fields are theme, base color, radius, terminal font/size/theme, code theme, canvas atmosphere, zoom speed, and usage-limits visibility.
- Base color keys are `neutral`, `zinc`, `stone`, `mauve`, and `olive`; labels map them to `Neutral`, `Slate`, `Graphite`, `Violet`, and `Sage`.
- Radius presets are intentionally limited to `0.625` (`Default`) and `0` (`None`); legacy radius values should validate back to the default.
- Terminal fonts are `JetBrains Mono`, `IBM Plex Mono`, and `Source Code Pro`.
- Terminal themes are the 25 keys in `TERMINAL_THEME_LABELS`; fresh installs default to `tomorrow-night`.
- Code themes are the 16 keys in `CODE_THEMES`.
- Canvas atmospheres are `workbench`, `blueprint`, `draft`, and `signal`; `workbench` is the quiet default surface.
- Legacy canvas atmosphere values (`plain`, `studio`, `aurora`, `mist`, `nocturne`) are no longer active choices and should validate back to `workbench`.
- `validateSettings()` returns safe defaults; `parseSettings()` also reports full semantic validity for migration/healing.
- Missing newer optional fields should be treated as valid to avoid migration loops for existing users.
- Rust-managed settings are loaded first; legacy localStorage can heal invalid/missing Rust settings.
- `korum-settings-bootstrap` remains in localStorage for synchronous first paint only.
- `persistSettings()` is debounced, and pending settings must flush on app close.
- Font size slider commits on pointerup/blur/keyup instead of every tick to avoid xterm refit lag.
