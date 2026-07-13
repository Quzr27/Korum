import { StrictMode, act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import UsageLimitsCard from "@/components/layout/UsageLimitsCard";
import { CACHE_KEY_CODEX, USAGE_POLL_INTERVAL } from "@/lib/usage-cache";
import type { ClaudeUsageResponse, CodexUsageResponse } from "@/types";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@/lib/settings-context", () => ({
  useSettings: () => ({ settings: { showUsageLimits: true } }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const emptyClaude: ClaudeUsageResponse = {
  five_hour: null,
  seven_day: null,
  seven_day_opus: null,
  seven_day_sonnet: null,
  seven_day_oauth_apps: null,
  seven_day_omelette: null,
  seven_day_cowork: null,
  extra_usage: null,
  subscription_type: null,
  rate_limit_tier: null,
};

const codexUsage: CodexUsageResponse = {
  limits: [{
    limit_id: "codex",
    limit_name: null,
    primary_window: {
      utilization: 14,
      resets_at: "2026-07-20T08:00:00Z",
      window_duration_minutes: 10080,
    },
    secondary_window: null,
    credits: null,
    individual_limit: null,
    plan_type: "prolite",
    rate_limit_reached_type: null,
  }],
  rate_limit_reset_credits: 2,
};

async function renderCard() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<StrictMode><UsageLimitsCard /></StrictMode>);
  });
}

beforeEach(() => {
  localStorage.clear();
  invokeMock.mockReset();
});

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
  }
  root = null;
  container?.remove();
  container = null;
  document.body.replaceChildren();
});

describe("UsageLimitsCard polling", () => {
  it("shares each provider request across StrictMode effects and renders the result", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "fetch_claude_usage") return Promise.resolve(emptyClaude);
      if (command === "fetch_codex_usage") return Promise.resolve(codexUsage);
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });

    await renderCard();
    await act(async () => Promise.resolve());

    expect(invokeMock.mock.calls.filter(([command]) => command === "fetch_claude_usage")).toHaveLength(1);
    expect(invokeMock.mock.calls.filter(([command]) => command === "fetch_codex_usage")).toHaveLength(1);
    expect(document.body.textContent).toContain("Weekly");
    expect(document.body.textContent).toContain("Resets2");
    expect(document.body.textContent).toContain("Pro Lite");
  });

  it("keeps stale Codex usage visible when a refresh fails", async () => {
    localStorage.setItem(CACHE_KEY_CODEX, JSON.stringify({
      data: codexUsage,
      ts: Date.now() - USAGE_POLL_INTERVAL - 1,
    }));
    invokeMock.mockImplementation((command: string) => command === "fetch_claude_usage"
      ? Promise.resolve(emptyClaude)
      : Promise.reject(new Error("app-server unavailable")));

    await renderCard();
    await act(async () => Promise.resolve());

    expect(document.body.textContent).toContain("Weekly");
    expect(document.body.textContent).toContain("14%");
  });
});
