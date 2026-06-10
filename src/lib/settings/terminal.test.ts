import { describe, expect, it } from "vitest";
import {
  TERMINAL_FONTS,
  TERMINAL_FONT_FAMILIES,
  TERMINAL_FONT_LOAD_TARGETS,
  TERMINAL_NERD_FONT_SAMPLE,
} from "./terminal";

describe("terminal font configuration", () => {
  it("uses patched Nerd Font builds as the primary terminal fonts", () => {
    for (const font of TERMINAL_FONTS) {
      const family = TERMINAL_FONT_FAMILIES[font];
      const loadTarget = TERMINAL_FONT_LOAD_TARGETS[font];

      expect(family.startsWith(`${loadTarget},`)).toBe(true);
      expect(family).not.toMatch(/Symbols Nerd Font/i);
    }
  });

  it("preloads the Claude status-line Nerd Font glyphs", () => {
    expect(TERMINAL_NERD_FONT_SAMPLE).toContain("\ue5ff");
    expect(TERMINAL_NERD_FONT_SAMPLE).toContain("\ueafc");
    expect(TERMINAL_NERD_FONT_SAMPLE).toContain("\ue0a0");
  });
});
