import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as tauriCore from "@tauri-apps/api/core";
import { createRoot, type Root } from "react-dom/client";
import { DEFAULT_SETTINGS } from "./settings";
import { SettingsProvider, flushPendingSettingsSave, initializeSettings, useSettings } from "./settings-context";

const tauriCoreMock = tauriCore as typeof tauriCore & {
  __clearInvokeResults: () => void;
  __setInvokeResult: (command: string, result: unknown) => void;
};

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let latestContext: ReturnType<typeof useSettings> | null = null;
const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function CaptureSettingsContext() {
  latestContext = useSettings();
  return null;
}

async function flushReactWork() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderSettingsProvider() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });

  await act(async () => {
    root.render(
      <SettingsProvider>
        <CaptureSettingsContext />
      </SettingsProvider>,
    );
  });
  await flushReactWork();
}

beforeEach(() => {
  latestContext = null;
  localStorage.clear();
  tauriCoreMock.__clearInvokeResults();
  vi.restoreAllMocks();
});

afterEach(async () => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) break;
    await act(async () => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
  latestContext = null;
});

describe("initializeSettings", () => {
  it("prefers a fully valid Rust payload and clears legacy localStorage", async () => {
    const rustSettings = { ...DEFAULT_SETTINGS, theme: "light", baseColor: "zinc" } as const;
    localStorage.setItem("korum-settings", JSON.stringify({ ...DEFAULT_SETTINGS, theme: "dark" }));
    tauriCoreMock.__setInvokeResult("load_settings", rustSettings);

    const loaded = await initializeSettings();

    expect(loaded).toEqual(rustSettings);
    expect(localStorage.getItem("korum-settings")).toBeNull();
  });

  it("accepts migratable Rust terminal themes without falling back to localStorage", async () => {
    localStorage.setItem("korum-settings", JSON.stringify({ ...DEFAULT_SETTINGS, terminalTheme: "papercolor-light" }));
    tauriCoreMock.__setInvokeResult("load_settings", { ...DEFAULT_SETTINGS, terminalTheme: "nord" });

    const loaded = await initializeSettings();

    expect(loaded.terminalTheme).toBe("ocean");
    expect(localStorage.getItem("korum-settings")).toBeNull();
  });

  it("heals an invalid Rust payload from legacy localStorage when available", async () => {
    const invokeSpy = vi.spyOn(tauriCore, "invoke");
    const localSettings = { ...DEFAULT_SETTINGS, baseColor: "olive", terminalTheme: "ocean" } as const;
    localStorage.setItem("korum-settings", JSON.stringify(localSettings));
    tauriCoreMock.__setInvokeResult("load_settings", { theme: false });
    tauriCoreMock.__setInvokeResult("save_settings", undefined);

    const loaded = await initializeSettings();

    expect(loaded).toEqual(localSettings);
    expect(invokeSpy).toHaveBeenCalledWith("save_settings", { settings: localSettings });
  });

  it("falls back to localStorage when Rust load fails during migration", async () => {
    const invokeSpy = vi.spyOn(tauriCore, "invoke");
    const localSettings = { ...DEFAULT_SETTINGS, radius: 1, terminalFont: "IBM Plex Mono" } as const;
    localStorage.setItem("korum-settings", JSON.stringify(localSettings));
    tauriCoreMock.__setInvokeResult("save_settings", undefined);

    const loaded = await initializeSettings();

    expect(loaded).toEqual(localSettings);
    expect(invokeSpy).toHaveBeenCalledWith("save_settings", { settings: localSettings });
  });

  it("returns sanitized defaults when Rust settings are invalid and no legacy copy exists", async () => {
    tauriCoreMock.__setInvokeResult("load_settings", { theme: "banana", zoomSpeed: 99 });

    const loaded = await initializeSettings();

    expect(loaded).toEqual(DEFAULT_SETTINGS);
  });

  it("returns defaults when neither Rust nor localStorage has settings", async () => {
    const loaded = await initializeSettings();
    expect(loaded).toEqual(DEFAULT_SETTINGS);
  });
});

describe("flushPendingSettingsSave", () => {
  it("is a safe no-op when no provider is mounted", async () => {
    await expect(flushPendingSettingsSave()).resolves.toBeUndefined();
  });

  it("persists the latest settings immediately for an active provider", async () => {
    const invokeSpy = vi.spyOn(tauriCore, "invoke");
    tauriCoreMock.__setInvokeResult("load_settings", DEFAULT_SETTINGS);
    tauriCoreMock.__setInvokeResult("save_settings", undefined);

    await renderSettingsProvider();

    expect(latestContext).not.toBeNull();

    await act(async () => {
      latestContext?.update({ theme: "light", radius: 1 });
    });
    await flushReactWork();
    await act(async () => {
      await flushPendingSettingsSave();
    });

    const saveCalls = invokeSpy.mock.calls.filter((call) => call[0] === "save_settings");
    expect(saveCalls.length).toBeGreaterThan(0);
    expect(saveCalls[saveCalls.length - 1]?.[1]).toEqual({
      settings: expect.objectContaining({ theme: "light", radius: 1 }),
    });
  });
});
