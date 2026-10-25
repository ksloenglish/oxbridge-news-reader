/** Read the RSS catalog and snapshot as published by scripts/fetch-feeds.mjs. */

export const DEFAULT_SELECTION = "category:rthk";

const CATEGORY_LABEL = {
  rthk: "RTHK English",
  hk: "Hong Kong",
  international: "International",
};

export function readCatalog(raw) {
  const feeds = Array.isArray(raw?.feeds) ? raw.feeds.filter((feed) => feed && feed.id) : [];
  return {
    policy: typeof raw?.policy === "string" ? raw.policy : "",
    caps: raw?.caps && typeof raw.caps === "object" ? raw.caps : null,
    feeds,
  };
}

export function readSnapshot(raw) {
  return {
    generatedAt: raw?.generatedAt || null,
    feeds: Array.isArray(raw?.feeds) ? raw.feeds : [],
    articles: Array.isArray(raw?.articles) ? raw.articles : [],
  };
}

export function categoryLabel(category) {
  return CATEGORY_LABEL[category] || category || "News";
}

export function selectedFeedIds(catalog, selection) {
  const feeds = catalog?.feeds || [];
  if (selection?.startsWith("feed:")) return new Set([selection.slice(5)]);
  if (selection?.startsWith("category:")) {
    const category = selection.slice("category:".length);
    return new Set(feeds.filter((feed) => feed.category === category).map((feed) => feed.id));
  }
  return new Set(feeds.filter((feed) => feed.category === "rthk").map((feed) => feed.id));
}

export function articlesForSelection(catalog, snapshot, selection) {
  const allowed = selectedFeedIds(catalog, selection);
  return (snapshot?.articles || []).filter((article) => allowed.has(article.sourceFeed));
}

export function selectionLabel(catalog, selection) {
  if (selection === DEFAULT_SELECTION) return "RTHK English News";
  if (selection?.startsWith("category:")) return categoryLabel(selection.slice("category:".length));
  if (selection?.startsWith("feed:")) {
    const feed = (catalog?.feeds || []).find((item) => item.id === selection.slice(5));
    return feed?.name || "News";
  }
  return "RTHK English News";
}

export function selectionKnown(catalog, selection) {
  if (selection === DEFAULT_SELECTION) return true;
  if (selection?.startsWith("category:")) {
    const category = selection.slice("category:".length);
    return (catalog?.feeds || []).some((feed) => feed.category === category);
  }
  if (selection?.startsWith("feed:")) {
    const id = selection.slice(5);
    return (catalog?.feeds || []).some((feed) => feed.id === id);
  }
  return false;
}

/** Feed rows from the snapshot (`ok`, `error`, `articleCount`) for the current selection. */
export function statusForSelection(catalog, snapshot, selection) {
  const allowed = selectedFeedIds(catalog, selection);
  return (snapshot?.feeds || []).filter((feed) => allowed.has(feed.id));
}
