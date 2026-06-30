export type CommandCenterCategory = "actions" | "agents" | "workspaces" | "windows" | "files";

export interface CommandCenterItem {
  id: string;
  category: CommandCenterCategory;
  title: string;
  subtitle?: string;
  keywords?: readonly string[];
  disabled?: boolean;
  priority?: number;
}

export interface CommandCenterGroup<T extends CommandCenterItem = CommandCenterItem> {
  category: CommandCenterCategory;
  items: T[];
}

const CATEGORY_ORDER: CommandCenterCategory[] = [
  "actions",
  "agents",
  "workspaces",
  "windows",
  "files",
];

const CATEGORY_ORDER_RANK: Record<CommandCenterCategory, number> = {
  actions: 0,
  agents: 1,
  workspaces: 2,
  windows: 3,
  files: 4,
};

const CATEGORY_SCORE_BONUS: Record<CommandCenterCategory, number> = {
  actions: 40,
  workspaces: 12,
  windows: 8,
  agents: 8,
  files: 0,
};

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function getSearchText(item: CommandCenterItem): string {
  return [
    item.title,
    item.subtitle,
    ...(item.keywords ?? []),
  ].filter(Boolean).join(" ").toLowerCase();
}

function getMatchScore(item: CommandCenterItem, terms: string[]): number | null {
  if (terms.length === 0) return item.priority ?? 0;

  const title = item.title.toLowerCase();
  const subtitle = item.subtitle?.toLowerCase() ?? "";
  const keywords = (item.keywords ?? []).join(" ").toLowerCase();
  const searchText = getSearchText(item);

  if (!terms.every((term) => searchText.includes(term))) return null;

  const query = terms.join(" ");
  let score = (item.priority ?? 0) + CATEGORY_SCORE_BONUS[item.category];

  if (title === query) score += 120;
  else if (title.startsWith(query)) score += 90;
  else if (title.includes(query)) score += 70;
  else if (subtitle.includes(query)) score += 45;
  else if (keywords.includes(query)) score += 30;
  else score += 20;

  score -= Math.min(item.title.length, 80) / 100;
  return score;
}

export function filterCommandCenterItems<T extends CommandCenterItem>(
  items: readonly T[],
  query: string,
  limit = 60,
): T[] {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  const cappedLimit = Math.max(0, limit);

  return items
    .map((item, index) => ({ item, index, score: getMatchScore(item, terms) }))
    .filter((entry): entry is { item: T; index: number; score: number } => (
      entry.score !== null
    ))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aCategory = CATEGORY_ORDER_RANK[a.item.category];
      const bCategory = CATEGORY_ORDER_RANK[b.item.category];
      if (aCategory !== bCategory) return aCategory - bCategory;
      return a.index - b.index;
    })
    .slice(0, cappedLimit)
    .map((entry) => entry.item);
}

export function filterCommandCenterItemsFor<T extends CommandCenterItem>(
  items: readonly T[],
  query: string,
  limit = 60,
): T[] {
  return filterCommandCenterItems(items, query, limit);
}

export function groupCommandCenterItems<T extends CommandCenterItem>(
  items: readonly T[],
): CommandCenterGroup<T>[] {
  const itemsByCategory = new Map<CommandCenterCategory, T[]>();

  for (const item of items) {
    const categoryItems = itemsByCategory.get(item.category);
    if (categoryItems) {
      categoryItems.push(item);
    } else {
      itemsByCategory.set(item.category, [item]);
    }
  }

  return CATEGORY_ORDER.flatMap((category) => {
    const categoryItems = itemsByCategory.get(category);
    return categoryItems ? [{ category, items: categoryItems }] : [];
  });
}
