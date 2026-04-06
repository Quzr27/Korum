// Stub for @tauri-apps/api/core used in tests
const invokeResults = new Map<string, unknown>();

export function __setInvokeResult(command: string, result: unknown) {
  invokeResults.set(command, result);
}

export function __clearInvokeResults() {
  invokeResults.clear();
}

export async function invoke<T>(command: string, _args?: Record<string, unknown>): Promise<T> {
  if (invokeResults.has(command)) {
    return invokeResults.get(command) as T;
  }
  throw new Error(`[mock] No invoke result set for command: ${command}`);
}

export class Channel<T> {
  onmessage: ((data: T) => void) | null = null;
}
