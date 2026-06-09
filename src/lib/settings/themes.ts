// ── shadcn base color themes ──

import type { BaseColor, CssVarMap, ThemeMode } from "./types";

interface ThemeColors { light: CssVarMap; dark: CssVarMap; }

interface ThemeRecipe {
  background: string;
  foreground: string;
  card: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  border: string;
  ring: string;
  sidebar: string;
  sidebarPrimary: string;
  sidebarPrimaryForeground: string;
  sidebarAccent: string;
  sidebarAccentForeground: string;
  chart: [string, string, string, string, string];
}

function buildThemeColors(recipe: ThemeRecipe, mode: ThemeMode): CssVarMap {
  return {
    background: recipe.background,
    foreground: recipe.foreground,
    card: recipe.card,
    "card-foreground": recipe.foreground,
    popover: recipe.card,
    "popover-foreground": recipe.foreground,
    primary: recipe.primary,
    "primary-foreground": recipe.primaryForeground,
    secondary: recipe.secondary,
    "secondary-foreground": recipe.foreground,
    muted: recipe.muted,
    "muted-foreground": recipe.mutedForeground,
    accent: recipe.accent,
    "accent-foreground": recipe.accentForeground,
    destructive: mode === "dark" ? "oklch(0.704 0.191 22.216)" : "oklch(0.577 0.245 27.325)",
    border: recipe.border,
    input: recipe.border,
    ring: recipe.ring,
    "chart-1": recipe.chart[0],
    "chart-2": recipe.chart[1],
    "chart-3": recipe.chart[2],
    "chart-4": recipe.chart[3],
    "chart-5": recipe.chart[4],
    sidebar: recipe.sidebar,
    "sidebar-foreground": recipe.foreground,
    "sidebar-primary": recipe.sidebarPrimary,
    "sidebar-primary-foreground": recipe.sidebarPrimaryForeground,
    "sidebar-accent": recipe.sidebarAccent,
    "sidebar-accent-foreground": recipe.sidebarAccentForeground,
    "sidebar-border": recipe.border,
    "sidebar-ring": recipe.ring,
  };
}

const BASE_THEME_RECIPES: Record<BaseColor, { light: ThemeRecipe; dark: ThemeRecipe }> = {
  neutral: {
    light: {
      background: "#f8f8f7", foreground: "#17181a", card: "#ffffff",
      primary: "#24272b", primaryForeground: "#fbfbfa", secondary: "#f0f0ee",
      muted: "#ececea", mutedForeground: "#676a6f", accent: "#e7e8e6", accentForeground: "#202225",
      border: "#dcddd9", ring: "#7d838b", sidebar: "#f2f2ef",
      sidebarPrimary: "#5f666f", sidebarPrimaryForeground: "#fbfbfa",
      sidebarAccent: "#e7e8e6", sidebarAccentForeground: "#202225",
      chart: ["#69717b", "#83909d", "#879284", "#9e947f", "#94888a"],
    },
    dark: {
      background: "#0d0e10", foreground: "#efeee8", card: "#17181c",
      primary: "#edf0f4", primaryForeground: "#17181c", secondary: "#1d1f24",
      muted: "#1b1d20", mutedForeground: "#8e8a80", accent: "#25282d", accentForeground: "#f5f6f8",
      border: "#2c2f35", ring: "#7b8694", sidebar: "#141619",
      sidebarPrimary: "#c9ccd0", sidebarPrimaryForeground: "#17181c",
      sidebarAccent: "#202329", sidebarAccentForeground: "#edf0f4",
      chart: ["#c9ccd0", "#9ba6b2", "#91a28e", "#b6a07a", "#a98d8c"],
    },
  },
  zinc: {
    light: {
      background: "#f7f9fc", foreground: "#162031", card: "#ffffff",
      primary: "#53687f", primaryForeground: "#f5f9ff", secondary: "#edf2f8",
      muted: "#e9eef6", mutedForeground: "#627184", accent: "#dfe7f0", accentForeground: "#1e3348",
      border: "#d6dde7", ring: "#8498ae", sidebar: "#eef3f8",
      sidebarPrimary: "#53687f", sidebarPrimaryForeground: "#f5f9ff",
      sidebarAccent: "#dfe7f0", sidebarAccentForeground: "#1e3348",
      chart: ["#53687f", "#7890a5", "#82998d", "#a9967a", "#8f829f"],
    },
    dark: {
      background: "#0c1320", foreground: "#e6edf8", card: "#121b2a",
      primary: "#9aabbd", primaryForeground: "#101923", secondary: "#18212c",
      muted: "#151e28", mutedForeground: "#9aa8b6", accent: "#1c2a38", accentForeground: "#eef5ff",
      border: "#263443", ring: "#8092a5", sidebar: "#101821",
      sidebarPrimary: "#9aabbd", sidebarPrimaryForeground: "#101923",
      sidebarAccent: "#182635", sidebarAccentForeground: "#eaf1f8",
      chart: ["#9aabbd", "#829bad", "#86a096", "#b09c7e", "#a092b1"],
    },
  },
  stone: {
    light: {
      background: "#f7f7f5", foreground: "#1d2024", card: "#ffffff",
      primary: "#5d646c", primaryForeground: "#fbfbfa", secondary: "#eeeeeb",
      muted: "#e8e8e5", mutedForeground: "#686d72", accent: "#dedfdd", accentForeground: "#24272c",
      border: "#d7d8d4", ring: "#7d8288", sidebar: "#f0f0ed",
      sidebarPrimary: "#5d646c", sidebarPrimaryForeground: "#fbfbfa",
      sidebarAccent: "#e4e5e2", sidebarAccentForeground: "#24272c",
      chart: ["#5d646c", "#7a8188", "#8a9187", "#9b907e", "#918795"],
    },
    dark: {
      background: "#0f1114", foreground: "#eceeed", card: "#171a1f",
      primary: "#b6bbc1", primaryForeground: "#171a1f", secondary: "#1e2227",
      muted: "#1b1e23", mutedForeground: "#959a9f", accent: "#282c32", accentForeground: "#f2f3f4",
      border: "#30343b", ring: "#828891", sidebar: "#14171b",
      sidebarPrimary: "#b6bbc1", sidebarPrimaryForeground: "#171a1f",
      sidebarAccent: "#22262c", sidebarAccentForeground: "#eceeed",
      chart: ["#b6bbc1", "#8f989f", "#8f9d91", "#aaa07f", "#9f929f"],
    },
  },
  mauve: {
    light: {
      background: "#faf7fd", foreground: "#24162f", card: "#ffffff",
      primary: "#74608f", primaryForeground: "#fbf8ff", secondary: "#f1ecf6",
      muted: "#ece6f2", mutedForeground: "#75677f", accent: "#e3dcec", accentForeground: "#342746",
      border: "#d9d0e4", ring: "#9b8ab3", sidebar: "#f4eff8",
      sidebarPrimary: "#74608f", sidebarPrimaryForeground: "#fbf8ff",
      sidebarAccent: "#e2dbea", sidebarAccentForeground: "#342746",
      chart: ["#74608f", "#8290b2", "#7f9b98", "#a99a7a", "#a17f92"],
    },
    dark: {
      background: "#130f18", foreground: "#f0e8f8", card: "#1d1525",
      primary: "#b5a4d1", primaryForeground: "#21172c", secondary: "#241d2d",
      muted: "#201927", mutedForeground: "#a69ab3", accent: "#2d233b", accentForeground: "#f2ecf8",
      border: "#3b304a", ring: "#9b8bb3", sidebar: "#16111d",
      sidebarPrimary: "#b5a4d1", sidebarPrimaryForeground: "#21172c",
      sidebarAccent: "#261d32", sidebarAccentForeground: "#f2ecf8",
      chart: ["#b5a4d1", "#8c9bb7", "#86aaa5", "#b2a17e", "#b08da0"],
    },
  },
  olive: {
    light: {
      background: "#f5fcf8", foreground: "#12261e", card: "#ffffff",
      primary: "#5f7f70", primaryForeground: "#f4fffb", secondary: "#e9f1ec",
      muted: "#e4ede8", mutedForeground: "#60766b", accent: "#d9e7df", accentForeground: "#223b31",
      border: "#d2dfd7", ring: "#839f91", sidebar: "#eef5f1",
      sidebarPrimary: "#5f7f70", sidebarPrimaryForeground: "#f4fffb",
      sidebarAccent: "#dae8e0", sidebarAccentForeground: "#223b31",
      chart: ["#5f7f70", "#7f9d98", "#8da17d", "#aaa07c", "#9187a3"],
    },
    dark: {
      background: "#0b1511", foreground: "#e6f7ef", card: "#11201a",
      primary: "#9bb8a9", primaryForeground: "#112018", secondary: "#17231d",
      muted: "#152019", mutedForeground: "#96afa3", accent: "#1d2d25", accentForeground: "#edf8f2",
      border: "#2a3d33", ring: "#849f92", sidebar: "#101913",
      sidebarPrimary: "#9bb8a9", sidebarPrimaryForeground: "#112018",
      sidebarAccent: "#182920", sidebarAccentForeground: "#edf8f2",
      chart: ["#9bb8a9", "#83a19c", "#95ad86", "#b2a17d", "#a193b0"],
    },
  },
};

export const BASE_THEMES: Record<BaseColor, ThemeColors> = {
  neutral: { light: buildThemeColors(BASE_THEME_RECIPES.neutral.light, "light"), dark: buildThemeColors(BASE_THEME_RECIPES.neutral.dark, "dark") },
  zinc: { light: buildThemeColors(BASE_THEME_RECIPES.zinc.light, "light"), dark: buildThemeColors(BASE_THEME_RECIPES.zinc.dark, "dark") },
  stone: { light: buildThemeColors(BASE_THEME_RECIPES.stone.light, "light"), dark: buildThemeColors(BASE_THEME_RECIPES.stone.dark, "dark") },
  mauve: { light: buildThemeColors(BASE_THEME_RECIPES.mauve.light, "light"), dark: buildThemeColors(BASE_THEME_RECIPES.mauve.dark, "dark") },
  olive: { light: buildThemeColors(BASE_THEME_RECIPES.olive.light, "light"), dark: buildThemeColors(BASE_THEME_RECIPES.olive.dark, "dark") },
};
