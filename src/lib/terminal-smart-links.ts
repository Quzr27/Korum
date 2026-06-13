export interface TerminalUrlLink {
  kind: "url";
  text: string;
  url: string;
  startIndex: number;
  endIndex: number;
}

export interface TerminalFileLink {
  kind: "file";
  text: string;
  path: string;
  line: number;
  column?: number;
  startIndex: number;
  endIndex: number;
}

export type TerminalSmartLink = TerminalUrlLink | TerminalFileLink;

export interface TerminalFileContext {
  text: string;
  path: string;
  startIndex: number;
  endIndex: number;
}

export interface TerminalLinkSegment {
  bufferLineNumber: number;
  startIndex: number;
  endIndex: number;
  cellStartByIndex?: readonly number[];
  cellEndByIndex?: readonly number[];
}

export interface TerminalBufferRange {
  start: { x: number; y: number };
  end: { x: number; y: number };
}

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;
const FILE_LOCATION_PATTERN =
  /(^|[\s([{"'=])((?:(?:\/|\.{1,2}\/|~\/|[A-Za-z0-9_.@-]+\/)[^\s()<>:"'`]+?|[A-Za-z0-9_.@-]+)\.[A-Za-z0-9][A-Za-z0-9._+-]*)(?::(\d+)(?::(\d+))?|\((\d+)(?:,(\d+))?\))/g;
const INLINE_FILE_PATH_PATTERN =
  /(^|[\s([{"'=])((?:(?:\/|\.{1,2}\/|~\/|[A-Za-z0-9_.@-]+\/)[^\s()<>:"'`]+?)\.[A-Za-z0-9][A-Za-z0-9._+-]*)/g;
const FILE_CONTEXT_PATTERN =
  /^(\s*)((?:(?:\/|\.{1,2}\/|~\/|[A-Za-z0-9_.@-]+\/)[^\s()<>:"'`]+?|[A-Za-z0-9_.@-]+)\.[A-Za-z0-9][A-Za-z0-9._+-]*)(\s*)$/;
const ESLINT_DIAGNOSTIC_PATTERN = /^(\s*)(\d+):(\d+)(?=\s+(?:error|warning)\b|\s)/;

function countChar(value: string, char: string): number {
  let count = 0;
  for (const current of value) {
    if (current === char) count += 1;
  }
  return count;
}

function trimUrl(raw: string): string {
  let text = raw;
  while (/[.,;!?]$/.test(text)) {
    text = text.slice(0, -1);
  }

  const pairs: ReadonlyArray<readonly [string, string]> = [
    ["(", ")"],
    ["[", "]"],
    ["{", "}"],
  ];
  let changed = true;
  while (changed && text.length > 0) {
    changed = false;
    for (const [open, close] of pairs) {
      if (!text.endsWith(close)) continue;
      if (countChar(text, close) <= countChar(text, open)) continue;
      text = text.slice(0, -1);
      changed = true;
      break;
    }
  }

  return text;
}

function rangesOverlap(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && startB < endA;
}

function toPositiveInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function normalizeWorkspaceRoot(root: string): string | null {
  if (!root.startsWith("/")) return null;
  const segments = root.split("/").filter(Boolean);
  return `/${segments.join("/")}`;
}

export function resolveTerminalFilePath(path: string, workspaceRoot?: string): string | null {
  if (path.startsWith("/")) return path;
  if (!workspaceRoot || path.startsWith("~/")) return null;

  const root = normalizeWorkspaceRoot(workspaceRoot);
  if (!root) return null;

  const rootSegments = root.split("/").filter(Boolean);
  const segments = [...rootSegments];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (segments.length <= rootSegments.length) return null;
      segments.pop();
      continue;
    }
    segments.push(part);
  }

  return `/${segments.join("/")}`;
}

export function findTerminalSmartLinks(line: string): TerminalSmartLink[] {
  const links: TerminalSmartLink[] = [];
  const urlRanges: Array<readonly [number, number]> = [];
  const occupiedRanges: Array<readonly [number, number]> = [];

  for (const match of line.matchAll(URL_PATTERN)) {
    const raw = match[0];
    const text = trimUrl(raw);
    if (!text) continue;

    const startIndex = match.index ?? 0;
    const endIndex = startIndex + text.length;
    urlRanges.push([startIndex, endIndex]);
    occupiedRanges.push([startIndex, endIndex]);
    links.push({
      kind: "url",
      text,
      url: text,
      startIndex,
      endIndex,
    });
  }

  for (const match of line.matchAll(FILE_LOCATION_PATTERN)) {
    const prefix = match[1] ?? "";
    const path = match[2];
    const linePart = match[3] ?? match[5];
    if (!path || !linePart) continue;

    const startIndex = (match.index ?? 0) + prefix.length;
    const text = match[0].slice(prefix.length);
    const endIndex = startIndex + text.length;
    if (urlRanges.some(([urlStart, urlEnd]) => rangesOverlap(startIndex, endIndex, urlStart, urlEnd))) {
      continue;
    }

    const columnPart = match[4] ?? match[6];
    occupiedRanges.push([startIndex, endIndex]);
    links.push({
      kind: "file",
      text,
      path,
      line: toPositiveInt(linePart),
      column: columnPart ? toPositiveInt(columnPart) : undefined,
      startIndex,
      endIndex,
    });
  }

  for (const match of line.matchAll(INLINE_FILE_PATH_PATTERN)) {
    const prefix = match[1] ?? "";
    const path = match[2];
    if (!path) continue;

    const startIndex = (match.index ?? 0) + prefix.length;
    const endIndex = startIndex + path.length;
    if (occupiedRanges.some(([rangeStart, rangeEnd]) => rangesOverlap(startIndex, endIndex, rangeStart, rangeEnd))) {
      continue;
    }

    occupiedRanges.push([startIndex, endIndex]);
    links.push({
      kind: "file",
      text: path,
      path,
      line: 1,
      startIndex,
      endIndex,
    });
  }

  const context = findTerminalFileContext(line);
  if (context && !occupiedRanges.some(([rangeStart, rangeEnd]) => rangesOverlap(context.startIndex, context.endIndex, rangeStart, rangeEnd))) {
    links.push({
      kind: "file",
      text: context.text,
      path: context.path,
      line: 1,
      startIndex: context.startIndex,
      endIndex: context.endIndex,
    });
  }

  return links.sort((a, b) => a.startIndex - b.startIndex);
}

export function findTerminalFileContext(line: string): TerminalFileContext | null {
  const match = FILE_CONTEXT_PATTERN.exec(line);
  if (!match) return null;

  const text = match[2];
  const startIndex = match[1].length;
  return {
    text,
    path: text,
    startIndex,
    endIndex: startIndex + text.length,
  };
}

/**
 * Cheap predicate: does this line look like an ESLint `line:col error/warning`
 * diagnostic row? Used to gate the (up to 24-line) backward file-context scan
 * so ordinary hovers don't walk the scrollback. The pattern has no `g` flag,
 * so `test()` is stateless.
 */
export function looksLikeTerminalDiagnostic(line: string): boolean {
  return ESLINT_DIAGNOSTIC_PATTERN.test(line);
}

export function findTerminalDiagnosticLink(line: string, path: string): TerminalFileLink | null {
  const match = ESLINT_DIAGNOSTIC_PATTERN.exec(line);
  if (!match) return null;

  const startIndex = match[1].length;
  const text = `${match[2]}:${match[3]}`;
  return {
    kind: "file",
    text,
    path,
    line: toPositiveInt(match[2]),
    column: toPositiveInt(match[3]),
    startIndex,
    endIndex: startIndex + text.length,
  };
}

export function mapTerminalLinkRange(
  segments: readonly TerminalLinkSegment[],
  startIndex: number,
  endIndex: number,
): TerminalBufferRange | null {
  const startSegment = segments.find((segment) => (
    startIndex >= segment.startIndex && startIndex < segment.endIndex
  ));
  const endSegment = segments.find((segment) => (
    endIndex > segment.startIndex && endIndex <= segment.endIndex
  ));
  if (!startSegment || !endSegment) return null;

  const startRelative = startIndex - startSegment.startIndex;
  const endRelative = endIndex - endSegment.startIndex;
  const startX = startSegment.cellStartByIndex?.[startRelative] ?? startRelative + 1;
  const endX = endSegment.cellEndByIndex?.[endRelative] ?? endRelative;

  return {
    start: {
      x: startX,
      y: startSegment.bufferLineNumber,
    },
    end: {
      x: endX,
      y: endSegment.bufferLineNumber,
    },
  };
}
