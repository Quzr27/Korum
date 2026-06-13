import { describe, expect, it } from "vitest";
import { getCodeWindowPerformancePolicy } from "./code-window-performance";

describe("getCodeWindowPerformancePolicy", () => {
  it("uses a lightweight preview for inactive code windows at overview zoom", () => {
    const policy = getCodeWindowPerformancePolicy({
      lineCount: 1200,
      byteLength: 46_351,
      tokenCount: 6504,
      zoom: 0.4,
      isActive: false,
    });

    expect(policy.previewMode).toBe(true);
    expect(policy.tokenizeVisible).toBe(false);
    expect(policy.tokenizeFull).toBe(false);
    expect(policy.renderMinimap).toBe(false);
  });

  it("keeps the active code window interactive even at overview zoom", () => {
    const policy = getCodeWindowPerformancePolicy({
      lineCount: 1200,
      byteLength: 46_351,
      zoom: 0.4,
      isActive: true,
    });

    expect(policy.previewMode).toBe(false);
    expect(policy.tokenizeVisible).toBe(true);
    expect(policy.tokenizeFull).toBe(true);
  });

  it("degrades expensive minimap detail for heavy files while keeping tokenization lazy", () => {
    const policy = getCodeWindowPerformancePolicy({
      lineCount: 1234,
      byteLength: 46_351,
      tokenCount: 6504,
      zoom: 1,
      isActive: false,
    });

    expect(policy.largeFile).toBe(true);
    expect(policy.deferFullTokenization).toBe(true);
    expect(policy.renderMinimap).toBe(true);
    expect(policy.renderDetailedMinimap).toBe(false);
  });
});
