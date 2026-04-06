// ── Settings types and constants ──

export type ThemeMode = "light" | "dark";
export type BaseColor = "neutral" | "zinc" | "stone" | "mauve" | "olive";
export type TerminalFont = "JetBrains Mono" | "IBM Plex Mono" | "Source Code Pro";
export type TerminalTheme = "arcadia-midnight" | "tomorrow-night" | "tomorrow-night-eighties" | "oceanic-next" | "one-dark" | "gruvbox-soft" | "gruvbox-medium" | "harmonic-dark" | "materia" | "monokai" | "ocean" | "seti" | "solarized-dark" | "spacemacs" | "atelier-forest" | "afterglow" | "argonaut" | "cobalt2" | "dimmed-monokai" | "dracula" | "duotone-dark" | "spacegray-eighties" | "papercolor-light" | "tomorrow-light" | "one-half-light";
export type CanvasAtmosphere = "plain" | "studio" | "aurora" | "mist" | "nocturne";
export type RadiusPreset = 0 | 0.3 | 0.5 | 0.625 | 0.75 | 1;
export type ZoomSpeed = 0.5 | 1 | 1.5 | 2 | 3;

export interface Settings {
  theme: ThemeMode;
  baseColor: BaseColor;
  radius: RadiusPreset;
  terminalFont: TerminalFont;
  terminalFontSize: number;
  terminalTheme: TerminalTheme;
  canvasAtmosphere: CanvasAtmosphere;
  zoomSpeed: ZoomSpeed;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  baseColor: "neutral",
  radius: 0.625,
  terminalFont: "IBM Plex Mono",
  terminalFontSize: 13,
  terminalTheme: "arcadia-midnight",
  canvasAtmosphere: "studio",
  zoomSpeed: 1,
};

export const ZOOM_SPEED_OPTIONS: ZoomSpeed[] = [0.5, 1, 1.5, 2, 3];

export const BASE_COLOR_LABELS: Record<BaseColor, string> = {
  neutral: "Neutral", zinc: "Slate", stone: "Amber", mauve: "Violet", olive: "Emerald",
};

export const BASE_COLOR_SWATCHES: Record<BaseColor, string> = {
  neutral: "#a3a3a3",
  zinc: "#7ea9d3",
  stone: "#e1a95f",
  mauve: "#bf84f6",
  olive: "#5fc59a",
};

export const CANVAS_ATMOSPHERE_LABELS: Record<CanvasAtmosphere, string> = {
  plain: "Plain",
  studio: "Studio",
  aurora: "Aurora",
  mist: "Mist",
  nocturne: "Nocturne",
};

export const CANVAS_ATMOSPHERES: CanvasAtmosphere[] = Object.keys(
  CANVAS_ATMOSPHERE_LABELS,
) as CanvasAtmosphere[];

export const RADIUS_PRESETS: RadiusPreset[] = [0, 0.3, 0.5, 0.625, 0.75, 1];

export type CssVarMap = Record<string, string>;
