import { describe, expect, it } from "vitest";
import { buildDeletedOnlyDiffRows } from "@/lib/code-window-diff";
import type { DiffLine } from "@/types";

describe("buildDeletedOnlyDiffRows", () => {
  it("converts deleted-only diff lines into renderable rows without source content", () => {
    const diffLines: DiffLine[] = [
      { origin: "delete", old_lineno: 1, new_lineno: null, content: "first" },
      { origin: "delete", old_lineno: 2, new_lineno: null, content: "second" },
    ];

    expect(buildDeletedOnlyDiffRows(diffLines)).toEqual([
      { key: "deleted-0", oldLine: 1, text: "first" },
      { key: "deleted-1", oldLine: 2, text: "second" },
    ]);
  });

  it("returns null when the diff still needs current file content", () => {
    expect(buildDeletedOnlyDiffRows([
      { origin: "context", old_lineno: 1, new_lineno: 1, content: "same" },
    ])).toBeNull();
  });
});
