// ── Terminal fonts, themes, and xterm color definitions ──

import type { TerminalFont, TerminalTheme } from "./types";
import { DEFAULT_SETTINGS } from "./types";

export const TERMINAL_FONTS: TerminalFont[] = ["JetBrains Mono", "IBM Plex Mono", "Source Code Pro"];

export const TERMINAL_FONT_FAMILIES: Record<TerminalFont, string> = {
  "JetBrains Mono": "'JetBrains Mono', 'IBM Plex Mono', Menlo, Monaco, 'Courier New', monospace",
  "IBM Plex Mono": "'IBM Plex Mono', 'JetBrains Mono', Menlo, Monaco, 'Courier New', monospace",
  "Source Code Pro": "'Source Code Pro', 'JetBrains Mono', Menlo, Monaco, 'Courier New', monospace",
};

export const TERMINAL_FONT_LOAD_TARGETS: Record<TerminalFont, string> = {
  "JetBrains Mono": "'JetBrains Mono'",
  "IBM Plex Mono": "'IBM Plex Mono'",
  "Source Code Pro": "'Source Code Pro'",
};

const LEGACY_TERMINAL_FONT_MIGRATIONS: Record<string, TerminalFont> = {
  "Menlo": "JetBrains Mono",
  "Fira Code": "JetBrains Mono",
  "SF Mono": "JetBrains Mono",
  "System Mono": "JetBrains Mono",
  "Iosevka": "Source Code Pro",
  "Inconsolata": "Source Code Pro",
};

export function normalizeTerminalFont(value: unknown): TerminalFont {
  if (typeof value === "string") {
    if ((TERMINAL_FONTS as readonly string[]).includes(value)) {
      return value as TerminalFont;
    }
    const migrated = LEGACY_TERMINAL_FONT_MIGRATIONS[value];
    if (migrated) return migrated;
  }
  return DEFAULT_SETTINGS.terminalFont;
}

export const TERMINAL_THEME_LABELS: Record<TerminalTheme, string> = {
  "arcadia-midnight": "Arcadia Midnight",
  "tomorrow-night": "Tomorrow Night",
  "tomorrow-night-eighties": "Tomorrow Night Eighties",
  "oceanic-next": "Oceanic Next",
  "one-dark": "One Dark",
  "gruvbox-soft": "Gruvbox Soft",
  "gruvbox-medium": "Gruvbox Medium",
  "harmonic-dark": "Harmonic Dark",
  "materia": "Materia",
  "monokai": "Monokai",
  "ocean": "Ocean",
  "seti": "Seti",
  "solarized-dark": "Solarized Dark",
  "spacemacs": "Spacemacs",
  "atelier-forest": "Atelier Forest",
  "afterglow": "Afterglow",
  "argonaut": "Argonaut",
  "cobalt2": "Cobalt2",
  "dimmed-monokai": "Dimmed Monokai",
  "dracula": "Dracula",
  "duotone-dark": "Duotone Dark",
  "spacegray-eighties": "Spacegray Eighties",
  "papercolor-light": "PaperColor Light",
  "tomorrow-light": "Tomorrow Light",
  "one-half-light": "One Half Light",
};

export const TERMINAL_THEMES: TerminalTheme[] = Object.keys(TERMINAL_THEME_LABELS) as TerminalTheme[];

export const LEGACY_TERMINAL_THEME_MIGRATIONS: Record<string, TerminalTheme> = {
  "default": "oceanic-next",
  "nord": "ocean",
  "gruvbox-dark": "gruvbox-medium",
  "tokyo-night": "oceanic-next",
  "catppuccin-mocha": "duotone-dark",
  "github-dark": "one-dark",
  "kanagawa": "atelier-forest",
  "rose-pine": "duotone-dark",
  "everforest": "atelier-forest",
  "ayu-dark": "argonaut",
  "material": "materia",
  "github-light": "one-half-light",
  "solarized-light": "papercolor-light",
  "catppuccin-latte": "one-half-light",
  "one-light": "one-half-light",
};

export function normalizeTerminalTheme(value: unknown): TerminalTheme {
  if (typeof value === "string") {
    if ((TERMINAL_THEMES as readonly string[]).includes(value)) {
      return value as TerminalTheme;
    }
    const migrated = LEGACY_TERMINAL_THEME_MIGRATIONS[value];
    if (migrated) return migrated;
  }
  return DEFAULT_SETTINGS.terminalTheme;
}

// ── xterm ANSI color palettes ──

interface XtermTheme {
  background: string; foreground: string; cursor: string;
  black: string; red: string; green: string; yellow: string;
  blue: string; magenta: string; cyan: string; white: string;
  brightBlack: string; brightRed: string; brightGreen: string; brightYellow: string;
  brightBlue: string; brightMagenta: string; brightCyan: string; brightWhite: string;
}

export const XTERM_THEMES: Record<TerminalTheme, XtermTheme> = {
  "arcadia-midnight": {
    background: "#121212", foreground: "#e4e4e4", cursor: "#e4e4e4",
    black: "#121212", red: "#af005f", green: "#1c5f5f", yellow: "#af871c",
    blue: "#1c5f87", magenta: "#5f1c5f", cyan: "#005f87", white: "#afafaf",
    brightBlack: "#585858", brightRed: "#af5f87", brightGreen: "#008787", brightYellow: "#dfaf00",
    brightBlue: "#5f87af", brightMagenta: "#875f87", brightCyan: "#0087af", brightWhite: "#e4e4e4",
  },
  "tomorrow-night": {
    background: "#1d1f21", foreground: "#c5c8c6", cursor: "#aeafad",
    black: "#000000", red: "#cc6666", green: "#b5bd68", yellow: "#de935f",
    blue: "#81a2be", magenta: "#b294bb", cyan: "#8abeb7", white: "#373b41",
    brightBlack: "#666666", brightRed: "#ff3334", brightGreen: "#9ec400", brightYellow: "#f0c674",
    brightBlue: "#81a2be", brightMagenta: "#b777e0", brightCyan: "#54ced6", brightWhite: "#282a2e",
  },
  "tomorrow-night-eighties": {
    background: "#2d2d2d", foreground: "#cccccc", cursor: "#aeafad",
    black: "#000000", red: "#f2777a", green: "#99cc99", yellow: "#f99157",
    blue: "#6699cc", magenta: "#cc99cc", cyan: "#66cccc", white: "#515151",
    brightBlack: "#666666", brightRed: "#ff3334", brightGreen: "#9ec400", brightYellow: "#ffcc66",
    brightBlue: "#6699cc", brightMagenta: "#b777e0", brightCyan: "#54ced6", brightWhite: "#393939",
  },
  "oceanic-next": {
    background: "#1b2b34", foreground: "#c0c5ce", cursor: "#c0c5ce",
    black: "#1b2b34", red: "#ec5f67", green: "#99c794", yellow: "#fac863",
    blue: "#6699cc", magenta: "#c594c5", cyan: "#5fb3b3", white: "#c0c5ce",
    brightBlack: "#65737e", brightRed: "#f99157", brightGreen: "#343d46", brightYellow: "#4f5b66",
    brightBlue: "#a7adba", brightMagenta: "#cdd3de", brightCyan: "#ab7967", brightWhite: "#d8dee9",
  },
  "one-dark": {
    background: "#282c34", foreground: "#abb2bf", cursor: "#abb2bf",
    black: "#282c34", red: "#e06c75", green: "#98c379", yellow: "#e5c07b",
    blue: "#61afef", magenta: "#c678dd", cyan: "#56b6c2", white: "#abb2bf",
    brightBlack: "#545862", brightRed: "#d19a66", brightGreen: "#353b45", brightYellow: "#3e4451",
    brightBlue: "#565c64", brightMagenta: "#b6bdca", brightCyan: "#be5046", brightWhite: "#c8ccd4",
  },
  "gruvbox-soft": {
    background: "#32302f", foreground: "#d5c4a1", cursor: "#d5c4a1",
    black: "#32302f", red: "#fb4934", green: "#b8bb26", yellow: "#fabd2f",
    blue: "#83a598", magenta: "#d3869b", cyan: "#8ec07c", white: "#d5c4a1",
    brightBlack: "#665c54", brightRed: "#fe8019", brightGreen: "#3c3836", brightYellow: "#504945",
    brightBlue: "#bdae93", brightMagenta: "#ebdbb2", brightCyan: "#d65d0e", brightWhite: "#fbf1c7",
  },
  "gruvbox-medium": {
    background: "#282828", foreground: "#d5c4a1", cursor: "#d5c4a1",
    black: "#282828", red: "#fb4934", green: "#b8bb26", yellow: "#fabd2f",
    blue: "#83a598", magenta: "#d3869b", cyan: "#8ec07c", white: "#d5c4a1",
    brightBlack: "#665c54", brightRed: "#fe8019", brightGreen: "#3c3836", brightYellow: "#504945",
    brightBlue: "#bdae93", brightMagenta: "#ebdbb2", brightCyan: "#d65d0e", brightWhite: "#fbf1c7",
  },
  "harmonic-dark": {
    background: "#0b1c2c", foreground: "#cbd6e2", cursor: "#cbd6e2",
    black: "#0b1c2c", red: "#bf8b56", green: "#56bf8b", yellow: "#8bbf56",
    blue: "#8b56bf", magenta: "#bf568b", cyan: "#568bbf", white: "#cbd6e2",
    brightBlack: "#627e99", brightRed: "#bfbf56", brightGreen: "#223b54", brightYellow: "#405c79",
    brightBlue: "#aabcce", brightMagenta: "#e5ebf1", brightCyan: "#bf5656", brightWhite: "#f7f9fb",
  },
  materia: {
    background: "#263238", foreground: "#cdd3de", cursor: "#cdd3de",
    black: "#263238", red: "#ec5f67", green: "#8bd649", yellow: "#ffcc00",
    blue: "#89ddff", magenta: "#82aaff", cyan: "#80cbc4", white: "#cdd3de",
    brightBlack: "#707880", brightRed: "#ea9560", brightGreen: "#2c393f", brightYellow: "#37474f",
    brightBlue: "#c9ccd3", brightMagenta: "#d5dbe5", brightCyan: "#ec5f67", brightWhite: "#ffffff",
  },
  monokai: {
    background: "#272822", foreground: "#f8f8f2", cursor: "#f8f8f0",
    black: "#272822", red: "#f92672", green: "#a6e22e", yellow: "#f4bf75",
    blue: "#66d9ef", magenta: "#ae81ff", cyan: "#a1efe4", white: "#f8f8f2",
    brightBlack: "#75715e", brightRed: "#f92672", brightGreen: "#a6e22e", brightYellow: "#f4bf75",
    brightBlue: "#66d9ef", brightMagenta: "#ae81ff", brightCyan: "#a1efe4", brightWhite: "#f9f8f5",
  },
  ocean: {
    background: "#2b303b", foreground: "#c0c5ce", cursor: "#c0c5ce",
    black: "#2b303b", red: "#bf616a", green: "#a3be8c", yellow: "#ebcb8b",
    blue: "#8fa1b3", magenta: "#b48ead", cyan: "#96b5b4", white: "#c0c5ce",
    brightBlack: "#65737e", brightRed: "#d08770", brightGreen: "#343d46", brightYellow: "#4f5b66",
    brightBlue: "#a7adba", brightMagenta: "#dfe1e8", brightCyan: "#ab7967", brightWhite: "#eff1f5",
  },
  seti: {
    background: "#151718", foreground: "#d6d6d6", cursor: "#d6d6d6",
    black: "#151718", red: "#cd3f45", green: "#9fca56", yellow: "#e6cd69",
    blue: "#55b5db", magenta: "#a074c4", cyan: "#55dbbe", white: "#d6d6d6",
    brightBlack: "#41535b", brightRed: "#db7b55", brightGreen: "#8ec43d", brightYellow: "#3b758c",
    brightBlue: "#43a5d5", brightMagenta: "#eeeeee", brightCyan: "#8a553f", brightWhite: "#ffffff",
  },
  "solarized-dark": {
    background: "#002b36", foreground: "#93a1a1", cursor: "#93a1a1",
    black: "#002b36", red: "#dc322f", green: "#859900", yellow: "#b58900",
    blue: "#268bd2", magenta: "#6c71c4", cyan: "#2aa198", white: "#93a1a1",
    brightBlack: "#657b83", brightRed: "#cb4b16", brightGreen: "#073642", brightYellow: "#586e75",
    brightBlue: "#839496", brightMagenta: "#eee8d5", brightCyan: "#d33682", brightWhite: "#fdf6e3",
  },
  spacemacs: {
    background: "#1f2022", foreground: "#a3a3a3", cursor: "#a3a3a3",
    black: "#1f2022", red: "#f2241f", green: "#67b11d", yellow: "#b1951d",
    blue: "#4f97d7", magenta: "#a31db1", cyan: "#2d9574", white: "#a3a3a3",
    brightBlack: "#585858", brightRed: "#ffa500", brightGreen: "#282828", brightYellow: "#444155",
    brightBlue: "#b8b8b8", brightMagenta: "#e8e8e8", brightCyan: "#b03060", brightWhite: "#f8f8f8",
  },
  "atelier-forest": {
    background: "#1b1918", foreground: "#a8a19f", cursor: "#a8a19f",
    black: "#1b1918", red: "#f22c40", green: "#7b9726", yellow: "#c38418",
    blue: "#407ee7", magenta: "#6666ea", cyan: "#3d97b8", white: "#a8a19f",
    brightBlack: "#766e6b", brightRed: "#df5320", brightGreen: "#2c2421", brightYellow: "#68615e",
    brightBlue: "#9c9491", brightMagenta: "#e6e2e0", brightCyan: "#c33ff3", brightWhite: "#f1efee",
  },
  afterglow: {
    background: "#212121", foreground: "#d0d0d0", cursor: "#d0d0d0",
    black: "#151515", red: "#ac4142", green: "#7e8e50", yellow: "#e5b567",
    blue: "#6c99bb", magenta: "#9f4e85", cyan: "#7dd6cf", white: "#d0d0d0",
    brightBlack: "#505050", brightRed: "#ac4142", brightGreen: "#7e8e50", brightYellow: "#e5b567",
    brightBlue: "#6c99bb", brightMagenta: "#9f4e85", brightCyan: "#7dd6cf", brightWhite: "#f5f5f5",
  },
  argonaut: {
    background: "#0e1019", foreground: "#fffaf4", cursor: "#ff0018",
    black: "#232323", red: "#ff000f", green: "#8ce10b", yellow: "#ffb900",
    blue: "#008df8", magenta: "#6d43a6", cyan: "#00d8eb", white: "#ffffff",
    brightBlack: "#444444", brightRed: "#ff2740", brightGreen: "#abe15b", brightYellow: "#ffd242",
    brightBlue: "#0092ff", brightMagenta: "#9a5feb", brightCyan: "#67fff0", brightWhite: "#ffffff",
  },
  cobalt2: {
    background: "#132738", foreground: "#ffffff", cursor: "#f0cc09",
    black: "#000000", red: "#ff0000", green: "#38de21", yellow: "#ffe50a",
    blue: "#1460d2", magenta: "#ff005d", cyan: "#00bbbb", white: "#bbbbbb",
    brightBlack: "#555555", brightRed: "#f40e17", brightGreen: "#3bd01d", brightYellow: "#edc809",
    brightBlue: "#5555ff", brightMagenta: "#ff55ff", brightCyan: "#6ae3fa", brightWhite: "#ffffff",
  },
  "dimmed-monokai": {
    background: "#1f1f1f", foreground: "#b9bcba", cursor: "#f83e19",
    black: "#3a3d43", red: "#be3f48", green: "#879a3b", yellow: "#c5a635",
    blue: "#4f76a1", magenta: "#855c8d", cyan: "#578fa4", white: "#b9bcba",
    brightBlack: "#888987", brightRed: "#fb001f", brightGreen: "#0f722f", brightYellow: "#c47033",
    brightBlue: "#186de3", brightMagenta: "#fb0067", brightCyan: "#2e706d", brightWhite: "#fdffb9",
  },
  dracula: {
    background: "#1e1f29", foreground: "#f8f8f2", cursor: "#bbbbbb",
    black: "#000000", red: "#ff5555", green: "#50fa7b", yellow: "#f1fa8c",
    blue: "#bd93f9", magenta: "#ff79c6", cyan: "#8be9fd", white: "#bbbbbb",
    brightBlack: "#555555", brightRed: "#ff5555", brightGreen: "#50fa7b", brightYellow: "#f1fa8c",
    brightBlue: "#bd93f9", brightMagenta: "#ff79c6", brightCyan: "#8be9fd", brightWhite: "#ffffff",
  },
  "duotone-dark": {
    background: "#1f1d27", foreground: "#b7a1ff", cursor: "#ff9839",
    black: "#1f1d27", red: "#d9393e", green: "#2dcd73", yellow: "#d9b76e",
    blue: "#ffc284", magenta: "#de8d40", cyan: "#2488ff", white: "#b7a1ff",
    brightBlack: "#353147", brightRed: "#d9393e", brightGreen: "#2dcd73", brightYellow: "#d9b76e",
    brightBlue: "#ffc284", brightMagenta: "#de8d40", brightCyan: "#2488ff", brightWhite: "#eae5ff",
  },
  "spacegray-eighties": {
    background: "#222222", foreground: "#bdbaae", cursor: "#bbbbbb",
    black: "#15171c", red: "#ec5f67", green: "#81a764", yellow: "#fec254",
    blue: "#5486c0", magenta: "#bf83c1", cyan: "#57c2c1", white: "#efece7",
    brightBlack: "#555555", brightRed: "#ff6973", brightGreen: "#93d493", brightYellow: "#ffd256",
    brightBlue: "#4d84d1", brightMagenta: "#ff55ff", brightCyan: "#83e9e4", brightWhite: "#ffffff",
  },
  "papercolor-light": {
    background: "#e7e8eb", foreground: "#4d4d4c", cursor: "#4d4d4c",
    black: "#ededed", red: "#d7005f", green: "#718c00", yellow: "#d75f00",
    blue: "#4271ae", magenta: "#8959a8", cyan: "#3e999f", white: "#f5f5f5",
    brightBlack: "#969694", brightRed: "#d7005f", brightGreen: "#718c00", brightYellow: "#d75f00",
    brightBlue: "#4271ae", brightMagenta: "#8959a8", brightCyan: "#3e999f", brightWhite: "#2d2d2c",
  },
  "tomorrow-light": {
    background: "#ffffff", foreground: "#4d4d4c", cursor: "#aeafad",
    black: "#000000", red: "#c82829", green: "#718c00", yellow: "#f5871f",
    blue: "#4271ae", magenta: "#8959a8", cyan: "#3e999f", white: "#d6d6d6",
    brightBlack: "#666666", brightRed: "#ff3334", brightGreen: "#9ec400", brightYellow: "#eab700",
    brightBlue: "#4271ae", brightMagenta: "#b777e0", brightCyan: "#54ced6", brightWhite: "#efefef",
  },
  "one-half-light": {
    background: "#fafafa", foreground: "#383a42", cursor: "#bfceff",
    black: "#383a42", red: "#e45649", green: "#50a14f", yellow: "#c18401",
    blue: "#0184bc", magenta: "#a626a4", cyan: "#0997b3", white: "#fafafa",
    brightBlack: "#4f525e", brightRed: "#e06c75", brightGreen: "#98c379", brightYellow: "#e5c07b",
    brightBlue: "#61afef", brightMagenta: "#c678dd", brightCyan: "#56b6c2", brightWhite: "#ffffff",
  },
};

export function getXtermTheme(termTheme: TerminalTheme): XtermTheme {
  return XTERM_THEMES[termTheme];
}
