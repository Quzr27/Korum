import { describe, it, expect, beforeEach } from "vitest";
import {
  validateSettings,
  parseSettings,
  DEFAULT_SETTINGS,
  TERMINAL_THEMES,
  loadSettingsFromLocalStorage,
  loadBootstrapSettings,
  hasLocalStorageSettings,
  clearLocalStorageSettings,
  saveBootstrapSettings,
} from ".";
import type { Settings } from ".";

// ── validateSettings ──

describe("validateSettings", () => {
  it("returns defaults for null input", () => {
    expect(validateSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it("returns defaults for undefined input", () => {
    expect(validateSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it("returns defaults for non-object input", () => {
    expect(validateSettings("string")).toEqual(DEFAULT_SETTINGS);
    expect(validateSettings(42)).toEqual(DEFAULT_SETTINGS);
    expect(validateSettings(true)).toEqual(DEFAULT_SETTINGS);
  });

  it("returns defaults for empty object", () => {
    expect(validateSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it("validates a fully correct settings object", () => {
    const input: Settings = {
      theme: "light",
      baseColor: "zinc",
      radius: 0.5,
      terminalFont: "IBM Plex Mono",
      terminalFontSize: 16,
      terminalTheme: "dracula",
      canvasAtmosphere: "aurora",
      zoomSpeed: 2,
      showUsageLimits: true,
    };
    expect(validateSettings(input)).toEqual(input);
  });

  it("falls back invalid fields to defaults while keeping valid ones", () => {
    const input = {
      theme: "light",
      baseColor: "INVALID",
      radius: 0.5,
      terminalFont: "IBM Plex Mono",
      terminalFontSize: 999, // out of range
      terminalTheme: "dracula",
      canvasAtmosphere: "mist",
      zoomSpeed: 2,
    };
    const result = validateSettings(input);
    expect(result.theme).toBe("light");
    expect(result.baseColor).toBe(DEFAULT_SETTINGS.baseColor); // fallback
    expect(result.radius).toBe(0.5);
    expect(result.terminalFontSize).toBe(DEFAULT_SETTINGS.terminalFontSize); // fallback
    expect(result.terminalTheme).toBe("dracula");
  });

  // ── Individual field validation ──

  it("validates theme field", () => {
    expect(validateSettings({ theme: "dark" }).theme).toBe("dark");
    expect(validateSettings({ theme: "light" }).theme).toBe("light");
    expect(validateSettings({ theme: "blue" }).theme).toBe(DEFAULT_SETTINGS.theme);
    expect(validateSettings({ theme: 42 }).theme).toBe(DEFAULT_SETTINGS.theme);
  });

  it("validates baseColor field", () => {
    for (const color of ["neutral", "zinc", "stone", "mauve", "olive"]) {
      expect(validateSettings({ baseColor: color }).baseColor).toBe(color);
    }
    expect(validateSettings({ baseColor: "red" }).baseColor).toBe(DEFAULT_SETTINGS.baseColor);
  });

  it("validates radius field", () => {
    for (const r of [0, 0.3, 0.5, 0.625, 0.75, 1]) {
      expect(validateSettings({ radius: r }).radius).toBe(r);
    }
    expect(validateSettings({ radius: 0.4 }).radius).toBe(DEFAULT_SETTINGS.radius);
    expect(validateSettings({ radius: "0.5" }).radius).toBe(DEFAULT_SETTINGS.radius);
  });

  it("validates terminalFont field", () => {
    expect(validateSettings({ terminalFont: "JetBrains Mono" }).terminalFont).toBe(
      "JetBrains Mono",
    );
    expect(validateSettings({ terminalFont: "IBM Plex Mono" }).terminalFont).toBe("IBM Plex Mono");
    expect(validateSettings({ terminalFont: "Source Code Pro" }).terminalFont).toBe(
      "Source Code Pro",
    );
    // Unknown font falls back to default
    expect(validateSettings({ terminalFont: "Comic Sans" }).terminalFont).toBe(
      DEFAULT_SETTINGS.terminalFont,
    );
  });

  it("migrates legacy terminal fonts", () => {
    expect(validateSettings({ terminalFont: "Menlo" }).terminalFont).toBe("JetBrains Mono");
    expect(validateSettings({ terminalFont: "Fira Code" }).terminalFont).toBe("JetBrains Mono");
    expect(validateSettings({ terminalFont: "Iosevka" }).terminalFont).toBe("Source Code Pro");
    expect(validateSettings({ terminalFont: "Inconsolata" }).terminalFont).toBe("Source Code Pro");
    expect(validateSettings({ terminalFont: "SF Mono" }).terminalFont).toBe("JetBrains Mono");
  });

  it("validates terminalFontSize range (10-20)", () => {
    expect(validateSettings({ terminalFontSize: 10 }).terminalFontSize).toBe(10);
    expect(validateSettings({ terminalFontSize: 20 }).terminalFontSize).toBe(20);
    expect(validateSettings({ terminalFontSize: 15 }).terminalFontSize).toBe(15);
    expect(validateSettings({ terminalFontSize: 9 }).terminalFontSize).toBe(
      DEFAULT_SETTINGS.terminalFontSize,
    );
    expect(validateSettings({ terminalFontSize: 21 }).terminalFontSize).toBe(
      DEFAULT_SETTINGS.terminalFontSize,
    );
    expect(validateSettings({ terminalFontSize: "14" }).terminalFontSize).toBe(
      DEFAULT_SETTINGS.terminalFontSize,
    );
  });

  it("validates terminalTheme field", () => {
    expect(validateSettings({ terminalTheme: "dracula" }).terminalTheme).toBe("dracula");
    expect(validateSettings({ terminalTheme: "oceanic-next" }).terminalTheme).toBe("oceanic-next");
    expect(validateSettings({ terminalTheme: "nonexistent" }).terminalTheme).toBe(
      DEFAULT_SETTINGS.terminalTheme,
    );
  });

  it("migrates legacy terminal themes", () => {
    expect(validateSettings({ terminalTheme: "nord" }).terminalTheme).toBe("ocean");
    expect(validateSettings({ terminalTheme: "tokyo-night" }).terminalTheme).toBe("oceanic-next");
    expect(validateSettings({ terminalTheme: "github-light" }).terminalTheme).toBe("one-half-light");
  });

  it("validates all 25 terminal themes round-trip", () => {
    for (const theme of TERMINAL_THEMES) {
      const result = validateSettings({ terminalTheme: theme });
      expect(result.terminalTheme).toBe(theme);
    }
    expect(TERMINAL_THEMES).toHaveLength(25);
  });

  it("validates zoomSpeed field", () => {
    for (const speed of [0.5, 1, 1.5, 2, 3]) {
      expect(validateSettings({ zoomSpeed: speed }).zoomSpeed).toBe(speed);
    }
    expect(validateSettings({ zoomSpeed: 4 }).zoomSpeed).toBe(DEFAULT_SETTINGS.zoomSpeed);
    expect(validateSettings({ zoomSpeed: "1" }).zoomSpeed).toBe(DEFAULT_SETTINGS.zoomSpeed);
  });

  it("validates canvasAtmosphere field", () => {
    for (const atmosphere of ["plain", "studio", "aurora", "mist", "nocturne"]) {
      expect(validateSettings({ canvasAtmosphere: atmosphere }).canvasAtmosphere).toBe(atmosphere);
    }
    expect(validateSettings({ canvasAtmosphere: "sunset" }).canvasAtmosphere).toBe(
      DEFAULT_SETTINGS.canvasAtmosphere,
    );
  });
});

// ── parseSettings ──

describe("parseSettings", () => {
  it("reports fully valid for a complete correct object", () => {
    const input: Settings = {
      theme: "dark",
      baseColor: "neutral",
      radius: 0.625,
      terminalFont: "JetBrains Mono",
      terminalFontSize: 13,
      terminalTheme: "oceanic-next",
      canvasAtmosphere: "studio",
      zoomSpeed: 1,
      showUsageLimits: true,
    };
    const { settings, isFullyValid } = parseSettings(input);
    expect(isFullyValid).toBe(true);
    expect(settings).toEqual(input);
  });

  it("reports not fully valid for null", () => {
    const { isFullyValid } = parseSettings(null);
    expect(isFullyValid).toBe(false);
  });

  it("reports not fully valid when one field is bad", () => {
    const input = {
      theme: "dark",
      baseColor: "INVALID",
      radius: 0.625,
      terminalFont: "JetBrains Mono",
      terminalFontSize: 13,
      terminalTheme: "oceanic-next",
      canvasAtmosphere: "studio",
      zoomSpeed: 1,
    };
    const { settings, isFullyValid } = parseSettings(input);
    expect(isFullyValid).toBe(false);
    expect(settings.baseColor).toBe(DEFAULT_SETTINGS.baseColor);
    expect(settings.theme).toBe("dark"); // valid field preserved
  });

  it("treats missing canvasAtmosphere as fully valid (backward compat)", () => {
    const input = {
      theme: "dark",
      baseColor: "neutral",
      radius: 0.625,
      terminalFont: "JetBrains Mono",
      terminalFontSize: 13,
      terminalTheme: "oceanic-next",
      // canvasAtmosphere omitted — existing settings files won't have it
      zoomSpeed: 1,
    };
    const { settings, isFullyValid } = parseSettings(input);
    expect(isFullyValid).toBe(true);
    expect(settings.canvasAtmosphere).toBe(DEFAULT_SETTINGS.canvasAtmosphere);
  });

  it("reports not fully valid when terminalFont is missing", () => {
    const input = {
      theme: "dark",
      baseColor: "neutral",
      radius: 0.625,
      // terminalFont omitted
      terminalFontSize: 13,
      terminalTheme: "oceanic-next",
      canvasAtmosphere: "studio",
      zoomSpeed: 1,
    };
    const { isFullyValid } = parseSettings(input);
    expect(isFullyValid).toBe(false);
  });

  it("reports not fully valid for legacy terminal font", () => {
    const input = {
      theme: "dark",
      baseColor: "neutral",
      radius: 0.625,
      terminalFont: "Menlo", // legacy font that gets migrated
      terminalFontSize: 13,
      terminalTheme: "oceanic-next",
      canvasAtmosphere: "studio",
      zoomSpeed: 1,
    };
    const { settings, isFullyValid } = parseSettings(input);
    expect(isFullyValid).toBe(false);
    expect(settings.terminalFont).toBe("JetBrains Mono"); // migrated correctly
  });

  it("reports fully valid for legacy terminal themes that are migrated", () => {
    const input = {
      theme: "dark",
      baseColor: "neutral",
      radius: 0.625,
      terminalFont: "JetBrains Mono",
      terminalFontSize: 13,
      terminalTheme: "nord",
      canvasAtmosphere: "studio",
      zoomSpeed: 1,
    };
    const { settings, isFullyValid } = parseSettings(input);
    expect(isFullyValid).toBe(true);
    expect(settings.terminalTheme).toBe("ocean");
  });

  it("settings round-trip through JSON serialization", () => {
    const input: Settings = {
      theme: "light",
      baseColor: "stone",
      radius: 0.75,
      terminalFont: "Source Code Pro",
      terminalFontSize: 18,
      terminalTheme: "dracula",
      canvasAtmosphere: "nocturne",
      zoomSpeed: 1.5,
      showUsageLimits: true,
    };
    const json = JSON.stringify(input);
    const parsed = JSON.parse(json);
    const { settings, isFullyValid } = parseSettings(parsed);
    expect(isFullyValid).toBe(true);
    expect(settings).toEqual(input);
  });
});

// ── localStorage functions ──

describe("localStorage settings", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("loadSettingsFromLocalStorage returns defaults when empty", () => {
    expect(loadSettingsFromLocalStorage()).toEqual(DEFAULT_SETTINGS);
  });

  it("loadSettingsFromLocalStorage parses stored settings", () => {
    const stored: Settings = { ...DEFAULT_SETTINGS, theme: "light", baseColor: "zinc" };
    localStorage.setItem("korum-settings", JSON.stringify(stored));
    const loaded = loadSettingsFromLocalStorage();
    expect(loaded.theme).toBe("light");
    expect(loaded.baseColor).toBe("zinc");
  });

  it("loadSettingsFromLocalStorage returns defaults for corrupt JSON", () => {
    localStorage.setItem("korum-settings", "NOT JSON{{{");
    expect(loadSettingsFromLocalStorage()).toEqual(DEFAULT_SETTINGS);
  });

  it("hasLocalStorageSettings detects presence", () => {
    expect(hasLocalStorageSettings()).toBe(false);
    localStorage.setItem("korum-settings", "{}");
    expect(hasLocalStorageSettings()).toBe(true);
  });

  it("clearLocalStorageSettings removes the key", () => {
    localStorage.setItem("korum-settings", "{}");
    clearLocalStorageSettings();
    expect(hasLocalStorageSettings()).toBe(false);
  });

  it("clearLocalStorageSettings preserves bootstrap key", () => {
    localStorage.setItem("korum-settings", "{}");
    localStorage.setItem("korum-settings-bootstrap", JSON.stringify(DEFAULT_SETTINGS));
    clearLocalStorageSettings();
    expect(hasLocalStorageSettings()).toBe(false);
    expect(localStorage.getItem("korum-settings-bootstrap")).not.toBeNull();
  });

  it("saveBootstrapSettings + loadBootstrapSettings round-trip", () => {
    const settings: Settings = { ...DEFAULT_SETTINGS, theme: "light", radius: 1 };
    saveBootstrapSettings(settings);
    const loaded = loadBootstrapSettings();
    expect(loaded.theme).toBe("light");
    expect(loaded.radius).toBe(1);
  });

  it("loadBootstrapSettings falls back to legacy key", () => {
    const settings: Settings = { ...DEFAULT_SETTINGS, baseColor: "olive" };
    localStorage.setItem("korum-settings", JSON.stringify(settings));
    // No bootstrap key set — should fall back to legacy
    const loaded = loadBootstrapSettings();
    expect(loaded.baseColor).toBe("olive");
  });

  it("loadBootstrapSettings returns defaults when bootstrap key is corrupt", () => {
    // Corrupt bootstrap key — even with valid legacy key, bootstrap parse fails
    // and returns defaults. This is acceptable: bootstrap is only for flash prevention.
    localStorage.setItem("korum-settings-bootstrap", "CORRUPT{{{");
    localStorage.setItem(
      "korum-settings",
      JSON.stringify({ ...DEFAULT_SETTINGS, theme: "light" }),
    );
    const loaded = loadBootstrapSettings();
    expect(loaded).toEqual(DEFAULT_SETTINGS);
  });

  it("loadBootstrapSettings prefers bootstrap key over legacy", () => {
    localStorage.setItem(
      "korum-settings",
      JSON.stringify({ ...DEFAULT_SETTINGS, theme: "light" }),
    );
    localStorage.setItem(
      "korum-settings-bootstrap",
      JSON.stringify({ ...DEFAULT_SETTINGS, theme: "dark" }),
    );
    expect(loadBootstrapSettings().theme).toBe("dark");
  });
});
