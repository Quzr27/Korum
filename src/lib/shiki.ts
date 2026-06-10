import { createHighlighter, type BundledLanguage, type BundledTheme, type Highlighter, type ThemedToken } from "shiki";
import { createTokenLRU } from "./token-lru";

let highlighterPromise: Promise<Highlighter> | null = null;
const loadedLangs = new Set<string>();
const loadingLangs = new Map<string, Promise<boolean>>();
const loadedThemes = new Set<string>();
const loadingThemes = new Map<string, Promise<boolean>>();

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-dark"],
      langs: [],
    }).then((hl) => {
      loadedThemes.add("github-dark");
      return hl;
    }).catch((err) => {
      highlighterPromise = null;
      throw err;
    });
  }
  return highlighterPromise;
}

/** Ensure a language is loaded, deduplicating concurrent calls. */
async function ensureLanguage(hl: Highlighter, lang: string): Promise<boolean> {
  if (loadedLangs.has(lang)) return true;

  let promise = loadingLangs.get(lang);
  if (!promise) {
    promise = hl
      .loadLanguage(lang as BundledLanguage)
      .then(() => { loadedLangs.add(lang); return true; })
      .catch(() => false)
      .finally(() => loadingLangs.delete(lang));
    loadingLangs.set(lang, promise);
  }

  return promise;
}

/** Ensure a theme is loaded, deduplicating concurrent calls. */
async function ensureTheme(hl: Highlighter, theme: string): Promise<boolean> {
  if (loadedThemes.has(theme)) return true;

  let promise = loadingThemes.get(theme);
  if (!promise) {
    promise = hl
      .loadTheme(theme as BundledTheme)
      .then(() => { loadedThemes.add(theme); return true; })
      .catch(() => false)
      .finally(() => loadingThemes.delete(theme));
    loadingThemes.set(theme, promise);
  }

  return promise;
}

// Token cache: code windows re-tokenize on every viewport re-entry and on
// watcher-driven re-reads even when content is unchanged. Tokens are immutable
// once produced, so cached arrays are shared safely across consumers. Budget
// is in bytes of source content (~6MB ≈ a dozen large files).
const TOKEN_CACHE_MAX_BYTES = 6_000_000;
const tokenCache = createTokenLRU<ThemedToken[][]>(TOKEN_CACHE_MAX_BYTES);
const inflightTokenizations = new Map<string, Promise<ThemedToken[][]>>();

async function tokenizeUncached(
  code: string,
  lang: string,
  theme: string,
): Promise<ThemedToken[][]> {
  const hl = await getHighlighter();

  const loaded = await ensureLanguage(hl, lang);
  let resolvedLang: BundledLanguage | "text" = lang as BundledLanguage;

  if (!loaded) {
    await ensureLanguage(hl, "text");
    resolvedLang = "text";
  }

  await ensureTheme(hl, theme);
  const resolvedTheme = loadedThemes.has(theme) ? theme as BundledTheme : "github-dark";

  const result = hl.codeToTokens(code, { lang: resolvedLang, theme: resolvedTheme });
  return result.tokens;
}

/**
 * Tokenize code into lines of themed tokens for custom rendering.
 * Loads language grammar and theme on demand. Results are cached by
 * (lang, theme, content) and concurrent identical requests are deduplicated,
 * so window remounts and unchanged-content refreshes skip tokenization.
 */
export function tokenizeCode(
  code: string,
  lang: string,
  theme: string = "github-dark",
): Promise<ThemedToken[][]> {
  const key = `${lang}\u0000${theme}\u0000${code}`;

  const cached = tokenCache.get(key);
  if (cached) return Promise.resolve(cached);

  let pending = inflightTokenizations.get(key);
  if (!pending) {
    pending = tokenizeUncached(code, lang, theme)
      .then((tokens) => {
        tokenCache.set(key, tokens, code.length);
        return tokens;
      })
      .finally(() => inflightTokenizations.delete(key));
    inflightTokenizations.set(key, pending);
  }

  return pending;
}
