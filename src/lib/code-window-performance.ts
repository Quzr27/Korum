export const CODE_WINDOW_LOW_ZOOM_PREVIEW = 0.45;
export const CODE_WINDOW_LARGE_LINE_COUNT = 1_000;
export const CODE_WINDOW_LARGE_BYTE_COUNT = 40_000;
export const CODE_WINDOW_DETAILED_MINIMAP_MAX_ROWS = 1_000;
export const CODE_WINDOW_DETAILED_MINIMAP_MAX_TOKENS = 5_000;
export const CODE_WINDOW_MINIMAP_MAX_ROWS = 5_000;

export interface CodeWindowPerformanceInput {
  lineCount: number;
  byteLength: number;
  tokenCount?: number;
  zoom: number;
  isActive: boolean;
}

export interface CodeWindowPerformancePolicy {
  previewMode: boolean;
  largeFile: boolean;
  deferFullTokenization: boolean;
  tokenizeVisible: boolean;
  tokenizeFull: boolean;
  renderMinimap: boolean;
  renderDetailedMinimap: boolean;
}

export function getCodeWindowPerformancePolicy({
  lineCount,
  byteLength,
  tokenCount,
  zoom,
  isActive,
}: CodeWindowPerformanceInput): CodeWindowPerformancePolicy {
  const safeLineCount = Math.max(0, Math.floor(lineCount));
  const safeByteLength = Math.max(0, byteLength);
  const safeZoom = Number.isFinite(zoom) ? zoom : 1;
  const largeFile = safeLineCount >= CODE_WINDOW_LARGE_LINE_COUNT || safeByteLength >= CODE_WINDOW_LARGE_BYTE_COUNT;
  const previewMode = !isActive && safeZoom < CODE_WINDOW_LOW_ZOOM_PREVIEW;
  const tooLargeForDetailedMinimap =
    safeLineCount > CODE_WINDOW_DETAILED_MINIMAP_MAX_ROWS ||
    (tokenCount != null && tokenCount > CODE_WINDOW_DETAILED_MINIMAP_MAX_TOKENS);

  return {
    previewMode,
    largeFile,
    deferFullTokenization: largeFile,
    tokenizeVisible: !previewMode,
    tokenizeFull: !previewMode,
    renderMinimap: !previewMode && safeLineCount > 0 && safeLineCount <= CODE_WINDOW_MINIMAP_MAX_ROWS,
    renderDetailedMinimap: !previewMode && safeLineCount > 0 && !tooLargeForDetailedMinimap,
  };
}
