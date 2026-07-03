// Stub for @tauri-apps/plugin-dialog
let saveResult: string | null = null;
let openResults: Array<string | null> = [];

export function __setSaveResult(result: string | null) {
  saveResult = result;
}

export function __setOpenResult(result: string | null) {
  openResults = [result];
}

export function __setOpenResults(results: Array<string | null>) {
  openResults = [...results];
}

export function __clearDialogMocks() {
  saveResult = null;
  openResults = [];
}

export async function open(_options?: unknown): Promise<string | null> {
  return openResults.shift() ?? null;
}

export async function save(_options?: unknown): Promise<string | null> {
  return saveResult;
}
