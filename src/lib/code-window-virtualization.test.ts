import { describe, expect, it } from "vitest";
import { getVirtualCodeRows } from "./code-window-virtualization";

describe("getVirtualCodeRows", () => {
  it("returns the full empty range when there are no rows", () => {
    expect(getVirtualCodeRows({
      rowCount: 0,
      scrollTop: 200,
      viewportHeight: 400,
      rowHeight: 20,
      overscan: 8,
    })).toEqual({
      start: 0,
      end: 0,
      topPadding: 0,
      bottomPadding: 0,
      totalHeight: 0,
    });
  });

  it("renders only the visible row window plus overscan", () => {
    expect(getVirtualCodeRows({
      rowCount: 1234,
      scrollTop: 5000,
      viewportHeight: 600,
      rowHeight: 20,
      overscan: 8,
    })).toEqual({
      start: 242,
      end: 288,
      topPadding: 4840,
      bottomPadding: 18920,
      totalHeight: 24680,
    });
  });

  it("clamps the range near the bottom of the file", () => {
    expect(getVirtualCodeRows({
      rowCount: 100,
      scrollTop: 1900,
      viewportHeight: 240,
      rowHeight: 20,
      overscan: 6,
    })).toEqual({
      start: 89,
      end: 100,
      topPadding: 1780,
      bottomPadding: 0,
      totalHeight: 2000,
    });
  });
});
