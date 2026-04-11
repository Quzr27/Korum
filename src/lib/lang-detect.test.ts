import { describe, expect, it } from "vitest";
import { detectLanguage } from "./lang-detect";

describe("detectLanguage", () => {
  it("maps common extensions", () => {
    expect(detectLanguage("file.ts")).toBe("typescript");
    expect(detectLanguage("file.tsx")).toBe("tsx");
    expect(detectLanguage("file.rs")).toBe("rust");
    expect(detectLanguage("file.py")).toBe("python");
    expect(detectLanguage("file.go")).toBe("go");
    expect(detectLanguage("file.css")).toBe("css");
    expect(detectLanguage("file.html")).toBe("html");
    expect(detectLanguage("file.json")).toBe("json");
  });

  it("maps module extensions", () => {
    expect(detectLanguage("file.mjs")).toBe("javascript");
    expect(detectLanguage("file.cjs")).toBe("javascript");
    expect(detectLanguage("file.mts")).toBe("typescript");
    expect(detectLanguage("file.cts")).toBe("typescript");
  });

  it("handles .d.ts as typescript", () => {
    expect(detectLanguage("types.d.ts")).toBe("typescript");
    expect(detectLanguage("/foo/bar/index.d.ts")).toBe("typescript");
  });

  it("matches special filenames", () => {
    expect(detectLanguage("Makefile")).toBe("makefile");
    expect(detectLanguage("Dockerfile")).toBe("dockerfile");
    expect(detectLanguage("Gemfile")).toBe("ruby");
    expect(detectLanguage("Justfile")).toBe("just");
    expect(detectLanguage("CMakeLists")).toBe("cmake");
  });

  it("matches special filenames case-insensitively", () => {
    expect(detectLanguage("makefile")).toBe("makefile");
    expect(detectLanguage("MAKEFILE")).toBe("makefile");
    expect(detectLanguage("dockerfile")).toBe("dockerfile");
    expect(detectLanguage("GEMFILE")).toBe("ruby");
  });

  it("returns text for unknown extension", () => {
    expect(detectLanguage("file.xyz")).toBe("text");
    expect(detectLanguage("file.unknown")).toBe("text");
  });

  it("returns text for no extension", () => {
    expect(detectLanguage("README")).toBe("text");
    expect(detectLanguage("LICENSE")).toBe("text");
  });

  it("resolves language from full unix paths", () => {
    expect(detectLanguage("/foo/bar/file.rs")).toBe("rust");
    expect(detectLanguage("/home/user/project/main.py")).toBe("python");
  });

  it("resolves language from windows-style paths", () => {
    expect(detectLanguage("C:\\Users\\file.ts")).toBe("typescript");
    expect(detectLanguage("C:\\Projects\\app\\main.go")).toBe("go");
  });

  it("matches special filename with extension in path", () => {
    expect(detectLanguage("/project/Makefile")).toBe("makefile");
    expect(detectLanguage("/project/Dockerfile")).toBe("dockerfile");
    expect(detectLanguage("C:\\project\\Gemfile")).toBe("ruby");
  });
});
