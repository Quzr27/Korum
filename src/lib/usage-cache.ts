export const USAGE_POLL_INTERVAL = 5 * 60 * 1000;
export const USAGE_BACKOFF_INTERVAL = 10 * 60 * 1000;
// v3: extra_usage fields can be null, new cowork/omelette buckets added.
export const CACHE_KEY_CLAUDE = "korum-usage-claude-v3";
export const CACHE_KEY_CODEX = "korum-usage-codex";

export interface CachedUsage<T> {
  data: T;
  ts: number;
}

function readCacheEntry<T>(key: string): CachedUsage<T> | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;

    const entry = JSON.parse(raw) as Partial<CachedUsage<T>> | null;
    if (
      !entry
      || typeof entry !== "object"
      || !("data" in entry)
      || !Number.isFinite(entry.ts)
    ) return null;

    return entry as CachedUsage<T>;
  } catch {
    return null;
  }
}

export function clearLegacyUsageCache(): void {
  try {
    localStorage.removeItem("korum-usage-claude");
    localStorage.removeItem("korum-usage-claude-v2");
  } catch {
    // noop
  }
}

export function loadCached<T>(key: string): CachedUsage<T> | null {
  return readCacheEntry<T>(key);
}

export function isCacheFresh(key: string): boolean {
  const entry = readCacheEntry<unknown>(key);
  return entry !== null && Date.now() - entry.ts < USAGE_POLL_INTERVAL;
}

export function saveCache<T>(key: string, data: T): void {
  try {
    localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() }));
  } catch {
    // quota exceeded - ignore
  }
}
