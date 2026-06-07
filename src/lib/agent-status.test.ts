import { describe, expect, it } from "vitest";
import {
  getAgentActivityCssVar,
  getAgentActivityDataValue,
  getAgentMinimapPaint,
  getAgentWarRoomPulseClass,
} from "@/lib/agent-status";
import type { AgentStatus } from "@/types";

describe("agent status presentation", () => {
  it("maps activity to semantic CSS variables", () => {
    expect(getAgentActivityCssVar("working")).toBe("var(--agent-status-working)");
    expect(getAgentActivityCssVar("waiting")).toBe("var(--agent-status-waiting)");
    expect(getAgentActivityCssVar("idle")).toBe("var(--agent-status-idle)");
    expect(getAgentActivityCssVar("unknown")).toBe("var(--agent-status-unknown)");
    expect(getAgentActivityCssVar(undefined)).toBe("var(--agent-status-unknown)");
  });

  it("uses unknown as the stable DOM data value when status is absent", () => {
    expect(getAgentActivityDataValue(undefined)).toBe("unknown");
    expect(getAgentActivityDataValue({
      terminalId: "term-1",
      kind: "codex",
      activity: "waiting",
      source: "scrollback",
      updatedAt: 1,
    })).toBe("waiting");
  });

  it("returns minimap paint tokens for terminal statuses", () => {
    const status: AgentStatus = {
      terminalId: "term-1",
      kind: "claude",
      activity: "working",
      source: "claude-json",
      updatedAt: 1,
    };

    expect(getAgentMinimapPaint(status)).toEqual({
      fill: "var(--agent-status-working)",
      stroke: "var(--agent-status-working-strong)",
    });
  });

  it("maps activities to war-room pulse classes", () => {
    expect(getAgentWarRoomPulseClass("working")).toBe("agent-war-room-pulse--working");
    expect(getAgentWarRoomPulseClass("waiting")).toBe("agent-war-room-pulse--waiting");
    expect(getAgentWarRoomPulseClass("idle")).toBe("");
    expect(getAgentWarRoomPulseClass("unknown")).toBe("");
    expect(getAgentWarRoomPulseClass(undefined)).toBe("");
  });
});
