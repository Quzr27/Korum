import { describe, expect, it } from "vitest";
import {
  getAgentStatusMap,
  mergeAgentStatusesIntoStore,
  removeAgentStatusFromStore,
} from "@/lib/agent-status-store";
import type { AgentStatus } from "@/types";

function status(terminalId: string, activity: AgentStatus["activity"]): AgentStatus {
  return { terminalId, kind: "claude", activity, source: "claude-json", updatedAt: 1 };
}

describe("agent status store", () => {
  it("merges statuses into the shared map and updates on later activity changes", () => {
    mergeAgentStatusesIntoStore([status("store-a", "working"), status("store-b", "waiting")]);
    const map = getAgentStatusMap();
    expect(map.get("store-a")?.activity).toBe("working");
    expect(map.get("store-b")?.activity).toBe("waiting");

    mergeAgentStatusesIntoStore([status("store-a", "idle")]);
    expect(getAgentStatusMap().get("store-a")?.activity).toBe("idle");

    removeAgentStatusFromStore("store-a");
    removeAgentStatusFromStore("store-b");
    expect(getAgentStatusMap().has("store-a")).toBe(false);
    expect(getAgentStatusMap().has("store-b")).toBe(false);
  });
});
