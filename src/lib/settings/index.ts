// ── Public API barrel — prefer direct imports from leaf modules ──

export type {
  ThemeMode,
  BaseColor,
  TerminalFont,
  TerminalTheme,
  CanvasAtmosphere,
  RadiusPreset,
  ZoomSpeed,
  Settings,
} from "./types";

export {
  DEFAULT_SETTINGS,
  ZOOM_SPEED_OPTIONS,
  BASE_COLOR_LABELS,
  BASE_COLOR_SWATCHES,
  CANVAS_ATMOSPHERE_LABELS,
  CANVAS_ATMOSPHERES,
  RADIUS_PRESETS,
} from "./types";

export {
  TERMINAL_FONTS,
  TERMINAL_FONT_FAMILIES,
  TERMINAL_FONT_LOAD_TARGETS,
  TERMINAL_THEME_LABELS,
  TERMINAL_THEMES,
  XTERM_THEMES,
  getXtermTheme,
} from "./terminal";

export {
  validateSettings,
  parseSettings,
  loadSettingsFromLocalStorage,
  loadBootstrapSettings,
  hasLocalStorageSettings,
  clearLocalStorageSettings,
  saveBootstrapSettings,
} from "./storage";

export { applySettings } from "./apply";
