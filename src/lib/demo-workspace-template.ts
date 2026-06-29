import type { WindowState, Workspace } from "@/types";
import type { ViewportState } from "./persistence";
import { WINDOW_GRID_GAP } from "./window-snapping";

const SIDEBAR_RIGHT_EDGE = 312;
const TITLEBAR_DRAG_HEIGHT = 40;
const GRID_TOP = TITLEBAR_DRAG_HEIGHT + 4;
const DEMO_VIEWPORT_PAN = 20;
const TERMINAL_WIDTH = 720;
const TERMINAL_HEIGHT = 390;
const NOTE_WIDTH = 340;
const NOTE_HEIGHT = 390;

interface DemoWorkspaceTemplate {
  workspace: Workspace;
  windows: WindowState[];
  viewport: ViewportState;
  nextZ: number;
}

function makeDemoTerminal(
  workspaceId: string,
  id: string,
  title: string,
  x: number,
  y: number,
  zIndex: number,
  demoContent: string[],
  demoStartLabel: string,
  demoStartCommand?: string,
): WindowState {
  return {
    id,
    type: "terminal",
    x,
    y,
    width: TERMINAL_WIDTH,
    height: TERMINAL_HEIGHT,
    zIndex,
    title,
    workspaceId,
    demoContent,
    demoStartLabel,
    demoStartCommand,
  };
}

function makeDemoNote(
  workspaceId: string,
  id: string,
  title: string,
  x: number,
  y: number,
  width: number,
  height: number,
  zIndex: number,
  content: string,
): WindowState {
  return {
    id,
    type: "note",
    x,
    y,
    width,
    height,
    zIndex,
    title,
    workspaceId,
    content,
  };
}

export function createDemoWorkspaceTemplate(): DemoWorkspaceTemplate {
  const workspaceId = crypto.randomUUID();
  const windowId = (name: string) => `${workspaceId}-${name}`;

  const workspace: Workspace = {
    id: workspaceId,
    name: "Multi-agent PR Review",
    color: "cyan",
    icon: "terminal",
  };
  const leftX = SIDEBAR_RIGHT_EDGE;
  const topY = GRID_TOP;
  const secondColumnX = leftX + TERMINAL_WIDTH + WINDOW_GRID_GAP;
  const bottomY = topY + TERMINAL_HEIGHT + WINDOW_GRID_GAP;
  const reviewX = leftX + NOTE_WIDTH + WINDOW_GRID_GAP;
  const queueX = reviewX + TERMINAL_WIDTH + WINDOW_GRID_GAP;

  const windows: WindowState[] = [
    makeDemoTerminal(workspaceId, windowId("claude"), "Claude: implementation", leftX, topY, 1, [
      "$ claude --continue pr-review",
      "Reading docs/research/2026-06-28-korum-competitive-research.md",
      "Plan: add guided demo workspace, keep shells untouched",
      "Status: working - wiring template generator",
      "",
      "Next: hand off changed files to review pass",
    ], "Start Claude", "claude"),
    makeDemoTerminal(workspaceId, windowId("codex"), "Codex: test + typecheck", secondColumnX, topY, 2, [
      "$ bun run typecheck",
      "src/lib/demo-workspace-template.ts: OK",
      "",
      "$ bun run test src/lib/demo-workspace-template.test.ts",
      "2 tests passed",
      "",
      "Status: waiting - review generated layout",
    ], "Start Codex", "codex"),
    makeDemoTerminal(workspaceId, windowId("review"), "Review: diff pass", reviewX, bottomY, 3, [
      "$ git diff --stat",
      " src/App.tsx                         | 42 +++++++++++++++++",
      " src/components/canvas/TerminalWindow.tsx | 31 +++++++++++++",
      " src/lib/demo-workspace-template.ts  | 96 +++++++++++++++++++++++++++++",
      "",
      "Decision: keep demo terminals static, no PTY spawn",
    ], "Start terminal"),
    makeDemoNote(
      workspaceId,
      windowId("brief"),
      "Workflow brief",
      leftX,
      bottomY,
      NOTE_WIDTH,
      NOTE_HEIGHT,
      4,
      [
        "## Demo workspace",
        "",
        "This board shows how Korum keeps parallel AI coding work visible without turning into an IDE or cloud orchestrator.",
        "",
        "- Implementation agent on the left",
        "- Test/typecheck agent on the right",
        "- Review pass below with a diff summary",
        "",
        "Everything here is static demo content. No shell commands are running.",
      ].join("\n"),
    ),
    makeDemoNote(
      workspaceId,
      windowId("queue"),
      "Review queue",
      queueX,
      bottomY,
      NOTE_WIDTH,
      NOTE_HEIGHT,
      5,
      [
        "## Changed files",
        "",
        "- `src/App.tsx` - demo workspace action",
        "- `src/components/canvas/TerminalWindow.tsx` - static terminal preview",
        "- `src/lib/demo-workspace-template.ts` - reusable template seed",
        "- `src/lib/persisted-state.ts` - safe hydration",
        "",
        "## Decisions",
        "",
        "- Keep demo local and privacy-safe",
        "- Do not auto-run commands",
        "- Add code/diff sample windows later",
      ].join("\n"),
    ),
  ];

  return {
    workspace,
    windows,
    viewport: { panX: DEMO_VIEWPORT_PAN, panY: DEMO_VIEWPORT_PAN, zoom: 1 },
    nextZ: windows.length + 1,
  };
}
