import type { TerminalWindow } from "@/types";

interface DemoTerminalActivation {
  window: TerminalWindow;
  startCommand?: string;
}

export function activateDemoTerminalWindow(window: TerminalWindow): DemoTerminalActivation {
  const {
    demoContent: _demoContent,
    demoStartLabel: _demoStartLabel,
    demoStartCommand,
    ptyId: _ptyId,
    ...liveWindow
  } = window;
  const trimmedCommand = demoStartCommand?.trim();

  return {
    window: liveWindow,
    startCommand: trimmedCommand ? trimmedCommand : undefined,
  };
}
