import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import ChangedFilesStrip from "@/components/layout/ChangedFilesStrip";
import type { ChangedFileRow } from "@/lib/changed-files";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

async function renderStrip(rows: ChangedFileRow[], onOpenFile = vi.fn()) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });

  await act(async () => {
    root.render(<ChangedFilesStrip rows={rows} onOpenFile={onOpenFile} />);
  });

  return { onOpenFile };
}

afterEach(async () => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) break;
    await act(async () => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("ChangedFilesStrip", () => {
  it("renders compact changed rows and opens each row with its explicit mode", async () => {
    const rows: ChangedFileRow[] = [
      {
        key: "/repo/src/App.tsx",
        absolutePath: "/repo/src/App.tsx",
        displayPath: "src/App.tsx",
        repoRelativePath: "src/App.tsx",
        status: "M",
        insertions: 4,
        deletions: 2,
        openMode: "changes",
      },
      {
        key: "/repo/docs/note.md",
        absolutePath: "/repo/docs/note.md",
        displayPath: "docs/note.md",
        repoRelativePath: "docs/note.md",
        status: "?",
        insertions: 6,
        deletions: 0,
        openMode: "file",
      },
    ];
    const { onOpenFile } = await renderStrip(rows);

    expect(document.body.textContent).toContain("Changed");
    expect(document.body.textContent).toContain("src/App.tsx");
    expect(document.body.textContent).toContain("docs/note.md");

    const appButton = document.querySelector<HTMLButtonElement>("button[aria-label='Open diff for src/App.tsx']");
    const noteButton = document.querySelector<HTMLButtonElement>("button[aria-label='Open file for docs/note.md']");
    if (!appButton || !noteButton) throw new Error("Expected changed-file row buttons");

    await act(async () => {
      appButton.click();
      noteButton.click();
    });

    expect(onOpenFile).toHaveBeenNthCalledWith(1, "/repo/src/App.tsx", "changes");
    expect(onOpenFile).toHaveBeenNthCalledWith(2, "/repo/docs/note.md", "file");
  });
});
