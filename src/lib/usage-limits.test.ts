import { describe, expect, it } from "vitest";
import { getExtraUsagePercent, hasClaudeUsage, isUsageRateLimited } from "@/lib/usage-limits";
import type { ClaudeUsageResponse, ExtraUsage } from "@/types";

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
