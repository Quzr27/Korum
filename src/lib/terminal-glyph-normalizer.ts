const TERMINAL_STATUS_GLYPH_REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\u{1f4c1}\ufe0f?/gu, "\ue5ff "],
  [/\u{1f500}\ufe0f?/gu, "\ue0a0 "],
];

export function normalizeTerminalStatusGlyphs(text: string): string {
  // Fast path: these source emoji only appear in Claude/Codex statuslines, so
  // the vast majority of output (and every flood) contains neither. A cheap
  // substring check skips the regex replacements on the hot streaming path.
  if (!text.includes("\u{1f4c1}") && !text.includes("\u{1f500}")) return text;
  let normalized = text;
  for (const [source, replacement] of TERMINAL_STATUS_GLYPH_REPLACEMENTS) {
    normalized = normalized.replace(source, replacement);
  }
  return normalized;
}

export function createTerminalOutputNormalizer() {
  const decoder = new TextDecoder();

  return {
    normalize(chunk: Uint8Array): string {
      return normalizeTerminalStatusGlyphs(decoder.decode(chunk, { stream: true }));
    },
    flush(): string {
      return normalizeTerminalStatusGlyphs(decoder.decode());
    },
  };
}
