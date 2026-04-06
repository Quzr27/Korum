// ── Settings validation, parsing, and localStorage helpers ──

import type { Settings, BaseColor, CanvasAtmosphere, RadiusPreset, ZoomSpeed } from "./types";
import {
  DEFAULT_SETTINGS,
  BASE_COLOR_LABELS,
  CANVAS_ATMOSPHERES,
  RADIUS_PRESETS,
  ZOOM_SPEED_OPTIONS,
} from "./types";
import {
  TERMINAL_FONTS,
  TERMINAL_THEMES,
  LEGACY_TERMINAL_THEME_MIGRATIONS,
  normalizeTerminalFont,
  normalizeTerminalTheme,
} from "./terminal";

const STORAGE_KEY = "korum-settings";
const BOOTSTRAP_STORAGE_KEY = "korum-settings-bootstrap";

/** Parse and validate a raw settings object (from any source) into a safe Settings value. */
export function validateSettings(raw: unknown): Settings {
  if (!raw || typeof raw !== "object") return DEFAULT_SETTINGS;
  const p = raw as Record<string, unknown>;
  return {
    theme: p.theme === "light" || p.theme === "dark" ? p.theme : DEFAULT_SETTINGS.theme,
    baseColor: typeof p.baseColor === "string" && p.baseColor in BASE_COLOR_LABELS
      ? p.baseColor as BaseColor : DEFAULT_SETTINGS.baseColor,
    radius: (RADIUS_PRESETS as readonly number[]).includes(p.radius as number)
      ? p.radius as RadiusPreset : DEFAULT_SETTINGS.radius,
    terminalFont: normalizeTerminalFont(p.terminalFont),
    terminalFontSize: typeof p.terminalFontSize === "number" && p.terminalFontSize >= 10 && p.terminalFontSize <= 20
      ? p.terminalFontSize : DEFAULT_SETTINGS.terminalFontSize,
    terminalTheme: normalizeTerminalTheme(p.terminalTheme),
    canvasAtmosphere:
      typeof p.canvasAtmosphere === "string" &&
      (CANVAS_ATMOSPHERES as readonly string[]).includes(p.canvasAtmosphere)
        ? p.canvasAtmosphere as CanvasAtmosphere
        : DEFAULT_SETTINGS.canvasAtmosphere,
    zoomSpeed: (ZOOM_SPEED_OPTIONS as readonly number[]).includes(p.zoomSpeed as number)
      ? p.zoomSpeed as ZoomSpeed : DEFAULT_SETTINGS.zoomSpeed,
  };
}

/** Validate settings and report whether every field was semantically valid. */
export function parseSettings(raw: unknown): { settings: Settings; isFullyValid: boolean } {
  const settings = validateSettings(raw);
  if (!raw || typeof raw !== "object") {
    return { settings, isFullyValid: false };
  }

  const p = raw as Record<string, unknown>;
  const isThemeValid = p.theme === "light" || p.theme === "dark";
  const isBaseColorValid = typeof p.baseColor === "string" && p.baseColor in BASE_COLOR_LABELS;
  const isRadiusValid = (RADIUS_PRESETS as readonly number[]).includes(p.radius as number);
  const isTerminalFontValid = typeof p.terminalFont === "string" && (TERMINAL_FONTS as readonly string[]).includes(p.terminalFont);
  const isTerminalFontSizeValid = typeof p.terminalFontSize === "number" && p.terminalFontSize >= 10 && p.terminalFontSize <= 20;
  const isTerminalThemeValid =
    typeof p.terminalTheme === "string" &&
    (
      (TERMINAL_THEMES as readonly string[]).includes(p.terminalTheme) ||
      p.terminalTheme in LEGACY_TERMINAL_THEME_MIGRATIONS
    );
  // canvasAtmosphere: treat missing field as valid (new field, existing settings files won't have it)
  const isCanvasAtmosphereValid =
    p.canvasAtmosphere === undefined ||
    (typeof p.canvasAtmosphere === "string" &&
    (CANVAS_ATMOSPHERES as readonly string[]).includes(p.canvasAtmosphere));
  const isZoomSpeedValid = (ZOOM_SPEED_OPTIONS as readonly number[]).includes(p.zoomSpeed as number);

  return {
    settings,
    isFullyValid:
      isThemeValid &&
      isBaseColorValid &&
      isRadiusValid &&
      isTerminalFontValid &&
      isTerminalFontSizeValid &&
      isTerminalThemeValid &&
      isCanvasAtmosphereValid &&
      isZoomSpeedValid,
  };
}

/** Load settings from localStorage (legacy, sync). */
export function loadSettingsFromLocalStorage(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return validateSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Load sync bootstrap settings used for the first paint before Rust init completes. */
export function loadBootstrapSettings(): Settings {
  try {
    const raw = localStorage.getItem(BOOTSTRAP_STORAGE_KEY) ?? localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return validateSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Check whether localStorage contains settings data. */
export function hasLocalStorageSettings(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== null;
}

/** Remove settings from localStorage (post-migration cleanup). */
export function clearLocalStorageSettings(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/** Keep a sync bootstrap cache for the next cold start paint. */
export function saveBootstrapSettings(settings: Settings): void {
  localStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify(settings));
}
