import { describe, expect, it } from "vitest";
import { shouldHandleCodeTarget } from "@/lib/code-window-target";

describe("shouldHandleCodeTarget", () => {
  it("handles a fresh target nonce once", () => {
    expect(shouldHandleCodeTarget({
      line: 42,
      nonce: 7,
      viewMode: "file",
      tokensReady: true,
      lastHandledNonce: null,
    })).toBe(true);
  });

  it("does not re-handle the same target nonce", () => {
    expect(shouldHandleCodeTarget({
      line: 42,
      nonce: 7,
      viewMode: "file",
      tokensReady: true,
      lastHandledNonce: 7,
    })).toBe(false);
  });

  it("waits until file mode and tokens are ready", () => {
    expect(shouldHandleCodeTarget({
      line: 42,
      nonce: 8,
      viewMode: "changes",
      tokensReady: true,
      lastHandledNonce: null,
    })).toBe(false);
    expect(shouldHandleCodeTarget({
      line: 42,
      nonce: 8,
      viewMode: "file",
      tokensReady: false,
      lastHandledNonce: null,
    })).toBe(false);
  });
});
