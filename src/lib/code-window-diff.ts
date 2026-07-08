import type { DiffLine } from "@/types";

export interface DeletedOnlyDiffRow {
  key: string;
  oldLine: number | "";
  text: string;
}

export function buildDeletedOnlyDiffRows(diffLines: readonly DiffLine[] | null): DeletedOnlyDiffRow[] | null {
  if (!diffLines || diffLines.length === 0) return null;
  if (diffLines.some((line) => line.origin !== "delete")) return null;

  return diffLines.map((line, index) => ({
    key: `deleted-${index}`,
    oldLine: line.old_lineno ?? "",
    text: line.content,
  }));
}
