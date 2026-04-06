import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { Settings } from "./settings";
import {
  DEFAULT_SETTINGS,
  applySettings,
  clearLocalStorageSettings,
  hasLocalStorageSettings,
  loadBootstrapSettings,
  loadSettingsFromLocalStorage,
  parseSettings,
  saveBootstrapSettings,
} from "./settings";
import { loadPersistedSettings, persistSettings } from "./persistence";

interface SettingsContextValue {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
}

const SettingsContext = createContext<SettingsContextValue>({
  settings: DEFAULT_SETTINGS,
  update: () => {},
});

/**
 * Two-phase settings migration (localStorage → Rust JSON):
 *
 * 1. Try loading from Rust (settings.json in app config dir).
 * 2. If valid → use it. Migration is done. Clean up localStorage if still present.
 * 3. If missing → check localStorage for existing settings.
 * 4. If found → use them and write to Rust (migrate).
 * 5. On next startup, Rust file exists → step 2 cleans localStorage.
 * 6. If neither source has data → use defaults.
 *
 * localStorage is only deleted after a confirmed successful Rust load,
 * so a failed write never loses both copies.
 */
export async function initializeSettings(): Promise<Settings> {
  try {
    const rustData = await loadPersistedSettings();
    if (rustData !== null && rustData !== undefined) {
      const { settings, isFullyValid } = parseSettings(rustData);
      if (isFullyValid) {
        // Rust file exists and is semantically valid — migration is complete.
        if (hasLocalStorageSettings()) {
          clearLocalStorageSettings();
        }
        return settings;
      }

      // Primary settings file parsed, but is semantically invalid.
      // Prefer the legacy copy if it still exists so we don't discard the user's last good settings.
      if (hasLocalStorageSettings()) {
        const localSettings = loadSettingsFromLocalStorage();
        try {
          await persistSettings(localSettings);
        } catch {
          // Keep using localStorage values and try healing Rust again on a future startup.
        }
        return localSettings;
      }

      return settings;
    }
  } catch {
    // Rust load failed — fall through to localStorage.
  }

  // No Rust file yet. Check localStorage first, then load if present.
  if (!hasLocalStorageSettings()) return DEFAULT_SETTINGS;

  const localSettings = loadSettingsFromLocalStorage();

  // Migrate: write to Rust. Don't delete localStorage yet —
  // we'll clean it up on next startup after confirming Rust load.
  try {
    await persistSettings(localSettings);
  } catch {
    // Migration write failed — keep using localStorage values.
    // They'll be migrated on a future startup.
  }

  return localSettings;
}

/**
 * Module-level flush callback set by the active SettingsProvider.
 * Cancels any pending debounce timer and saves immediately.
 * Used by the App close handler to ensure settings are persisted before exit.
 */
let flushFn: (() => Promise<void>) | null = null;

export function flushPendingSettingsSave(): Promise<void> {
  return flushFn?.() ?? Promise.resolve();
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadBootstrapSettings);
  const readyRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestSettingsRef = useRef(settings);
  latestSettingsRef.current = settings;
  const savePromiseRef = useRef<Promise<void> | null>(null);

  // Helper: cancel timer and persist latest settings immediately.
  // Chains after any in-flight save to prevent out-of-order writes.
  const doImmediateSave = useCallback((): Promise<void> => {
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const doSave = () => persistSettings(latestSettingsRef.current).catch(() => {}).finally(() => {
      savePromiseRef.current = null;
    });
    const save = savePromiseRef.current ? savePromiseRef.current.then(doSave) : doSave();
    savePromiseRef.current = save;
    return save;
  }, []);

  // Register/unregister the module-level flush callback.
  useEffect(() => {
    flushFn = doImmediateSave;
    return () => { flushFn = null; };
  }, [doImmediateSave]);

  // Async initialization: load from Rust (or migrate from localStorage).
  useEffect(() => {
    let cancelled = false;
    initializeSettings().then((loaded) => {
      if (cancelled) return;
      setSettings(loaded);
      saveBootstrapSettings(loaded);
      applySettings(loaded);
      readyRef.current = true;
    });
    return () => { cancelled = true; };
  }, []);

  // Apply only the DOM-bound theme tokens when those settings change.
  useEffect(() => {
    if (!readyRef.current) return;
    saveBootstrapSettings(settings);
    applySettings(settings);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: only re-apply DOM tokens when visual settings change, not all settings
  }, [settings.theme, settings.baseColor, settings.canvasAtmosphere, settings.radius]);

  // Persist settings to Rust with a short debounce.
  // Uses latestSettingsRef in the timer callback to avoid stale closures.
  // Bootstrap cache updated synchronously so cold starts use latest values.
  useEffect(() => {
    if (!readyRef.current) return;
    saveBootstrapSettings(settings);

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      savePromiseRef.current = persistSettings(latestSettingsRef.current).catch(() => {}).finally(() => {
        savePromiseRef.current = null;
      });
    }, 120);

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [settings]);

  // Flush pending save on unmount.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        savePromiseRef.current = persistSettings(latestSettingsRef.current).catch(() => {}).finally(() => {
          savePromiseRef.current = null;
        });
      }
    };
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      for (const key of Object.keys(next) as (keyof Settings)[]) {
        if (next[key] !== prev[key]) return next;
      }
      return prev;
    });
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, update }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  return useContext(SettingsContext);
}
