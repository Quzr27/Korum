import { describe, expect, it } from "vitest";
import { isWarRoomModalGuardActive, shouldToggleWarRoomShortcut } from "@/lib/war-room-shortcuts";

type ShortcutInit = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">;

function event(init: Partial<ShortcutInit>): ShortcutInit {
  return {
    key: init.key ?? "",
    metaKey: init.metaKey ?? false,
    ctrlKey: init.ctrlKey ?? false,
    shiftKey: init.shiftKey ?? false,
    altKey: init.altKey ?? false,
  };
}

describe("war-room shortcut guard", () => {
  it("toggles on command/control shift M when no modal is open", () => {
    expect(shouldToggleWarRoomShortcut(event({ key: "M", metaKey: true, shiftKey: true }), false)).toBe(true);
    expect(shouldToggleWarRoomShortcut(event({ key: "m", ctrlKey: true, shiftKey: true }), false)).toBe(true);
  });

  it("does not toggle while a modal guard is active", () => {
    expect(shouldToggleWarRoomShortcut(event({ key: "M", metaKey: true, shiftKey: true }), true)).toBe(false);
  });

  it("ignores nearby shortcut chords", () => {
    expect(shouldToggleWarRoomShortcut(event({ key: "M", metaKey: true }), false)).toBe(false);
    expect(shouldToggleWarRoomShortcut(event({ key: "M", shiftKey: true }), false)).toBe(false);
    expect(shouldToggleWarRoomShortcut(event({ key: "M", metaKey: true, shiftKey: true, altKey: true }), false)).toBe(false);
    expect(shouldToggleWarRoomShortcut(event({ key: "?", metaKey: true, shiftKey: true }), false)).toBe(false);
  });

  it("treats sidebar dialogs as modal guards", () => {
    expect(isWarRoomModalGuardActive({
      quitDialogOpen: false,
      shortcutsOpen: false,
      commandCenterOpen: false,
      createDialogOpen: false,
      pasteConfirmOpen: false,
      sidebarModalOpen: true,
    })).toBe(true);
  });

  it("treats the command center as a modal guard", () => {
    expect(isWarRoomModalGuardActive({
      quitDialogOpen: false,
      shortcutsOpen: false,
      commandCenterOpen: true,
      createDialogOpen: false,
      pasteConfirmOpen: false,
      sidebarModalOpen: false,
    })).toBe(true);
  });

  it("treats the snapshot export dialog as a modal guard", () => {
    expect(isWarRoomModalGuardActive({
      quitDialogOpen: false,
      shortcutsOpen: false,
      commandCenterOpen: false,
      createDialogOpen: false,
      pasteConfirmOpen: false,
      sidebarModalOpen: false,
      snapshotExportOpen: true,
    })).toBe(true);
  });
});
