// ── Apply settings to DOM ──

import type { Settings } from "./types";
import { BASE_THEMES } from "./themes";
import { CANVAS_ATMOSPHERE_VARS } from "./atmosphere";

export function applySettings(settings: Settings): void {
  const root = document.documentElement;

  // Theme mode
  root.classList.toggle("dark", settings.theme === "dark");

  // Radius
  root.style.setProperty("--radius", `${settings.radius}rem`);

  // Apply base color (all variables)
  const baseVars = BASE_THEMES[settings.baseColor][settings.theme];
  for (const [key, value] of Object.entries(baseVars)) {
    root.style.setProperty(`--${key}`, value);
  }

  const canvasVars = CANVAS_ATMOSPHERE_VARS[settings.canvasAtmosphere];
  for (const [key, value] of Object.entries(canvasVars)) {
    root.style.setProperty(`--${key}`, value);
  }
}
