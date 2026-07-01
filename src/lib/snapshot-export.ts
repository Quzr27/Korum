export interface SnapshotExportOptions {
  showMinimap: boolean;
  hideUsageCard: boolean;
  hideSidebar: boolean;
}

export const DEFAULT_SNAPSHOT_EXPORT_OPTIONS: SnapshotExportOptions = {
  showMinimap: true,
  hideUsageCard: false,
  hideSidebar: false,
};

export function buildSnapshotCaptureClassName(options: SnapshotExportOptions): string {
  return [
    "snapshot-capture-mode",
    options.showMinimap ? null : "snapshot-hide-minimap",
    options.hideUsageCard ? "snapshot-hide-usage-card" : null,
    options.hideSidebar ? "snapshot-hide-sidebar" : null,
  ].filter(Boolean).join(" ");
}

export function buildSnapshotFileName(workspaceName: string, date = new Date()): string {
  const safeName = workspaceName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "korum-snapshot";
  const timestamp = date.toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "")
    .replace("T", "-")
    .replace("Z", "")
    .replace(/^(\d{4})(\d{2})(\d{2})-/, "$1-$2-$3-");
  return `${safeName}-${timestamp}.png`;
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const match = /^data:image\/png;base64,(.+)$/u.exec(dataUrl);
  if (!match) {
    throw new Error("Expected a PNG data URL");
  }

  const binary = atob(match[1]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
