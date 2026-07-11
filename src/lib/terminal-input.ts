import { invoke } from "@tauri-apps/api/core";

export const TERMINAL_INPUT_CHUNK_BYTES = 16 * 1024;
export const TERMINAL_INPUT_MAX_PENDING_BYTES = 512 * 1024;
const TERMINAL_INPUT_RETRY_DELAY_MS = 16;

interface PendingInput {
  data: string;
  bytes: number;
  resolve: () => void;
  reject: (error: unknown) => void;
}

export interface TerminalInputWriter {
  send(data: string): Promise<void>;
  cancel(error?: unknown): void;
}

interface TerminalInputWriterOptions {
  chunkBytes?: number;
  maxPendingBytes?: number;
  waitForRetry?: () => Promise<void>;
  onIdle?: () => void;
}

function validateChunkBytes(chunkBytes: number): void {
  if (!Number.isInteger(chunkBytes) || chunkBytes < 4) {
    throw new Error("Terminal input chunk size must be at least 4 bytes");
  }
}

function terminalInputByteLength(data: string): number {
  let bytes = 0;
  for (let index = 0; index < data.length; index += 1) {
    const codeUnit = data.charCodeAt(index);
    if (codeUnit < 0x80) {
      bytes += 1;
    } else if (codeUnit < 0x800) {
      bytes += 2;
    } else if (
      codeUnit >= 0xd800
      && codeUnit <= 0xdbff
      && index + 1 < data.length
      && data.charCodeAt(index + 1) >= 0xdc00
      && data.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4;
      index += 1;
    } else {
      // TextEncoder replaces unpaired surrogates with U+FFFD (three bytes).
      bytes += 3;
    }
  }
  return bytes;
}

/** Lazily split without cutting a Unicode scalar. Each source window and its
 * UTF-8 encoding are bounded, avoiding a second full-paste allocation. */
function* iterateTerminalInputChunks(
  data: string,
  chunkBytes = TERMINAL_INPUT_CHUNK_BYTES,
): Generator<string> {
  if (!data) return;
  validateChunkBytes(chunkBytes);

  const encoder = new TextEncoder();
  for (let sourceOffset = 0; sourceOffset < data.length;) {
    let sourceEnd = Math.min(sourceOffset + chunkBytes, data.length);
    if (
      sourceEnd < data.length
      && data.charCodeAt(sourceEnd - 1) >= 0xd800
      && data.charCodeAt(sourceEnd - 1) <= 0xdbff
    ) {
      sourceEnd -= 1;
    }

    const encoded = encoder.encode(data.slice(sourceOffset, sourceEnd));
    const decoder = new TextDecoder();
    for (let byteOffset = 0; byteOffset < encoded.byteLength; byteOffset += chunkBytes) {
      const byteEnd = Math.min(byteOffset + chunkBytes, encoded.byteLength);
      const chunk = decoder.decode(encoded.subarray(byteOffset, byteEnd), {
        stream: byteEnd < encoded.byteLength,
      });
      if (chunk) yield chunk;
    }
    sourceOffset = sourceEnd;
  }
}

export function splitTerminalInput(
  data: string,
  chunkBytes = TERMINAL_INPUT_CHUNK_BYTES,
): string[] {
  return [...iterateTerminalInputChunks(data, chunkBytes)];
}

/** One writer per PTY serializes every input source. Backend `false` means
 * transient byte backpressure, so retry the same chunk before advancing. */
export function createTerminalInputWriter(
  sendChunk: (data: string) => Promise<boolean>,
  options: TerminalInputWriterOptions = {},
): TerminalInputWriter {
  const chunkBytes = options.chunkBytes ?? TERMINAL_INPUT_CHUNK_BYTES;
  const maxPendingBytes = options.maxPendingBytes ?? TERMINAL_INPUT_MAX_PENDING_BYTES;
  const waitForRetry = options.waitForRetry ?? (() => new Promise<void>((resolve) => {
    window.setTimeout(resolve, TERMINAL_INPUT_RETRY_DELAY_MS);
  }));

  let queue: PendingInput[] = [];
  let pendingBytes = 0;
  let running = false;
  let cancelled = false;

  const failAll = (error: unknown) => {
    const pending = queue;
    queue = [];
    pendingBytes = 0;
    for (const item of pending) item.reject(error);
  };

  const pump = async () => {
    if (running || cancelled) return;
    running = true;
    try {
      while (!cancelled && queue.length > 0) {
        const current = queue[0];
        try {
          for (const chunk of iterateTerminalInputChunks(current.data, chunkBytes)) {
            let accepted = false;
            while (!accepted) {
              if (cancelled || queue[0] !== current) return;
              accepted = await sendChunk(chunk);
              if (!accepted) await waitForRetry();
            }
          }
        } catch (error) {
          if (queue[0] === current) failAll(error);
          return;
        }

        if (cancelled || queue[0] !== current) return;
        queue.shift();
        pendingBytes = Math.max(0, pendingBytes - current.bytes);
        current.resolve();
      }
    } finally {
      running = false;
      if (queue.length === 0) options.onIdle?.();
    }
  };

  return {
    send(data) {
      if (!data) return Promise.resolve();
      if (cancelled) return Promise.reject(new Error("Terminal input was cancelled"));

      const bytes = terminalInputByteLength(data);
      // A single large paste is streamed through byte-sized chunks and does
      // not need to fit in the queue budget as a whole. While it is current,
      // reject additional logical inputs so retained follow-up data remains
      // bounded and ordering stays explicit.
      if (queue.length > 0 && pendingBytes + bytes > maxPendingBytes) {
        return Promise.reject(new Error("Terminal input queue is full"));
      }

      return new Promise<void>((resolve, reject) => {
        pendingBytes += bytes;
        queue.push({ data, bytes, resolve, reject });
        void pump();
      });
    },
    cancel(error = new Error("Terminal input was cancelled")) {
      if (cancelled) return;
      cancelled = true;
      failAll(error);
      options.onIdle?.();
    },
  };
}

const writers = new Map<string, TerminalInputWriter>();

export function writeTerminalInput(ptyId: string, data: string): Promise<void> {
  if (!data) return Promise.resolve();
  let writer = writers.get(ptyId);
  if (!writer) {
    writer = createTerminalInputWriter(
      (chunk) => invoke<boolean>("write_terminal", { id: ptyId, data: chunk }),
      {
        onIdle: () => {
          if (writers.get(ptyId) === writer) writers.delete(ptyId);
        },
      },
    );
    writers.set(ptyId, writer);
  }
  return writer.send(data);
}

export function cancelTerminalInput(ptyId: string): void {
  const writer = writers.get(ptyId);
  if (!writer) return;
  writers.delete(ptyId);
  writer.cancel();
}
