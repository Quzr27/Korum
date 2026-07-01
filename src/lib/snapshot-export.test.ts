import { describe, expect, it } from "vitest";
import {
  DEFAULT_SNAPSHOT_EXPORT_OPTIONS,
  buildSnapshotCaptureClassName,
  buildSnapshotFileName,
  dataUrlToBytes,
} from "./snapshot-export";

describe("snapshot export helpers", () => {
  it("keeps composition on by default", () => {
    expect(buildSnapshotCaptureClassName(DEFAULT_SNAPSHOT_EXPORT_OPTIONS)).toBe(
      "snapshot-capture-mode",
    );
  });

  it("builds composition classes from options", () => {
    expect(buildSnapshotCaptureClassName({
      ...DEFAULT_SNAPSHOT_EXPORT_OPTIONS,
      hideUsageCard: true,
      hideSidebar: true,
      showMinimap: false,
    })).toBe(
      "snapshot-capture-mode snapshot-hide-minimap snapshot-hide-usage-card snapshot-hide-sidebar",
    );
  });

  it("creates filesystem-friendly png filenames", () => {
    const date = new Date("2026-06-30T10:20:30Z");

    expect(buildSnapshotFileName("Korum / Demo: PR Review", date)).toBe(
      "korum-demo-pr-review-2026-06-30-102030.png",
    );
  });

  it("converts PNG data URLs to bytes", () => {
    const bytes = dataUrlToBytes("data:image/png;base64,SGVsbG8=");

    expect(Array.from(bytes)).toEqual([72, 101, 108, 108, 111]);
  });
});
