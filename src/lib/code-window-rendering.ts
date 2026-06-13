import type { ThemedToken } from "shiki";

type RenderableToken = Pick<ThemedToken, "content" | "color">;

const SAFE_TOKEN_COLOR = /^#[0-9a-fA-F]{3,8}$/;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeTokenColor(color: string | undefined): string | null {
  if (!color || !SAFE_TOKEN_COLOR.test(color)) return null;
  return color;
}

export function renderPlainCodeLineHtml(line: string): string {
  if (line.length === 0) return "&nbsp;";
  return escapeHtml(line);
}

export function renderCodeLineHtml(tokens: readonly RenderableToken[]): string {
  if (tokens.length === 0) return "&nbsp;";

  let html = "";
  for (const token of tokens) {
    const content = escapeHtml(token.content);
    const color = safeTokenColor(token.color);
    html += color ? `<span style="color:${color}">${content}</span>` : `<span>${content}</span>`;
  }
  return html || "&nbsp;";
}

export interface CodeLineHtmlCache {
  getPlainLine(line: string): string;
  getTokenLine(tokens: readonly RenderableToken[]): string;
  clear(): void;
  readonly size: number;
}

export function createCodeLineHtmlCache(maxEntries: number): CodeLineHtmlCache {
  const safeMaxEntries = Math.max(1, Math.floor(maxEntries));
  const tokenIds = new WeakMap<readonly RenderableToken[], number>();
  const entries = new Map<string, string>();
  let nextTokenId = 1;

  const remember = (key: string, html: string): string => {
    entries.set(key, html);
    for (const oldestKey of entries.keys()) {
      if (entries.size <= safeMaxEntries) break;
      entries.delete(oldestKey);
    }
    return html;
  };

  const getTokenId = (tokens: readonly RenderableToken[]): number => {
    let tokenId = tokenIds.get(tokens);
    if (tokenId == null) {
      tokenId = nextTokenId++;
      tokenIds.set(tokens, tokenId);
    }
    return tokenId;
  };

  return {
    getPlainLine(line: string): string {
      const key = `p:${line}`;
      const cached = entries.get(key);
      if (cached != null) return cached;
      return remember(key, renderPlainCodeLineHtml(line));
    },

    getTokenLine(tokens: readonly RenderableToken[]): string {
      const key = `t:${getTokenId(tokens)}`;
      const cached = entries.get(key);
      if (cached != null) return cached;
      return remember(key, renderCodeLineHtml(tokens));
    },

    clear(): void {
      entries.clear();
    },

    get size() {
      return entries.size;
    },
  };
}
