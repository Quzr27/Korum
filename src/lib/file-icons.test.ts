import { describe, expect, it } from "vitest";
import type { FileEntry } from "@/types";
import { GIT_STATUS_COLORS, getFileIconName } from "./file-icons";

function makeFile(name: string): FileEntry {
  return { name, path: `/tmp/${name}`, is_dir: false, is_symlink: false, is_ignored: false };
}

function makeDir(name: string): FileEntry {
  return { name, path: `/tmp/${name}`, is_dir: true, is_symlink: false, is_ignored: false };
}

describe("getFileIconName", () => {
  describe("files by exact name", () => {
    it("package.json → nodejs", () => {
      expect(getFileIconName(makeFile("package.json"))).toBe("nodejs");
    });

    it("tsconfig.json → tsconfig", () => {
      expect(getFileIconName(makeFile("tsconfig.json"))).toBe("tsconfig");
    });

    it("vite.config.ts → vite", () => {
      expect(getFileIconName(makeFile("vite.config.ts"))).toBe("vite");
    });

    it(".gitignore → git", () => {
      expect(getFileIconName(makeFile(".gitignore"))).toBe("git");
    });

    it("dockerfile (lowercase) → docker", () => {
      expect(getFileIconName(makeFile("dockerfile"))).toBe("docker");
    });

    it("Dockerfile (mixed case) → docker", () => {
      expect(getFileIconName(makeFile("Dockerfile"))).toBe("docker");
    });

    it("readme.md → readme", () => {
      expect(getFileIconName(makeFile("readme.md"))).toBe("readme");
    });
  });

  describe("files by extension", () => {
    it(".rs → rust", () => {
      expect(getFileIconName(makeFile("main.rs"))).toBe("rust");
    });

    it(".ts → typescript", () => {
      expect(getFileIconName(makeFile("index.ts"))).toBe("typescript");
    });

    it(".tsx → react-ts", () => {
      expect(getFileIconName(makeFile("App.tsx"))).toBe("react-ts");
    });

    it(".py → python", () => {
      expect(getFileIconName(makeFile("script.py"))).toBe("python");
    });

    it(".go → go", () => {
      expect(getFileIconName(makeFile("main.go"))).toBe("go");
    });

    it(".svg → svg", () => {
      expect(getFileIconName(makeFile("logo.svg"))).toBe("svg");
    });
  });

  describe("folders", () => {
    it("src → folder-src", () => {
      expect(getFileIconName(makeDir("src"))).toBe("folder-src");
    });

    it("node_modules → folder-node", () => {
      expect(getFileIconName(makeDir("node_modules"))).toBe("folder-node");
    });

    it("components → folder-components", () => {
      expect(getFileIconName(makeDir("components"))).toBe("folder-components");
    });
  });

  describe("expanded folders", () => {
    it("src expanded → folder-src-open", () => {
      expect(getFileIconName(makeDir("src"), true)).toBe("folder-src-open");
    });

    it("src collapsed → folder-src (no -open suffix)", () => {
      expect(getFileIconName(makeDir("src"), false)).toBe("folder-src");
    });
  });

  describe("fallback", () => {
    it("unknown file extension → document", () => {
      expect(getFileIconName(makeFile("weird.xyz123"))).toBe("document");
    });

    it("file with no extension → document", () => {
      expect(getFileIconName(makeFile("Makefile_custom"))).toBe("document");
    });

    it("unknown folder → folder-other", () => {
      expect(getFileIconName(makeDir("myrandomfolder"))).toBe("folder-other");
    });

    it("unknown folder expanded → folder-other-open", () => {
      expect(getFileIconName(makeDir("myrandomfolder"), true)).toBe("folder-other-open");
    });
  });
});

describe("GIT_STATUS_COLORS", () => {
  it("has M key (modified)", () => {
    expect(GIT_STATUS_COLORS).toHaveProperty("M");
    expect(typeof GIT_STATUS_COLORS["M"]).toBe("string");
  });

  it("has A key (added)", () => {
    expect(GIT_STATUS_COLORS).toHaveProperty("A");
    expect(typeof GIT_STATUS_COLORS["A"]).toBe("string");
  });

  it("has D key (deleted)", () => {
    expect(GIT_STATUS_COLORS).toHaveProperty("D");
    expect(typeof GIT_STATUS_COLORS["D"]).toBe("string");
  });

  it("has ? key (untracked)", () => {
    expect(GIT_STATUS_COLORS).toHaveProperty("?");
    expect(typeof GIT_STATUS_COLORS["?"]).toBe("string");
  });

  it("has R key (renamed)", () => {
    expect(GIT_STATUS_COLORS).toHaveProperty("R");
    expect(typeof GIT_STATUS_COLORS["R"]).toBe("string");
  });

  it("M is amber-ish", () => {
    expect(GIT_STATUS_COLORS["M"]).toBe("#F59E0B");
  });

  it("A is green-ish", () => {
    expect(GIT_STATUS_COLORS["A"]).toBe("#2dcf67");
  });

  it("D is red-ish", () => {
    expect(GIT_STATUS_COLORS["D"]).toBe("#FF5F57");
  });

  it("R is blue-ish", () => {
    expect(GIT_STATUS_COLORS["R"]).toBe("#58a6ff");
  });
});
