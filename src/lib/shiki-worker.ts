import { createHighlighter, type BundledLanguage, type BundledTheme, type Highlighter, type ThemedToken } from "shiki";

interface TokenizeRequest {
  id: number;
  code: string;
  lang: string;
  theme: string;
}

type TokenizeResponse =
  | { id: number; ok: true; tokens: ThemedToken[][] }
  | { id: number; ok: false; error: string };

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

async function tokenizeInWorker(code: string, lang: string, theme: string): Promise<ThemedToken[][]> {
  const hl = await getHighlighter();

  const loaded = await ensureLanguage(hl, lang);
  let resolvedLang: BundledLanguage | "text" = lang as BundledLanguage;

  if (!loaded) {
    await ensureLanguage(hl, "text");
    resolvedLang = "text";
  }

  await ensureTheme(hl, theme);
  const resolvedTheme = loadedThemes.has(theme) ? theme as BundledTheme : "github-dark";

  return hl.codeToTokens(code, { lang: resolvedLang, theme: resolvedTheme }).tokens;
}

self.addEventListener("message", (event: MessageEvent<TokenizeRequest>) => {
  const { id, code, lang, theme } = event.data;

  tokenizeInWorker(code, lang, theme)
    .then((tokens) => {
      self.postMessage({ id, ok: true, tokens } satisfies TokenizeResponse);
    })
    .catch((err: unknown) => {
      self.postMessage({
        id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      } satisfies TokenizeResponse);
    });
});

export {};
