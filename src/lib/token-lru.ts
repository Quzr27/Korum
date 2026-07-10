/**
 * Byte-budgeted LRU cache for tokenization results.
 *
 * Code windows re-tokenize their full content on every viewport re-entry and
 * on every watcher-driven re-read — for a large file that is tens to hundreds
 * of milliseconds of main-thread work per window. Caching by content keeps
 * remounts and unchanged-content refreshes free. The budget is expressed in
 * an estimated heap weight supplied by the caller, so object-heavy values can
 * be bounded more accurately than their source payload alone.
 */

export interface TokenLRU<V> {
  get(key: string): V | undefined;
  set(key: string, value: V, bytes: number): void;
  readonly size: number;
  readonly bytes: number;
}

interface TokenCacheWeightToken {
  content: string;
  color?: string;
}

const JS_CHAR_BYTES = 2;
const ARRAY_OVERHEAD_BYTES = 32;
const ARRAY_SLOT_BYTES = 8;
const TOKEN_OBJECT_OVERHEAD_BYTES = 64;

/**
 * Estimate the retained JS heap for a Shiki token result plus its source-based
 * cache key. The estimate intentionally favors a stable upper bound over
 * engine-specific precision: token objects and nested arrays dominate dense
 * syntax-highlighted files, while UTF-16 string storage accounts for both the
 * source key and token/color strings created by structured cloning.
 */
export function estimateTokenCacheBytes(
  cacheKey: string,
  lines: readonly (readonly TokenCacheWeightToken[])[],
): number {
  let bytes = cacheKey.length * JS_CHAR_BYTES
    + ARRAY_OVERHEAD_BYTES
    + lines.length * ARRAY_SLOT_BYTES;

  for (const line of lines) {
    bytes += ARRAY_OVERHEAD_BYTES + line.length * ARRAY_SLOT_BYTES;
    for (const token of line) {
      bytes += TOKEN_OBJECT_OVERHEAD_BYTES;
      bytes += token.content.length * JS_CHAR_BYTES;
      if (token.color) bytes += token.color.length * JS_CHAR_BYTES;
    }
  }

  return bytes;
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
