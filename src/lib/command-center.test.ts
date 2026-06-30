import { describe, expect, it } from "vitest";
import {
  filterCommandCenterItems,
  groupCommandCenterItems,
  type CommandCenterItem,
} from "./command-center";

const items: CommandCenterItem[] = [
  {
    id: "action:new-terminal",
    category: "actions",
    title: "New Terminal",
    subtitle: "Create a terminal in the active workspace",
    keywords: ["shell", "pty"],
  },
  {
    id: "file:app",
    category: "files",
    title: "App.tsx",
    subtitle: "src/App.tsx",
    keywords: ["react"],
  },
  {
    id: "window:terminal",
    category: "windows",
    title: "Terminal 1",
    subtitle: "Korum workspace",
    keywords: ["claude", "waiting"],
  },
  {
    id: "workspace:korum",
    category: "workspaces",
    title: "Korum",
    subtitle: "/Users/dominik/Korum",
  },
];

describe("command center search", () => {
  it("ranks title prefix matches before subtitle and keyword matches", () => {
    const result = filterCommandCenterItems(items, "term");

    expect(result.map((item) => item.id)).toEqual([
      "action:new-terminal",
      "window:terminal",
    ]);
  });

  it("matches case-insensitive path fragments across whitespace", () => {
    const result = filterCommandCenterItems(items, "SRC app");

    expect(result.map((item) => item.id)).toEqual(["file:app"]);
  });

  it("uses keywords for agent-aware jump results", () => {
    const result = filterCommandCenterItems(items, "waiting");

    expect(result.map((item) => item.id)).toEqual(["window:terminal"]);
  });

  it("groups filtered results in the command center display order", () => {
    const groups = groupCommandCenterItems(filterCommandCenterItems(items, ""));

    expect(groups.map((group) => group.category)).toEqual([
      "actions",
      "workspaces",
      "windows",
      "files",
    ]);
    expect(groups.map((group) => group.items.map((item) => item.id))).toEqual([
      ["action:new-terminal"],
      ["workspace:korum"],
      ["window:terminal"],
      ["file:app"],
    ]);
  });

  it("limits noisy search result sets after ranking", () => {
    const manyFiles: CommandCenterItem[] = Array.from({ length: 8 }, (_, index) => ({
      id: `file:${index}`,
      category: "files",
      title: `match-${index}.ts`,
    }));

    expect(filterCommandCenterItems(manyFiles, "match", 3)).toHaveLength(3);
  });
});
