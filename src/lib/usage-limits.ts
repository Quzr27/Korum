import type {
  ClaudeUsageResponse,
  CodexIndividualLimit,
  CodexUsageBucket,
  CodexUsageResponse,
  ExtraUsage,
} from "@/types";

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

export function hasCodexUsage(codex: Partial<CodexUsageResponse> | null): boolean {
  return Boolean(
    typeof codex?.rate_limit_reset_credits === "number"
    || codex?.limits?.some((limit) =>
      limit.primary_window != null
      || limit.secondary_window != null
      || limit.credits?.has_credits === true
      || limit.individual_limit != null
      || limit.plan_type != null
      || limit.rate_limit_reached_type != null,
    ),
  );
}

export function getCodexWindowLabel(
  bucket: Pick<CodexUsageBucket, "window_duration_minutes">,
  fallback: string,
): string {
  const minutes = bucket.window_duration_minutes;
  if (minutes === 300) return "5 hour";
  if (minutes === 1440) return "Daily";
  if (minutes === 10080) return "Weekly";
  if (minutes === 43200) return "Monthly";
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0) return fallback;
  if (minutes % 1440 === 0) return `${String(minutes / 1440)} day`;
  if (minutes % 60 === 0) return `${String(minutes / 60)} hour`;
  return `${String(minutes)} min`;
}

export function getCodexSpendUsedPercent(limit: CodexIndividualLimit): number {
  return Math.round(Math.max(0, Math.min(100, 100 - limit.remaining_percent)));
}

export function formatCodexPlanType(planType: string): string {
  if (planType.toLowerCase() === "prolite") return "Pro Lite";
  return planType
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function formatRateLimitReachedType(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function isUsageRateLimited(error: unknown): boolean {
  return typeof error === "string" && error.includes("RATE_LIMITED");
}
