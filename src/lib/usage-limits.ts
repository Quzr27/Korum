import type { ClaudeUsageResponse, ExtraUsage } from "@/types";

type PartialClaudeUsageResponse = Partial<ClaudeUsageResponse> | null;

export function getExtraUsagePercent(extra: ExtraUsage): number | null {
  if (typeof extra.utilization === "number" && Number.isFinite(extra.utilization)) {
    return Math.round(extra.utilization);
  }
  if (
    typeof extra.used_credits === "number" &&
    Number.isFinite(extra.used_credits) &&
    typeof extra.monthly_limit === "number" &&
    Number.isFinite(extra.monthly_limit) &&
    extra.monthly_limit > 0
  ) {
    return Math.round((extra.used_credits / extra.monthly_limit) * 100);
  }
  return null;
}

export function hasClaudeUsage(claude: PartialClaudeUsageResponse): boolean {
  return Boolean(
    claude &&
    (claude.five_hour != null ||
      claude.seven_day != null ||
      claude.seven_day_opus != null ||
      claude.seven_day_sonnet != null ||
      claude.seven_day_oauth_apps != null ||
      claude.seven_day_omelette != null ||
      claude.seven_day_cowork != null ||
      claude.extra_usage?.is_enabled === true),
  );
}

export function isUsageRateLimited(error: unknown): boolean {
  return typeof error === "string" && error.includes("RATE_LIMITED");
}
