// Stub for @tauri-apps/plugin-dialog
let saveResult: string | null = null;

export function __setSaveResult(result: string | null) {
  saveResult = result;
}

export function __clearDialogMocks() {
  saveResult = null;
}

export async function open(_options?: unknown): Promise<string | null> {
  return null;
}

export async function save(_options?: unknown): Promise<string | null> {
  return saveResult;
}
