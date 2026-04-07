import { createContext, useCallback, useContext, useEffect, useRef } from "react";

/**
 * VisibilityProvider — single-listener broadcast for terminal refresh.
 *
 * Instead of each TerminalWindow registering its own visibilitychange + focus
 * listeners (N×2 global listeners), this provider registers exactly 2 listeners
 * and broadcasts to all registered terminals via a callback Map.
 */

interface VisibilityContextValue {
  /** Register a per-terminal refresh callback. Called on visibility/focus change. */
  register: (id: string, callback: () => void) => void;
  /** Unregister when the terminal's xterm instance is destroyed. */
  unregister: (id: string) => void;
}

const VisibilityContext = createContext<VisibilityContextValue>({
  register: () => {},
  unregister: () => {},
});

export function VisibilityProvider({ children }: { children: React.ReactNode }) {
  const registryRef = useRef(new Map<string, () => void>());

  const register = useCallback((id: string, callback: () => void) => {
    registryRef.current.set(id, callback);
  }, []);

  const unregister = useCallback((id: string) => {
    registryRef.current.delete(id);
  }, []);

  useEffect(() => {
    const refreshAll = () => {
      if (document.visibilityState === "hidden") return;
      for (const callback of registryRef.current.values()) {
        callback();
      }
    };

    document.addEventListener("visibilitychange", refreshAll);
    window.addEventListener("focus", refreshAll);
    return () => {
      document.removeEventListener("visibilitychange", refreshAll);
      window.removeEventListener("focus", refreshAll);
    };
  }, []);

  return (
    <VisibilityContext.Provider value={{ register, unregister }}>
      {children}
    </VisibilityContext.Provider>
  );
}

/** Hook for terminal components to register/unregister refresh callbacks. */
export function useVisibility(): VisibilityContextValue {
  return useContext(VisibilityContext);
}
