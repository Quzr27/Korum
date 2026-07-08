import { describe, expect, it } from "vitest";
import { buildGitStatusByAbsolutePath, normalizeChangedFiles } from "@/lib/changed-files";
import type { GitStatusResult } from "@/types";

function statusResult(statuses: GitStatusResult["statuses"], repoRoot = "/repo"): GitStatusResult {
  return {
    repo_root: repoRoot,
    statuses,
    changed_count: statuses.length,
    insertions: 0,
    deletions: 0,
  };
}

describe("normalizeChangedFiles", () => {
  it("filters to the workspace root and builds drawer rows with absolute paths", () => {
    const rows = normalizeChangedFiles({
      workspaceRoot: "/repo/src",
      status: statusResult([
        { path: "README.md", status: "M", insertions: 1, deletions: 0 },
        { path: "src/App.tsx", status: "M", insertions: 4, deletions: 2 },
        { path: "src/lib/draft.ts", status: "?", insertions: 8, deletions: 0 },
      ]),
    });

    expect(rows).toEqual([
      {
        key: "/repo/src/App.tsx",
        absolutePath: "/repo/src/App.tsx",
        displayPath: "App.tsx",
        repoRelativePath: "src/App.tsx",
        status: "M",
        insertions: 4,
        deletions: 2,
        openMode: "changes",
      },
      {
        key: "/repo/src/lib/draft.ts",
        absolutePath: "/repo/src/lib/draft.ts",
        displayPath: "lib/draft.ts",
        repoRelativePath: "src/lib/draft.ts",
        status: "?",
        insertions: 8,
        deletions: 0,
        openMode: "file",
      },
    ]);
  });

  it("sorts by display path and opens deleted files in changes mode", () => {
    const rows = normalizeChangedFiles({
      workspaceRoot: "/repo",
      status: statusResult([
        { path: "src/z.ts", status: "M", insertions: 1, deletions: 0 },
        { path: "src/a.ts", status: "D", insertions: 0, deletions: 3 },
      ]),
    });

    expect(rows.map((row) => `${row.status}:${row.displayPath}:${row.openMode}`)).toEqual([
      "D:src/a.ts:changes",
      "M:src/z.ts:changes",
    ]);
  });
});

describe("buildGitStatusByAbsolutePath", () => {
  it("indexes statuses by absolute path for file tree lookups", () => {
    const status = statusResult([
      { path: "src/App.tsx", status: "M", insertions: 2, deletions: 1 },
      { path: "docs/outside.md", status: "M", insertions: 1, deletions: 0 },
    ]);

    expect([...buildGitStatusByAbsolutePath({ workspaceRoot: "/repo/src", status })]).toEqual([
      ["/repo/src/App.tsx", { status: "M", insertions: 2, deletions: 1 }],
    ]);
  });
});
