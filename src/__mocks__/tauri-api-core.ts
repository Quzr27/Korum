// Stub for @tauri-apps/api/core used in tests
const invokeResults = new Map<string, unknown>();
const invokeCalls: Array<{ command: string; args?: Record<string, unknown> }> = [];

export function __setInvokeResult(command: string, result: unknown) {
  invokeResults.set(command, result);
}

export function __clearInvokeResults() {
  invokeResults.clear();
  invokeCalls.length = 0;
}

export function __getInvokeCalls() {
  return [...invokeCalls];
}

export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  invokeCalls.push({ command, args });
  if (invokeResults.has(command)) {
    return invokeResults.get(command) as T;
  }
  throw new Error(`[mock] No invoke result set for command: ${command}`);
}

export class Channel<T> {
  onmessage: ((data: T) => void) | null = null;
}
