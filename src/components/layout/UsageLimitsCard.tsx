import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { useSettings } from "@/lib/settings-context";
import {
  CACHE_KEY_CLAUDE,
  CACHE_KEY_CODEX,
  USAGE_BACKOFF_INTERVAL,
  USAGE_POLL_INTERVAL,
  clearLegacyUsageCache,
  isCacheFresh,
  loadCached,
  saveCache,
} from "@/lib/usage-cache";
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
import type {
  ClaudeUsageResponse,
  CodexUsageLimit,
  CodexUsageResponse,
  ExtraUsage,
  UsageBucket,
} from "@/types";

// One-time cleanup of the pre-v2 key so it doesn't sit orphaned in localStorage forever.
clearLegacyUsageCache();

// Module-level state survives component remount (toggle off/on)
let claudeBackoffUntil = 0;
let codexBackoffUntil = 0;
let claudeFetchInFlight: Promise<ClaudeUsageResponse> | null = null;
let codexFetchInFlight: Promise<CodexUsageResponse> | null = null;

function formatTimeUntil(isoString: string | null | undefined): string {
  if (!isoString) return "";
  const ms = new Date(isoString).getTime() - Date.now();
  if (!Number.isFinite(ms)) return "";
  if (ms <= 0) return "now";
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const rh = hours % 24;
    return `${String(days)}d ${String(rh)}h`;
  }
  return hours > 0 ? `${String(hours)}h ${String(minutes)}m` : `${String(minutes)}m`;
}

function UsageRow({
  label,
  bucket,
}: {
  label: string;
  bucket: UsageBucket;
}) {
  const pct = Math.round(bucket.utilization);
  const reset = formatTimeUntil(bucket.resets_at);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate text-[11px] text-foreground/82">{label}</span>
          {reset ? (
            <span className="truncate text-[9px] text-muted-foreground/50">{reset}</span>
          ) : null}
        </div>
        <span className="shrink-0 tabular-nums text-[10px] text-foreground/68">{pct}%</span>
      </div>
      <Progress
        value={Math.min(pct, 100)}
        className="h-1 bg-primary/10 dark:bg-primary/12 [&_[data-slot=progress-indicator]]:bg-primary/60 dark:[&_[data-slot=progress-indicator]]:bg-primary/45"
        aria-label={`${label} ${pct}%`}
      />
    </div>
  );
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  EUR: "€",
  USD: "$",
  GBP: "£",
};

function formatCreditValue(value: number | null | undefined, currency: string | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  const symbol = currency ? CURRENCY_SYMBOLS[currency] ?? currency : "";
  return `${symbol}${value.toFixed(0)}`;
}

function ExtraUsageRow({ extra }: { extra: ExtraUsage }) {
  const pct = getExtraUsagePercent(extra);
  const limit = typeof extra.monthly_limit === "number" && Number.isFinite(extra.monthly_limit)
    ? formatCreditValue(extra.monthly_limit, extra.currency)
    : "Unlimited";
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate text-[11px] text-foreground/82">Credits</span>
          <span className="truncate text-[9px] text-muted-foreground/50">
            {formatCreditValue(extra.used_credits, extra.currency)}
            /{limit}
          </span>
        </div>
        <span className="shrink-0 tabular-nums text-[10px] text-foreground/68">
          {pct === null ? "-" : `${pct}%`}
        </span>
      </div>
      <Progress
        value={pct === null ? 0 : Math.min(pct, 100)}
        className="h-1 bg-primary/10 dark:bg-primary/12 [&_[data-slot=progress-indicator]]:bg-primary/60 dark:[&_[data-slot=progress-indicator]]:bg-primary/45"
        aria-label={pct === null ? "Credits" : `Credits ${pct}%`}
      />
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/58">
      {children}
    </span>
  );
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-[10px]">
      <span className="truncate text-foreground/68">{label}</span>
      <span className="shrink-0 truncate text-right text-muted-foreground/62">{value}</span>
    </div>
  );
}

function CodexLimitRows({ limit, showName }: { limit: CodexUsageLimit; showName: boolean }) {
  const spend = limit.individual_limit;
  const spendPercent = spend ? getCodexSpendUsedPercent(spend) : null;
  const credits = limit.credits;
  return (
    <div className="flex flex-col gap-2">
      {showName ? (
        <span className="truncate text-[10px] font-medium text-foreground/70">
          {limit.limit_name ?? limit.limit_id ?? "Additional limit"}
        </span>
      ) : null}
      {limit.primary_window ? (
        <UsageRow
          label={getCodexWindowLabel(limit.primary_window, "Usage")}
          bucket={limit.primary_window}
        />
      ) : null}
      {limit.secondary_window ? (
        <UsageRow
          label={getCodexWindowLabel(limit.secondary_window, "Secondary")}
          bucket={limit.secondary_window}
        />
      ) : null}
      {spend && spendPercent !== null ? (
        <div className="flex flex-col gap-1">
          <MetadataRow label="Spend" value={`${spend.used}/${spend.limit}`} />
          <Progress
            value={spendPercent}
            className="h-1 bg-primary/10 dark:bg-primary/12 [&_[data-slot=progress-indicator]]:bg-primary/60 dark:[&_[data-slot=progress-indicator]]:bg-primary/45"
            aria-label={`Spend ${String(spendPercent)}%`}
          />
        </div>
      ) : null}
      {credits?.has_credits ? (
        <MetadataRow
          label="Credits"
          value={credits.unlimited ? "Unlimited" : credits.balance ?? "Available"}
        />
      ) : null}
      {limit.rate_limit_reached_type ? (
        <MetadataRow
          label="Limit reached"
          value={formatRateLimitReachedType(limit.rate_limit_reached_type)}
        />
      ) : null}
    </div>
  );
}

export default function UsageLimitsCard() {
  const { settings } = useSettings();
  const [claude, setClaude] = useState<ClaudeUsageResponse | null>(
    () => loadCached<ClaudeUsageResponse>(CACHE_KEY_CLAUDE)?.data ?? null,
  );
  const [codex, setCodex] = useState<CodexUsageResponse | null>(
    () => loadCached<CodexUsageResponse>(CACHE_KEY_CODEX)?.data ?? null,
  );

  useEffect(() => {
    if (!settings.showUsageLimits) return;
    // Per-effect `alive` flag — survives rapid toggle without the cross-instance
    // races that a useRef mountedRef would have under module-level fetchInFlight.
    let alive = true;

    const fetchClaude = async () => {
      if (isCacheFresh(CACHE_KEY_CLAUDE) || Date.now() < claudeBackoffUntil) return;
      const request = claudeFetchInFlight ?? invoke<ClaudeUsageResponse>("fetch_claude_usage");
      claudeFetchInFlight = request;
      try {
        const result = await request;
        saveCache(CACHE_KEY_CLAUDE, result);
        if (alive) setClaude(result);
      } catch (error) {
        if (isUsageRateLimited(error)) claudeBackoffUntil = Date.now() + USAGE_BACKOFF_INTERVAL;
      } finally {
        if (claudeFetchInFlight === request) claudeFetchInFlight = null;
      }
    };

    const fetchCodex = async () => {
      if (isCacheFresh(CACHE_KEY_CODEX) || Date.now() < codexBackoffUntil) return;
      const request = codexFetchInFlight ?? invoke<CodexUsageResponse>("fetch_codex_usage");
      codexFetchInFlight = request;
      try {
        const result = await request;
        saveCache(CACHE_KEY_CODEX, result);
        if (alive) setCodex(result);
      } catch (error) {
        if (isUsageRateLimited(error)) codexBackoffUntil = Date.now() + USAGE_BACKOFF_INTERVAL;
      } finally {
        if (codexFetchInFlight === request) codexFetchInFlight = null;
      }
    };

    const fetchAll = () => {
      void fetchClaude();
      void fetchCodex();
    };

    fetchAll();
    const id = setInterval(fetchAll, USAGE_POLL_INTERVAL);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [settings.showUsageLimits]);

  const hasClaude = hasClaudeUsage(claude);
  const hasCodex = hasCodexUsage(codex);

  if (!settings.showUsageLimits || (!hasClaude && !hasCodex)) return null;

  return (
    <Card
      role="status"
      aria-label="Usage limits"
      data-snapshot-usage-card="true"
      size="sm"
      className="app-chrome-top glass-subtle fixed right-3 z-40 w-44 select-none border-none! gap-2.5 rounded-xl py-2.5 shadow-lg shadow-black/8"
    >
      <CardContent className="flex flex-col gap-2.5">
        {hasClaude && claude ? (
          <div className="flex flex-col gap-2">
            <SectionLabel>Claude</SectionLabel>
            {claude.five_hour ? (
              <UsageRow label="Session" bucket={claude.five_hour} />
            ) : null}
            {claude.seven_day ? (
              <UsageRow label="Weekly" bucket={claude.seven_day} />
            ) : null}
            {claude.seven_day_opus ? (
              <UsageRow label="Opus" bucket={claude.seven_day_opus} />
            ) : null}
            {claude.seven_day_sonnet ? (
              <UsageRow label="Sonnet" bucket={claude.seven_day_sonnet} />
            ) : null}
            {claude.seven_day_oauth_apps ? (
              <UsageRow label="OAuth apps" bucket={claude.seven_day_oauth_apps} />
            ) : null}
            {claude.seven_day_omelette ? (
              <UsageRow label="Design" bucket={claude.seven_day_omelette} />
            ) : null}
            {claude.seven_day_cowork ? (
              <UsageRow label="Cowork" bucket={claude.seven_day_cowork} />
            ) : null}
            {claude.extra_usage?.is_enabled ? (
              <ExtraUsageRow extra={claude.extra_usage} />
            ) : null}
          </div>
        ) : null}

        {hasClaude && claude && hasCodex ? (
          <Separator className="bg-border/45" />
        ) : null}

        {hasCodex ? (
          <div className="flex flex-col gap-2">
            <SectionLabel>Codex</SectionLabel>
            {codex?.limits.map((limit, index) => (
              <CodexLimitRows
                key={limit.limit_id ?? `${limit.limit_name ?? "limit"}-${String(index)}`}
                limit={limit}
                showName={index > 0}
              />
            ))}
            {typeof codex?.rate_limit_reset_credits === "number" ? (
              <MetadataRow label="Resets" value={String(codex.rate_limit_reset_credits)} />
            ) : null}
            {codex?.limits[0]?.plan_type ? (
              <MetadataRow label="Plan" value={formatCodexPlanType(codex.limits[0].plan_type)} />
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
