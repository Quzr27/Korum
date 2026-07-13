import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CACHE_KEY_CODEX,
  USAGE_POLL_INTERVAL,
  clearLegacyUsageCache,
  isCacheFresh,
  loadCached,
  saveCache,
} from "@/lib/usage-cache";

describe("usage cache", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it("uses the multi-limit Codex cache version and clears the old shape", () => {
    localStorage.setItem("korum-usage-codex", "legacy");
    clearLegacyUsageCache();

    expect(CACHE_KEY_CODEX).toBe("korum-usage-codex-v2");
    expect(localStorage.getItem("korum-usage-codex")).toBeNull();
  });

  it("keeps each provider cache fresh for the shared five-minute cadence", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T08:00:00Z"));
    saveCache(CACHE_KEY_CODEX, { limits: [] });

    expect(loadCached(CACHE_KEY_CODEX)?.data).toEqual({ limits: [] });
    expect(isCacheFresh(CACHE_KEY_CODEX)).toBe(true);
    vi.advanceTimersByTime(USAGE_POLL_INTERVAL);
    expect(isCacheFresh(CACHE_KEY_CODEX)).toBe(false);
  });
});
