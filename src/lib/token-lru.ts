/**
 * Byte-budgeted LRU cache for tokenization results.
 *
 * Code windows re-tokenize their full content on every viewport re-entry and
 * on every watcher-driven re-read — for a large file that is tens to hundreds
 * of milliseconds of main-thread work per window. Caching by content keeps
 * remounts and unchanged-content refreshes free. The budget is expressed in
 * bytes of *source content* (token arrays scale roughly proportionally), so
 * a handful of large files cannot grow the cache without bound.
 */

export interface TokenLRU<V> {
  get(key: string): V | undefined;
  set(key: string, value: V, bytes: number): void;
  readonly size: number;
  readonly bytes: number;
}

export function createTokenLRU<V>(maxBytes: number): TokenLRU<V> {
  const entries = new Map<string, { value: V; bytes: number }>();
  let totalBytes = 0;

  return {
    get(key: string): V | undefined {
      const entry = entries.get(key);
      if (!entry) return undefined;
      // Refresh recency — Map iteration order is insertion order.
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },

    set(key: string, value: V, bytes: number): void {
      // An entry larger than the whole budget would evict everything and
      // still not fit — don't cache it at all.
      if (bytes > maxBytes) return;

      const existing = entries.get(key);
      if (existing) {
        totalBytes -= existing.bytes;
        entries.delete(key);
      }

      entries.set(key, { value, bytes });
      totalBytes += bytes;

      for (const [oldestKey, oldest] of entries) {
        if (totalBytes <= maxBytes) break;
        if (oldestKey === key) break; // never evict the entry just added
        entries.delete(oldestKey);
        totalBytes -= oldest.bytes;
      }
    },

    get size() {
      return entries.size;
    },

    get bytes() {
      return totalBytes;
    },
  };
}
