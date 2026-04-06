import { invoke } from "@tauri-apps/api/core";
import { persistState, type PersistedState } from "@/lib/persistence";
import { flushPendingSettingsSave } from "@/lib/settings-context";

export const QUIT_REQUESTED_EVENT = "korum://quit-requested";

const SAVE_TIMEOUT_MS = 3000;

export async function confirmAppQuit(
  collectState: () => PersistedState,
): Promise<void> {
  try {
    const savePromise = Promise.all([
      persistState(collectState()),
      flushPendingSettingsSave(),
    ]);
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timeoutHandle = setTimeout(() => {
        console.warn(
          `[quit-guard] Save timed out after ${SAVE_TIMEOUT_MS}ms, proceeding with exit`,
        );
        resolve();
      }, SAVE_TIMEOUT_MS);
    });
    await Promise.race([savePromise, timeout]);
    clearTimeout(timeoutHandle);
  } catch (error) {
    console.error("[quit-guard] Save before exit failed:", error);
  }

  await invoke("confirm_app_exit");
}
