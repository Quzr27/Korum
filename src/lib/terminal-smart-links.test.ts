import { describe, expect, it } from "vitest";
import {
  findTerminalDiagnosticLink,
  findTerminalFileContext,
  findTerminalSmartLinks,
  mapTerminalLinkRange,
  resolveTerminalFilePath,
} from "@/lib/terminal-smart-links";

describe("findTerminalSmartLinks", () => {
  it("detects http and https URLs without trailing punctuation", () => {
    const links = findTerminalSmartLinks("Docs: https://vite.dev/guide/, api: http://localhost:5173).");

    expect(links).toEqual([
      {
        kind: "url",
        text: "https://vite.dev/guide/",
        url: "https://vite.dev/guide/",
        startIndex: 6,
        endIndex: 29,
      },
      {
        kind: "url",
        text: "http://localhost:5173",
        url: "http://localhost:5173",
        startIndex: 36,
        endIndex: 57,
      },
    ]);
  });

  it("detects absolute file paths with line and column", () => {
    const links = findTerminalSmartLinks("at render (/Users/dominik/Korum/src/App.tsx:42:13)");

    expect(links).toEqual([
      {
        kind: "file",
        text: "/Users/dominik/Korum/src/App.tsx:42:13",
        path: "/Users/dominik/Korum/src/App.tsx",
        line: 42,
        column: 13,
        startIndex: 11,
        endIndex: 49,
      },
    ]);
  });

  it("detects relative TypeScript, Vite, and ESLint style file locations", () => {
    const links = findTerminalSmartLinks("src/App.tsx:42:13 - error TS2345");

    expect(links).toEqual([
      {
        kind: "file",
        text: "src/App.tsx:42:13",
        path: "src/App.tsx",
        line: 42,
        column: 13,
        startIndex: 0,
        endIndex: 17,
      },
    ]);
  });

  it("detects root-level relative file locations", () => {
    const links = findTerminalSmartLinks("vite.config.ts:7:3 - error TS2345");

    expect(links).toEqual([
      {
        kind: "file",
        text: "vite.config.ts:7:3",
        path: "vite.config.ts",
        line: 7,
        column: 3,
        startIndex: 0,
        endIndex: 18,
      },
    ]);
  });

  it("detects standalone file paths without line numbers", () => {
    expect(findTerminalSmartLinks("  /Users/dominiknovak/Documents/DEV/Mine/rcrental/package.json  ")).toEqual([
      {
        kind: "file",
        text: "/Users/dominiknovak/Documents/DEV/Mine/rcrental/package.json",
        path: "/Users/dominiknovak/Documents/DEV/Mine/rcrental/package.json",
        line: 1,
        startIndex: 2,
        endIndex: 62,
      },
    ]);
    expect(findTerminalSmartLinks("package.json")).toEqual([
      {
        kind: "file",
        text: "package.json",
        path: "package.json",
        line: 1,
        startIndex: 0,
        endIndex: 12,
      },
    ]);
    expect(findTerminalSmartLinks("src/pages/index.astro")).toEqual([
      {
        kind: "file",
        text: "src/pages/index.astro",
        path: "src/pages/index.astro",
        line: 1,
        startIndex: 0,
        endIndex: 21,
      },
    ]);
  });

  it("detects file locations written with parentheses", () => {
    const links = findTerminalSmartLinks("error in src/lib/foo.ts(12,5): nope");

    expect(links).toEqual([
      {
        kind: "file",
        text: "src/lib/foo.ts(12,5)",
        path: "src/lib/foo.ts",
        line: 12,
        column: 5,
        startIndex: 9,
        endIndex: 29,
      },
    ]);
  });

  it("does not return file matches inside URLs", () => {
    const links = findTerminalSmartLinks("See https://example.test/src/App.tsx:42 for details");

    expect(links).toEqual([
      {
        kind: "url",
        text: "https://example.test/src/App.tsx:42",
        url: "https://example.test/src/App.tsx:42",
        startIndex: 4,
        endIndex: 39,
      },
    ]);
  });
});

describe("resolveTerminalFilePath", () => {
  it("returns absolute paths unchanged", () => {
    expect(resolveTerminalFilePath("/Users/dominik/Korum/src/App.tsx", "/tmp/root")).toBe(
      "/Users/dominik/Korum/src/App.tsx",
    );
  });

  it("resolves relative paths against the workspace root", () => {
    expect(resolveTerminalFilePath("./src/App.tsx", "/Users/dominik/Korum")).toBe(
      "/Users/dominik/Korum/src/App.tsx",
    );
    expect(resolveTerminalFilePath("src/App.tsx", "/Users/dominik/Korum")).toBe(
      "/Users/dominik/Korum/src/App.tsx",
    );
  });

  it("rejects relative paths without a workspace root", () => {
    expect(resolveTerminalFilePath("src/App.tsx")).toBeNull();
  });

  it("rejects relative paths that escape the workspace root", () => {
    expect(resolveTerminalFilePath("../outside.ts", "/Users/dominik/Korum")).toBeNull();
  });
});

describe("ESLint stylish helpers", () => {
  it("detects a standalone file path context line", () => {
    expect(findTerminalFileContext("  /Users/dominik/Korum/src/App.tsx  ")).toEqual({
      path: "/Users/dominik/Korum/src/App.tsx",
      text: "/Users/dominik/Korum/src/App.tsx",
      startIndex: 2,
      endIndex: 34,
    });
  });

  it("turns an ESLint diagnostic row into a file link with the context path", () => {
    expect(findTerminalDiagnosticLink("  42:13  error  Unexpected any", "src/App.tsx")).toEqual({
      kind: "file",
      text: "42:13",
      path: "src/App.tsx",
      line: 42,
      column: 13,
      startIndex: 2,
      endIndex: 7,
    });
  });
});

describe("mapTerminalLinkRange", () => {
  it("maps a logical wrapped-line link back to buffer cells", () => {
    expect(mapTerminalLinkRange(
      [
        { bufferLineNumber: 10, startIndex: 0, endIndex: 20 },
        { bufferLineNumber: 11, startIndex: 20, endIndex: 49 },
      ],
      11,
      49,
    )).toEqual({
      start: { x: 12, y: 10 },
      end: { x: 29, y: 11 },
    });
  });

  it("uses cell-aware boundaries when a segment provides them", () => {
    expect(mapTerminalLinkRange(
      [
        {
          bufferLineNumber: 10,
          startIndex: 0,
          endIndex: 12,
          cellStartByIndex: [1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
          cellEndByIndex: [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
        },
      ],
      1,
      12,
    )).toEqual({
      start: { x: 3, y: 10 },
      end: { x: 13, y: 10 },
    });
  });
});
