import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

interface ShortcutsOverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SHORTCUT_GROUPS = [
  {
    label: "Terminal",
    shortcuts: [
      { keys: ["\u21E7", "\u23CE"], description: "Line feed (newline)" },
    ],
  },
  {
    label: "Canvas",
    shortcuts: [
      { keys: ["\u2318", "Scroll"], description: "Zoom in / out" },
      { keys: ["Drag"], description: "Pan canvas" },
      { keys: ["Middle Drag"], description: "Pan canvas (alt)" },
      { keys: ["Double-click"], description: "New terminal (on background)" },
    ],
  },
  {
    label: "General",
    shortcuts: [
      { keys: ["\u2318", "N"], description: "New terminal" },
      { keys: ["\u2318", "\u21E7", "N"], description: "New note" },
      { keys: ["\u2318", "W"], description: "Close active window" },
      { keys: ["\u2318", "\u21E7", "A"], description: "Arrange in grid" },
      { keys: ["\u2318", "\u21E7", "W"], description: "New workspace" },
      { keys: ["\u2318", "\u21E7", "?"], description: "Keyboard shortcuts" },
    ],
  },
] as const;

export default function ShortcutsOverlay({ open, onOpenChange }: ShortcutsOverlayProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-lg">
        <DialogHeader>
          <div className="flex flex-col gap-1 px-5 pt-5 pb-4">
            <DialogTitle>Keyboard Shortcuts</DialogTitle>
            <DialogDescription>
              Use these to create windows, move around the canvas, and reopen this sheet fast.
            </DialogDescription>
          </div>
        </DialogHeader>

        <Separator />

        <ScrollArea className="max-h-[calc(100vh-12rem)]">
        <div className="flex flex-col px-5 py-4 gap-5">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.label} className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {group.label}
              </span>
              <div className="flex flex-col gap-0.5">
                {group.shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.description}
                    className="flex items-center justify-between rounded-md px-2 py-1.5 transition-colors hover:bg-accent/35"
                  >
                    <span className="text-sm text-foreground/88">
                      {shortcut.description}
                    </span>
                    <div className="flex items-center gap-1">
                      {shortcut.keys.map((key, i) => (
                        <kbd
                          key={`${shortcut.description}-${key}-${i}`}
                          className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-border/70 bg-background/70 px-1.5 text-[11px] font-medium text-muted-foreground shadow-xs"
                        >
                          {key}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
