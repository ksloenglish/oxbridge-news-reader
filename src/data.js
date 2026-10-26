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
    checkedAt: raw?.checkedAt || null,
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

/** Successful feed checks are expected about every 15 minutes. */
export const FEED_CHECK_INTERVAL_MS = 15 * 60 * 1000;

/**
 * The desk calls a check overdue after this long without a successful read.
 * Three expected intervals, so one late publish does not flash a warning.
 */
export const FEED_CHECK_OVERDUE_MS = 3 * FEED_CHECK_INTERVAL_MS;

/** True when `value` is missing, unreadable, or older than the overdue window. */
export function isFeedCheckOverdue(value, now = Date.now(), overdueMs = FEED_CHECK_OVERDUE_MS) {
  const checkedMs = Date.parse(value ?? "");
  if (!Number.isFinite(checkedMs)) return true;
  return now - checkedMs > overdueMs;
}

/**
 * School-reader status for the last successful feed read.
 * `checkedAt` is that read. An older snapshot with only `generatedAt`
 * shows that stamp as the last check until a fetch records `checkedAt`.
 */
export function describeFeedCheck(snapshot, now = Date.now()) {
  const checkedAt = snapshot?.checkedAt || null;
  const generatedAt = snapshot?.generatedAt || null;
  const stamp = checkedAt || generatedAt || null;
  const when = formatSnapshotUpdated(stamp);
  const overdue = when ? isFeedCheckOverdue(stamp, now) : true;
  const text = when
    ? `Feeds last checked: ${when} (HKT).${overdue ? " This check is overdue." : ""}`
    : "Feeds last checked: not recorded yet. This check is overdue.";
  return { checkedAt, stamp, generatedAt, when, overdue, text };
}

/** When the story list last changed. Empty when the stamp is missing. */
export function formatNewsChanged(generatedAt) {
  const when = formatSnapshotUpdated(generatedAt);
  if (!when) return "";
  return `News last changed: ${when} (HKT).`;
}

/** Name sources from the current selection that failed on the last check. */
export function formatFeedCheckFailure(feeds) {
  const failed = (feeds || []).filter((feed) => feed && feed.ok === false);
  if (!failed.length) return "";
  const names = failed.map((feed) => feed.name || feed.id).filter(Boolean);
  if (names.length === 1) return `Could not read ${names[0]} on the last check.`;
  if (!names.length) return "Some sources could not be read on the last check.";
  return `Could not read these sources on the last check: ${names.join(", ")}.`;
}

/** Hong Kong clock time for a snapshot stamp. Empty when missing or unreadable. */
export function formatSnapshotUpdated(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Hong_Kong",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

/**
 * Student-facing publication time from article `publishedAt` (ISO UTC from the feed date).
 * Empty when the story has no usable date, so the desk does not invent a time.
 */
export function formatPublishedAt(value) {
  const when = formatSnapshotUpdated(value);
  if (!when) return "";
  return `Published ${when} (HKT)`;
}
