import { describe, expect, it } from "vitest";
import { selectSmartLinkCodeViewMode, shouldHandleCodeTarget } from "@/lib/code-window-target";

describe("shouldHandleCodeTarget", () => {
  it("handles a fresh target nonce once", () => {
    expect(shouldHandleCodeTarget({
      line: 42,
      nonce: 7,
      viewMode: "file",
      tokensReady: true,
      lastHandledNonce: null,
    })).toBe(true);
  });

  it("does not re-handle the same target nonce", () => {
    expect(shouldHandleCodeTarget({
      line: 42,
      nonce: 7,
      viewMode: "file",
      tokensReady: true,
      lastHandledNonce: 7,
    })).toBe(false);
  });

  it("waits until file mode and tokens are ready", () => {
    expect(shouldHandleCodeTarget({
      line: 42,
      nonce: 8,
      viewMode: "changes",
      tokensReady: true,
      lastHandledNonce: null,
    })).toBe(false);
    expect(shouldHandleCodeTarget({
      line: 42,
      nonce: 8,
      viewMode: "file",
      tokensReady: false,
      lastHandledNonce: null,
    })).toBe(false);
  });
});

describe("selectSmartLinkCodeViewMode", () => {
  it("opens tracked changed smart-linked files in changes mode", () => {
    expect(selectSmartLinkCodeViewMode({
      sourcePath: "/repo/src/App.tsx",
      workspaceRoot: "/repo",
      statuses: [{ path: "src/App.tsx", status: "M" }],
    })).toBe("changes");
  });

  it("falls back to file mode for clean files", () => {
    expect(selectSmartLinkCodeViewMode({
      sourcePath: "/repo/src/App.tsx",
      workspaceRoot: "/repo",
      statuses: [{ path: "src/Other.tsx", status: "M" }],
    })).toBe("file");
  });

  it("falls back to file mode for untracked files", () => {
    expect(selectSmartLinkCodeViewMode({
      sourcePath: "/repo/src/New.tsx",
      workspaceRoot: "/repo",
      statuses: [{ path: "src/New.tsx", status: "?" }],
    })).toBe("file");
  });

  it("matches git status paths by suffix when the workspace is below the repo root", () => {
    expect(selectSmartLinkCodeViewMode({
      sourcePath: "/repo/packages/app/src/App.tsx",
      workspaceRoot: "/repo/packages/app",
      statuses: [{ path: "packages/app/src/App.tsx", status: "M" }],
    })).toBe("changes");
  });
});
