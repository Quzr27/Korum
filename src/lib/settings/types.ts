// ── Settings types and constants ──

export type ThemeMode = "light" | "dark";
export type BaseColor = "neutral" | "zinc" | "stone" | "mauve" | "olive";
export type TerminalFont = "JetBrains Mono" | "IBM Plex Mono" | "Source Code Pro";
export type TerminalTheme = "arcadia-midnight" | "tomorrow-night" | "tomorrow-night-eighties" | "oceanic-next" | "one-dark" | "gruvbox-soft" | "gruvbox-medium" | "harmonic-dark" | "materia" | "monokai" | "ocean" | "seti" | "solarized-dark" | "spacemacs" | "atelier-forest" | "afterglow" | "argonaut" | "cobalt2" | "dimmed-monokai" | "dracula" | "duotone-dark" | "spacegray-eighties" | "papercolor-light" | "tomorrow-light" | "one-half-light";
export type CanvasAtmosphere = "plain" | "studio" | "aurora" | "mist" | "nocturne";
export type CodeTheme = "github-dark" | "github-light" | "dracula" | "one-dark-pro" | "nord" | "catppuccin-mocha" | "catppuccin-latte" | "solarized-dark" | "tokyo-night" | "rose-pine" | "monokai" | "vitesse-dark" | "ayu-dark" | "min-dark" | "andromeeda" | "dark-plus";
export type RadiusPreset = 0 | 0.3 | 0.5 | 0.625 | 0.75 | 1;
export type ZoomSpeed = 0.5 | 1 | 1.5 | 2 | 3;

export interface Settings {
  theme: ThemeMode;
  baseColor: BaseColor;
  radius: RadiusPreset;
  terminalFont: TerminalFont;
  terminalFontSize: number;
  terminalTheme: TerminalTheme;
  codeTheme: CodeTheme;
  canvasAtmosphere: CanvasAtmosphere;
  zoomSpeed: ZoomSpeed;
  showUsageLimits: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  baseColor: "neutral",
  radius: 0.625,
  terminalFont: "IBM Plex Mono",
  terminalFontSize: 14,
  terminalTheme: "arcadia-midnight",
  codeTheme: "github-dark",
  canvasAtmosphere: "studio",
  zoomSpeed: 1,
  showUsageLimits: true,
};

export const CODE_THEMES: readonly CodeTheme[] = [
  "github-dark", "github-light", "dracula", "one-dark-pro", "nord",
  "catppuccin-mocha", "catppuccin-latte", "solarized-dark", "tokyo-night",
  "rose-pine", "monokai", "vitesse-dark", "ayu-dark", "min-dark",
  "andromeeda", "dark-plus",
];

export const CODE_THEME_LABELS: Record<CodeTheme, string> = {
  "github-dark": "GitHub Dark",
  "github-light": "GitHub Light",
  "dracula": "Dracula",
  "one-dark-pro": "One Dark Pro",
  "nord": "Nord",
  "catppuccin-mocha": "Catppuccin Mocha",
  "catppuccin-latte": "Catppuccin Latte",
  "solarized-dark": "Solarized Dark",
  "tokyo-night": "Tokyo Night",
  "rose-pine": "Rosé Pine",
  "monokai": "Monokai",
  "vitesse-dark": "Vitesse Dark",
  "ayu-dark": "Ayu Dark",
  "min-dark": "Min Dark",
  "andromeeda": "Andromeeda",
  "dark-plus": "Dark+",
};

export const CODE_THEME_BG: Record<CodeTheme, string> = {
  "github-dark": "#24292e",
  "github-light": "#ffffff",
  "dracula": "#282A36",
  "one-dark-pro": "#282c34",
  "nord": "#2e3440",
  "catppuccin-mocha": "#1e1e2e",
  "catppuccin-latte": "#eff1f5",
  "solarized-dark": "#002B36",
  "tokyo-night": "#1a1b26",
  "rose-pine": "#191724",
  "monokai": "#272822",
  "vitesse-dark": "#121212",
  "ayu-dark": "#0d1017",
  "min-dark": "#1f1f1f",
  "andromeeda": "#23262E",
  "dark-plus": "#1E1E1E",
};

export const ZOOM_SPEED_OPTIONS: readonly ZoomSpeed[] = [0.5, 1, 1.5, 2, 3];

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

export const CANVAS_ATMOSPHERES: readonly CanvasAtmosphere[] = Object.keys(
  CANVAS_ATMOSPHERE_LABELS,
) as CanvasAtmosphere[];

export const RADIUS_PRESETS: readonly RadiusPreset[] = [0, 0.3, 0.5, 0.625, 0.75, 1];

export type CssVarMap = Record<string, string>;
