import { describe, expect, it } from "vitest";
import { createTerminalOutputNormalizer, normalizeTerminalStatusGlyphs } from "./terminal-glyph-normalizer";

describe("terminal glyph normalizer", () => {
  it("replaces Claude status-line emoji with terminal-safe Nerd Font glyphs", () => {
    expect(normalizeTerminalStatusGlyphs("\u{1f4c1}Korum | \u{1f500}main")).toBe("\ue5ff Korum | \ue0a0 main");
  });

  it("drops optional emoji presentation selectors with the replacement", () => {
    expect(normalizeTerminalStatusGlyphs("\u{1f4c1}\ufe0fKorum | \u{1f500}\ufe0fmain")).toBe(
      "\ue5ff Korum | \ue0a0 main",
    );
  });

  it("handles emoji split across UTF-8 chunks", () => {
    const normalizer = createTerminalOutputNormalizer();
    const bytes = new TextEncoder().encode("\u{1f4c1}Korum");

    const first = normalizer.normalize(bytes.slice(0, 2));
    const second = normalizer.normalize(bytes.slice(2));

    expect(first).toBe("");
    expect(second).toBe("\ue5ff Korum");
  });
});
