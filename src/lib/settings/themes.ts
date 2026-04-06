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
      background: "#fbfbfa", foreground: "#161616", card: "#ffffff",
      primary: "#26292d", primaryForeground: "#fbfbfa", secondary: "#f2f2ef",
      muted: "#efefeb", mutedForeground: "#6f6a60", accent: "#ece8df", accentForeground: "#1f1c18",
      border: "#dfddd7", ring: "#878178", sidebar: "#f6f4ee",
      sidebarPrimary: "#2e65cc", sidebarPrimaryForeground: "#f6f8ff",
      sidebarAccent: "#ece8df", sidebarAccentForeground: "#1f1c18",
      chart: ["#7d8aff", "#6db9d8", "#8ea55d", "#d5a35d", "#c07a6d"],
    },
    dark: {
      background: "#0d0e10", foreground: "#efeee8", card: "#17181c",
      primary: "#edf0f4", primaryForeground: "#17181c", secondary: "#1d1f24",
      muted: "#1b1d20", mutedForeground: "#8e8a80", accent: "#25282d", accentForeground: "#f5f6f8",
      border: "#2c2f35", ring: "#7b8694", sidebar: "#141619",
      sidebarPrimary: "#5e92ff", sidebarPrimaryForeground: "#f3f7ff",
      sidebarAccent: "#202329", sidebarAccentForeground: "#edf0f4",
      chart: ["#86a7ff", "#7dc7e8", "#86b784", "#e0b768", "#d3878a"],
    },
  },
  zinc: {
    light: {
      background: "#f7f9fc", foreground: "#162031", card: "#ffffff",
      primary: "#2d6cdf", primaryForeground: "#f5f9ff", secondary: "#edf2f8",
      muted: "#e9eef6", mutedForeground: "#5e6b7c", accent: "#dde9fb", accentForeground: "#173262",
      border: "#d4ddeb", ring: "#7197e4", sidebar: "#eef4fc",
      sidebarPrimary: "#2d6cdf", sidebarPrimaryForeground: "#f5f9ff",
      sidebarAccent: "#dbe7fa", sidebarAccentForeground: "#173262",
      chart: ["#2d6cdf", "#5ba8d8", "#54b28c", "#d8a55d", "#8a77d5"],
    },
    dark: {
      background: "#0c1320", foreground: "#e6edf8", card: "#121b2a",
      primary: "#7cb1ff", primaryForeground: "#0d1a2f", secondary: "#182233",
      muted: "#151e2e", mutedForeground: "#95a5bb", accent: "#1a2b49", accentForeground: "#eef5ff",
      border: "#23324d", ring: "#5f91dc", sidebar: "#0f1726",
      sidebarPrimary: "#7cb1ff", sidebarPrimaryForeground: "#0d1a2f",
      sidebarAccent: "#16253f", sidebarAccentForeground: "#eaf1fe",
      chart: ["#7cb1ff", "#72c7ff", "#65d5b0", "#f0be72", "#a68bff"],
    },
  },
  stone: {
    light: {
      background: "#fdf9f3", foreground: "#2d1e12", card: "#fffefd",
      primary: "#c7802d", primaryForeground: "#fffaf4", secondary: "#f7ecdd",
      muted: "#f2e6d7", mutedForeground: "#7d6144", accent: "#f7ddbc", accentForeground: "#5a340f",
      border: "#ebd5bb", ring: "#d99b4d", sidebar: "#fbf1e4",
      sidebarPrimary: "#c7802d", sidebarPrimaryForeground: "#fffaf4",
      sidebarAccent: "#f5d9b1", sidebarAccentForeground: "#5a340f",
      chart: ["#c7802d", "#e1af63", "#88aa71", "#b36ad6", "#d06d64"],
    },
    dark: {
      background: "#15100c", foreground: "#f5ebdf", card: "#1f1712",
      primary: "#f0b768", primaryForeground: "#2c1a0b", secondary: "#2a1f18",
      muted: "#241b15", mutedForeground: "#b89a7a", accent: "#3b2616", accentForeground: "#ffe7c7",
      border: "#493021", ring: "#e2a657", sidebar: "#18110d",
      sidebarPrimary: "#f0b768", sidebarPrimaryForeground: "#2c1a0b",
      sidebarAccent: "#2d1e12", sidebarAccentForeground: "#f8ead8",
      chart: ["#f0b768", "#f7ca86", "#9ecb8d", "#cb93ff", "#e58f7b"],
    },
  },
  mauve: {
    light: {
      background: "#faf7fd", foreground: "#24162f", card: "#ffffff",
      primary: "#8f56d8", primaryForeground: "#fbf8ff", secondary: "#f2eafb",
      muted: "#eee5f8", mutedForeground: "#756187", accent: "#e6d7fb", accentForeground: "#3c1e67",
      border: "#dfd0f4", ring: "#ad7aeb", sidebar: "#f5effc",
      sidebarPrimary: "#8f56d8", sidebarPrimaryForeground: "#fbf8ff",
      sidebarAccent: "#e3d4fa", sidebarAccentForeground: "#3c1e67",
      chart: ["#8f56d8", "#6c87ff", "#4bb2b0", "#d9a95e", "#da718d"],
    },
    dark: {
      background: "#130f18", foreground: "#f0e8f8", card: "#1d1525",
      primary: "#c48cff", primaryForeground: "#261338", secondary: "#261d30",
      muted: "#21192b", mutedForeground: "#aa98bb", accent: "#312044", accentForeground: "#f6eeff",
      border: "#432f57", ring: "#b783ef", sidebar: "#17111f",
      sidebarPrimary: "#c48cff", sidebarPrimaryForeground: "#261338",
      sidebarAccent: "#2a1d38", sidebarAccentForeground: "#f5ebff",
      chart: ["#c48cff", "#7ea7ff", "#6cd0c7", "#efc06f", "#ee8ca4"],
    },
  },
  olive: {
    light: {
      background: "#f5fcf8", foreground: "#12261e", card: "#ffffff",
      primary: "#1f9b70", primaryForeground: "#f4fffb", secondary: "#e6f4ec",
      muted: "#e3f0e9", mutedForeground: "#557567", accent: "#cfeee1", accentForeground: "#114f39",
      border: "#c8e5d7", ring: "#48b78a", sidebar: "#edf9f3",
      sidebarPrimary: "#1f9b70", sidebarPrimaryForeground: "#f4fffb",
      sidebarAccent: "#cbeadb", sidebarAccentForeground: "#114f39",
      chart: ["#1f9b70", "#52b5d3", "#80b86e", "#d7a45b", "#9572df"],
    },
    dark: {
      background: "#0b1511", foreground: "#e6f7ef", card: "#11201a",
      primary: "#57d3a4", primaryForeground: "#0e281d", secondary: "#162a22",
      muted: "#14241d", mutedForeground: "#94b7a7", accent: "#183528", accentForeground: "#eafff6",
      border: "#244638", ring: "#39b384", sidebar: "#0e1914",
      sidebarPrimary: "#57d3a4", sidebarPrimaryForeground: "#0e281d",
      sidebarAccent: "#143023", sidebarAccentForeground: "#e9fff5",
      chart: ["#57d3a4", "#74d2ef", "#9fd882", "#f0b76d", "#b08fff"],
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
