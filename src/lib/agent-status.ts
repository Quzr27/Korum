import type { AgentActivity, AgentStatus } from "@/types";

export const AGENT_STATUS_CHANGED_EVENT = "korum://agent-status-changed";

const ACTIVITY_CSS_VARS: Record<AgentActivity, string> = {
  working: "var(--agent-status-working)",
  waiting: "var(--agent-status-waiting)",
  idle: "var(--agent-status-idle)",
  unknown: "var(--agent-status-unknown)",
};

const ACTIVITY_STRONG_CSS_VARS: Record<AgentActivity, string> = {
  working: "var(--agent-status-working-strong)",
  waiting: "var(--agent-status-waiting-strong)",
  idle: "var(--agent-status-idle-strong)",
  unknown: "var(--agent-status-unknown-strong)",
};

const WAR_ROOM_PULSE_CLASS_BY_ACTIVITY: Record<AgentActivity, string> = {
  working: "agent-war-room-pulse--working",
  waiting: "agent-war-room-pulse--waiting",
  idle: "",
  unknown: "",
};

export const AGENT_WAR_ROOM_PULSE_CLASSES = Object.values(WAR_ROOM_PULSE_CLASS_BY_ACTIVITY).filter(Boolean);

export function getAgentActivityDataValue(status: AgentStatus | undefined): AgentActivity {
  return status?.activity ?? "unknown";
}

export function getAgentActivityCssVar(activity: AgentActivity | undefined): string {
  return ACTIVITY_CSS_VARS[activity ?? "unknown"];
}

export function getAgentActivityStrongCssVar(activity: AgentActivity | undefined): string {
  return ACTIVITY_STRONG_CSS_VARS[activity ?? "unknown"];
}

export function getAgentMinimapPaint(status: AgentStatus | undefined): { fill: string; stroke: string } {
  const activity = status?.activity ?? "unknown";
  return {
    fill: getAgentActivityCssVar(activity),
    stroke: getAgentActivityStrongCssVar(activity),
  };
}

export function getAgentWarRoomPulseClass(activity: AgentActivity | undefined): string {
  return WAR_ROOM_PULSE_CLASS_BY_ACTIVITY[activity ?? "unknown"];
}
