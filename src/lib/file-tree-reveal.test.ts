import { describe, expect, it } from "vitest";
import { getFileTreeRevealDirectories, isPathInsideRoot } from "@/lib/file-tree-reveal";

describe("getFileTreeRevealDirectories", () => {
  it("returns root plus ancestor directories for a nested file", () => {
    expect(getFileTreeRevealDirectories(
      "/Users/dominik/project",
      "/Users/dominik/project/src/pages/index.astro",
    )).toEqual([
      "/Users/dominik/project",
      "/Users/dominik/project/src",
      "/Users/dominik/project/src/pages",
    ]);
  });

  it("returns only root for a root-level file", () => {
    expect(getFileTreeRevealDirectories(
      "/Users/dominik/project",
      "/Users/dominik/project/package.json",
    )).toEqual(["/Users/dominik/project"]);
  });

  it("ignores paths outside the workspace root", () => {
    expect(getFileTreeRevealDirectories(
      "/Users/dominik/project",
      "/Users/dominik/other/package.json",
    )).toEqual([]);
  });
});

describe("isPathInsideRoot", () => {
  it("accepts descendants and rejects prefix siblings", () => {
    expect(isPathInsideRoot("/Users/dominik/project", "/Users/dominik/project/src/App.tsx")).toBe(true);
    expect(isPathInsideRoot("/Users/dominik/project", "/Users/dominik/project-other/src/App.tsx")).toBe(false);
  });
});
