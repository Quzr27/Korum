---
paths:
  - "components.json"
  - "src/main.tsx"
  - "src/components/ui/**"
  - "src/components/branding/**"
  - "src/components/layout/SettingsPanel.tsx"
  - "src/lib/settings/**"
  - "src/styles/**"
---

# Design System

- shadcn config uses `radix-mira`, CSS variables, HugeIcons, and inverted translucent menus.
- Never edit generated files in `src/components/ui/`; override with `className`, wrappers, or usage-site composition.
- UI primitives are Radix/shadcn style; `Button` uses `class-variance-authority` and shared `cn()`.
- Use HugeIcons for app actions and `@iconify/react` Material file icons for file/folder rows.
- `src/main.tsx` must call `addCollection(materialIcons)` before render; release CSP blocks Iconify CDN fetches.
- Tailwind v4 is CSS-first through `src/styles/app.css`; there is no Tailwind config file.
- Theme variables are applied to `document.documentElement` by `applySettings()`: base theme first, canvas atmosphere second.
- `color-scheme` belongs in CSS cascade (`:root` and `.dark`), not inline styles.
- Use semantic color tokens in JSX and avoid hardcoded OKLCH values outside theme definitions.
- Panel depth uses `--app-panel-shadow` / `--app-drawer-shadow`; light mode should stay subtle and rely more on borders than heavy black shadows.
- Light-mode selected/active states should avoid warm `accent` fills; prefer a restrained `foreground` overlay with borders so the UI stays graphite/neutral.
- Prefer `flex flex-col gap-*` over `space-y-*` and `size-*` over paired equal width/height utilities.
- Sidebar and overlays rely on z-index order: canvas/minimap/sidebar around `z-40`, Radix overlays at `z-50`.
- Do not add global resets like `* { padding: 0 }`; unlayered resets override Tailwind v4 utilities and break shadcn spacing.
