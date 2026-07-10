import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachTerminalGeneration,
  createTerminalOutputAcker,
  shouldCaptureTerminalSnapshot,
} from "./xterm-session";

describe("shouldCaptureTerminalSnapshot", () => {
  it("discards a deferred snapshot after the session stop epoch changes", () => {
    expect(shouldCaptureTerminalSnapshot(true, true, 2, 3)).toBe(false);
    expect(shouldCaptureTerminalSnapshot(true, true, 3, 3)).toBe(true);
  });
});

describe("attachTerminalGeneration", () => {
  it("detaches the exact generation when cleanup wins the async attach race", async () => {
    let resolveAttach: (() => void) | undefined;
    let alive = true;
    const detach = vi.fn(async () => undefined);
    const markAttached = vi.fn();
    const pending = attachTerminalGeneration({
      attach: () => new Promise<void>((resolve) => { resolveAttach = resolve; }),
      detach,
      isAlive: () => alive,
      markAttached,
    });

    alive = false;
    resolveAttach?.();
    await pending;

    expect(detach).toHaveBeenCalledTimes(1);
    expect(markAttached).not.toHaveBeenCalled();
  });

  it("marks a still-live generation attached without detaching it", async () => {
    const detach = vi.fn(async () => undefined);
    const markAttached = vi.fn();

    await attachTerminalGeneration({
      attach: async () => undefined,
      detach,
      isAlive: () => true,
      markAttached,
    });

    expect(markAttached).toHaveBeenCalledTimes(1);
    expect(detach).not.toHaveBeenCalled();
  });
});

describe("createTerminalOutputAcker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns parsed credits after at most 50 ms", () => {
    const sendAck = vi.fn();
    const acker = createTerminalOutputAcker(sendAck);

    acker.acknowledgeParsed(64 * 1024);
    vi.advanceTimersByTime(49);
    expect(sendAck).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(sendAck).toHaveBeenCalledWith(64 * 1024);
  });

  it("flushes as soon as 128 KiB has been parsed", () => {
    const sendAck = vi.fn();
    const acker = createTerminalOutputAcker(sendAck);

    acker.acknowledgeParsed(64 * 1024);
    acker.acknowledgeParsed(64 * 1024);

    expect(sendAck).toHaveBeenCalledTimes(1);
    expect(sendAck).toHaveBeenCalledWith(128 * 1024);
    vi.advanceTimersByTime(50);
    expect(sendAck).toHaveBeenCalledTimes(1);
  });

  it("immediately acknowledges bytes that do not enter xterm", () => {
    const sendAck = vi.fn();
    const acker = createTerminalOutputAcker(sendAck);

    acker.acknowledgeImmediately(3);

    expect(sendAck).toHaveBeenCalledWith(3);
  });

  it("cancels pending credits on detach because backend credit is reset", () => {
    const sendAck = vi.fn();
    const acker = createTerminalOutputAcker(sendAck);

    acker.acknowledgeParsed(32 * 1024);
    acker.dispose();
    vi.advanceTimersByTime(50);

    expect(sendAck).not.toHaveBeenCalled();
  });

  it("requeues a rejected ACK and retries without losing credit", async () => {
    const sendAck = vi.fn()
      .mockRejectedValueOnce(new Error("temporary IPC failure"))
      .mockResolvedValue(undefined);
    const acker = createTerminalOutputAcker(sendAck);

    acker.acknowledgeParsed(128 * 1024);
    await Promise.resolve();
    await Promise.resolve();
    expect(sendAck).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(50);

    expect(sendAck).toHaveBeenCalledTimes(2);
    expect(sendAck).toHaveBeenNthCalledWith(2, 128 * 1024);
  });
});
