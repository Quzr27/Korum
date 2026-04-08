import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { useSettings } from "@/lib/settings-context";
import type {
  ClaudeUsageResponse,
  CodexUsageResponse,
  UsageBucket,
} from "@/types";

const POLL_INTERVAL = 5 * 60 * 1000; // 5 minutes
const BACKOFF_INTERVAL = 10 * 60 * 1000; // 10 minutes after 429
const CACHE_KEY_CLAUDE = "korum-usage-claude";
const CACHE_KEY_CODEX = "korum-usage-codex";

// Module-level state survives component remount (toggle off/on)
let claudeBackoffUntil = 0;
let fetchInFlight = false;

function loadCached<T>(key: string): { data: T; ts: number } | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as { data: T; ts: number };
    return entry.data ? entry : null;
  } catch {
    return null;
  }
}

function isCacheFresh(key: string): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    const entry = JSON.parse(raw) as { ts: number };
    return Date.now() - entry.ts < POLL_INTERVAL;
  } catch {
    return false;
  }
}

function saveCache(key: string, data: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() }));
  } catch { /* quota exceeded — ignore */ }
}

function formatTimeUntil(isoString: string): string {
  const ms = new Date(isoString).getTime() - Date.now();
  if (!Number.isFinite(ms)) return "?";
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
          <span className="truncate text-[9px] text-muted-foreground/50">{reset}</span>
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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/58">
      {children}
    </span>
  );
}

function isRateLimited(error: unknown): boolean {
  return typeof error === "string" && error.includes("RATE_LIMITED");
}

export default function UsageLimitsCard() {
  const { settings } = useSettings();
  const [claude, setClaude] = useState<ClaudeUsageResponse | null>(
    () => loadCached<ClaudeUsageResponse>(CACHE_KEY_CLAUDE)?.data ?? null,
  );
  const [codex, setCodex] = useState<CodexUsageResponse | null>(
    () => loadCached<CodexUsageResponse>(CACHE_KEY_CODEX)?.data ?? null,
  );
  const mountedRef = useRef(false);

  const fetchAll = useCallback(async () => {
    if (fetchInFlight) return;
    fetchInFlight = true;
    try {
      const now = Date.now();

      // Claude: skip if cache fresh OR in backoff window
      const skipClaude = isCacheFresh(CACHE_KEY_CLAUDE) || now < claudeBackoffUntil;
      const claudePromise = skipClaude
        ? Promise.resolve(null)
        : invoke<ClaudeUsageResponse>("fetch_claude_usage").catch((err: unknown) => {
            if (isRateLimited(err)) {
              claudeBackoffUntil = Date.now() + BACKOFF_INTERVAL;
            }
            return null;
          });

      // Codex: skip if cache fresh
      const codexPromise = isCacheFresh(CACHE_KEY_CODEX)
        ? Promise.resolve(null)
        : invoke<CodexUsageResponse>("fetch_codex_usage").catch(() => null);

      const [claudeResult, codexResult] = await Promise.all([claudePromise, codexPromise]);
      if (!mountedRef.current) return;

      if (claudeResult) {
        setClaude(claudeResult);
        saveCache(CACHE_KEY_CLAUDE, claudeResult);
      }
      if (codexResult) {
        setCodex(codexResult);
        saveCache(CACHE_KEY_CODEX, codexResult);
      }
    } finally {
      fetchInFlight = false;
    }
  }, []);

  useEffect(() => {
    if (!settings.showUsageLimits) return;
    mountedRef.current = true;

    void fetchAll();
    const id = setInterval(() => void fetchAll(), POLL_INTERVAL);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [settings.showUsageLimits, fetchAll]);

  const hasClaude = claude && (claude.five_hour ?? claude.seven_day);
  const hasCodex = codex && (codex.primary_window ?? codex.secondary_window);

  if (!settings.showUsageLimits || (!hasClaude && !hasCodex)) return null;

  return (
    <Card
      role="status"
      aria-label="Usage limits"
      size="sm"
      className="glass-subtle fixed top-3 right-3 z-40 w-44 select-none border-none! gap-2.5 rounded-xl py-2.5 shadow-lg shadow-black/8"
    >
      <CardContent className="flex flex-col gap-2.5">
        {hasClaude ? (
          <div className="flex flex-col gap-2">
            <SectionLabel>Claude</SectionLabel>
            {claude.five_hour ? (
              <UsageRow label="Session" bucket={claude.five_hour} />
            ) : null}
            {claude.seven_day ? (
              <UsageRow label="Weekly" bucket={claude.seven_day} />
            ) : null}
            {claude.seven_day_sonnet ? (
              <UsageRow label="Sonnet" bucket={claude.seven_day_sonnet} />
            ) : null}
          </div>
        ) : null}

        {hasClaude && hasCodex ? (
          <Separator className="bg-border/45" />
        ) : null}

        {hasCodex ? (
          <div className="flex flex-col gap-2">
            <SectionLabel>Codex</SectionLabel>
            {codex.primary_window ? (
              <UsageRow label="Session" bucket={codex.primary_window} />
            ) : null}
            {codex.secondary_window ? (
              <UsageRow label="Weekly" bucket={codex.secondary_window} />
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
