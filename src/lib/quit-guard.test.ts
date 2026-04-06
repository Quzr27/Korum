import { beforeEach, describe, expect, it, vi } from "vitest";
import * as tauriCore from "@tauri-apps/api/core";
import { confirmAppQuit } from "./quit-guard";
import type { PersistedState } from "./persistence";

const tauriCoreMock = tauriCore as typeof tauriCore & {
  __clearInvokeResults: () => void;
  __setInvokeResult: (command: string, result: unknown) => void;
};

const persistedState: PersistedState = {
  version: 1,
  savedAt: 1_710_000_000_000,
  activeWorkspaceId: "ws-1",
  workspaces: [
    { id: "ws-1", name: "Core", color: "blue", icon: "terminal" },
  ],
  windows: [],
  viewports: {},
  nextZ: 1,
};

beforeEach(() => {
  tauriCoreMock.__clearInvokeResults();
  vi.restoreAllMocks();
});

describe("confirmAppQuit", () => {
  it("persists the latest state before invoking the exit command", async () => {
    const invokeSpy = vi.spyOn(tauriCore, "invoke");
    tauriCoreMock.__setInvokeResult("save_state", undefined);
    tauriCoreMock.__setInvokeResult("confirm_app_exit", undefined);

    await confirmAppQuit(() => persistedState);

    expect(invokeSpy).toHaveBeenCalledWith("save_state", { state: persistedState });
    expect(invokeSpy).toHaveBeenCalledWith("confirm_app_exit");
  });

  it("proceeds with exit after timeout if save hangs", async () => {
    vi.useFakeTimers();
    try {
      // Mock save_state to never resolve
      vi.spyOn(tauriCore, "invoke").mockImplementation(
        (command: string) => {
          if (command === "save_state") {
            return new Promise(() => {}); // never resolves
          }
          if (command === "confirm_app_exit") {
            return Promise.resolve(undefined);
          }
          return Promise.reject(new Error(`[mock] unexpected: ${command}`));
        },
      );
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const quitPromise = confirmAppQuit(() => persistedState);

      // Advance past the 3s timeout
      await vi.advanceTimersByTimeAsync(3000);
      await quitPromise;

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Save timed out"),
      );
      expect(tauriCore.invoke).toHaveBeenCalledWith("confirm_app_exit");
    } finally {
      vi.useRealTimers();
    }
  });

  it("still requests app exit even if the save step fails", async () => {
    const invokeSpy = vi.spyOn(tauriCore, "invoke");
    tauriCoreMock.__setInvokeResult("confirm_app_exit", undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await confirmAppQuit(() => persistedState);

    const invokedCommands = invokeSpy.mock.calls.map(([command]) => command);
    expect(invokedCommands).toContain("confirm_app_exit");
    expect(errorSpy).toHaveBeenCalledWith(
      "[quit-guard] Save before exit failed:",
      expect.any(Error),
    );
  });
});
