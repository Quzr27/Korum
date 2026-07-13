import { describe, expect, it } from "vitest";
import {
  formatCodexPlanType,
  formatRateLimitReachedType,
  getCodexSpendUsedPercent,
  getCodexWindowLabel,
  getExtraUsagePercent,
  hasClaudeUsage,
  hasCodexUsage,
  isUsageRateLimited,
} from "@/lib/usage-limits";
import type { ClaudeUsageResponse, CodexUsageResponse, ExtraUsage } from "@/types";

const EMPTY_OLD_CACHE_SHAPE = {
  five_hour: null,
  seven_day: null,
  seven_day_opus: null,
  seven_day_sonnet: null,
  seven_day_oauth_apps: null,
  extra_usage: null,
  subscription_type: null,
  rate_limit_tier: null,
} satisfies Partial<ClaudeUsageResponse>;

describe("hasClaudeUsage", () => {
  it("does not treat missing new fields from an older cache entry as usage", () => {
    expect(hasClaudeUsage(EMPTY_OLD_CACHE_SHAPE)).toBe(false);
  });

  it("recognizes new Claude usage buckets", () => {
    expect(hasClaudeUsage({
      ...EMPTY_OLD_CACHE_SHAPE,
      seven_day_cowork: { utilization: 12, resets_at: null },
    })).toBe(true);
  });
});

describe("getExtraUsagePercent", () => {
  it("falls back to used credits divided by monthly limit", () => {
    const extra: ExtraUsage = {
      is_enabled: true,
      monthly_limit: 1000,
      used_credits: 152,
      utilization: null,
      currency: "EUR",
      disabled_reason: null,
    };

    expect(getExtraUsagePercent(extra)).toBe(15);
  });
});

describe("isUsageRateLimited", () => {
  it("detects rate-limited IPC errors", () => {
    expect(isUsageRateLimited("RATE_LIMITED")).toBe(true);
    expect(isUsageRateLimited("API returned 500")).toBe(false);
  });
});

describe("Codex usage", () => {
  it("uses the server-provided window duration instead of fixed labels", () => {
    expect(getCodexWindowLabel({ window_duration_minutes: 300 }, "Usage")).toBe("5 hour");
    expect(getCodexWindowLabel({ window_duration_minutes: 10080 }, "Usage")).toBe("Weekly");
    expect(getCodexWindowLabel({ window_duration_minutes: 180 }, "Usage")).toBe("3 hour");
    expect(getCodexWindowLabel({ window_duration_minutes: null }, "Usage")).toBe("Usage");
  });

  it("recognizes additional metadata as visible usage", () => {
    const response: CodexUsageResponse = {
      limits: [{
        limit_id: "codex",
        limit_name: "Codex",
        primary_window: null,
        secondary_window: null,
        credits: { has_credits: true, unlimited: false, balance: "5" },
        individual_limit: null,
        plan_type: "prolite",
        rate_limit_reached_type: null,
      }],
      rate_limit_reset_credits: 2,
    };
    expect(hasCodexUsage(response)).toBe(true);
  });

  it("formats spend, plan, and reached-state metadata", () => {
    expect(getCodexSpendUsedPercent({ limit: "100", used: "25", remaining_percent: 75, resets_at: null })).toBe(25);
    expect(formatCodexPlanType("prolite")).toBe("Pro Lite");
    expect(formatRateLimitReachedType("primary_window")).toBe("Primary Window");
  });
});
