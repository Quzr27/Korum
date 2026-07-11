import { describe, expect, it, vi } from "vitest";
import {
  createTerminalInputWriter,
  splitTerminalInput,
} from "./terminal-input";

describe("splitTerminalInput", () => {
  it("reconstructs Unicode and bracketed paste without cutting scalars", () => {
    const input = `\x1b[200~first🙂ž\nlast\x1b[201~`;
    const chunks = splitTerminalInput(input, 5);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toBe(input);
    for (const chunk of chunks) {
      expect(new TextEncoder().encode(chunk).byteLength).toBeLessThanOrEqual(8);
    }
  });
});

describe("createTerminalInputWriter", () => {
  it("allows only one write IPC in flight and preserves call order", async () => {
    let resolveFirst: ((accepted: boolean) => void) | undefined;
    const sendChunk = vi.fn((data: string) => {
      if (data === "first") {
        return new Promise<boolean>((resolve) => { resolveFirst = resolve; });
      }
      return Promise.resolve(true);
    });
    const writer = createTerminalInputWriter(sendChunk);

    const first = writer.send("first");
    const second = writer.send("second");
    expect(sendChunk.mock.calls.map(([data]) => data)).toEqual(["first"]);

    resolveFirst?.(true);
    await first;
    await second;
    expect(sendChunk.mock.calls.map(([data]) => data)).toEqual(["first", "second"]);
  });

  it("retries the same chunk on backend backpressure before advancing", async () => {
    const results = [false, true, true];
    const sendChunk = vi.fn(async (_data: string) => results.shift() ?? true);
    const writer = createTerminalInputWriter(sendChunk, {
      chunkBytes: 4,
      waitForRetry: async () => undefined,
    });

    await writer.send("abcdefgh");

    expect(sendChunk.mock.calls.map(([data]) => data)).toEqual(["abcd", "abcd", "efgh"]);
  });

  it("bounds queued frontend input while a write is in flight", async () => {
    let resolveWrite: ((accepted: boolean) => void) | undefined;
    const writer = createTerminalInputWriter(
      () => new Promise<boolean>((resolve) => { resolveWrite = resolve; }),
      { maxPendingBytes: 8 },
    );

    const accepted = writer.send("12345678");
    await expect(writer.send("x")).rejects.toThrow("queue is full");
    resolveWrite?.(true);
    await accepted;
  });

  it("streams one input larger than the queue budget in bounded chunks", async () => {
    let resolveFirst: ((accepted: boolean) => void) | undefined;
    const sendChunk = vi.fn((data: string) => {
      if (data === "abcd") {
        return new Promise<boolean>((resolve) => { resolveFirst = resolve; });
      }
      return Promise.resolve(true);
    });
    const writer = createTerminalInputWriter(sendChunk, {
      chunkBytes: 4,
      maxPendingBytes: 8,
    });

    const largePaste = writer.send("abcdefghijkl");
    await expect(writer.send("x")).rejects.toThrow("queue is full");
    resolveFirst?.(true);
    await largePaste;

    expect(sendChunk.mock.calls.map(([data]) => data)).toEqual([
      "abcd",
      "efgh",
      "ijkl",
    ]);
  });

  it("cancels an in-flight retry and rejects pending input", async () => {
    let finishRetry: (() => void) | undefined;
    const writer = createTerminalInputWriter(
      async () => false,
      {
        waitForRetry: () => new Promise<void>((resolve) => { finishRetry = resolve; }),
      },
    );

    const pending = writer.send("pending");
    await Promise.resolve();
    writer.cancel();
    finishRetry?.();

    await expect(pending).rejects.toThrow("cancelled");
  });
});
