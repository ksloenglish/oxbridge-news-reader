import { createHash } from "node:crypto";

export const DEFAULT_PER_FEED_CAP = 20;
export const DEFAULT_TOTAL_CAP = 150;

/** Identity key: ignore fragment and a trailing slash so the same story collapses. */
export function canonicalLinkKey(link) {
  try {
    const url = new URL(String(link).trim());
    url.hash = "";
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }
    return url.toString();
  } catch {
    return String(link ?? "").trim();
  }
}

/** Stable id: first 16 hex chars of SHA-256 over the canonical link, else the guid. */
export function articleId(link, guid = "") {
  const key = link ? canonicalLinkKey(link) : guid ? `guid:${String(guid).trim()}` : "";
  if (!key) return "";
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

export function byNewest(a, b) {
  const ta = a.publishedAt ? Date.parse(a.publishedAt) : Number.NaN;
  const tb = b.publishedAt ? Date.parse(b.publishedAt) : Number.NaN;
  const aKnown = Number.isFinite(ta);
  const bKnown = Number.isFinite(tb);
  if (aKnown && bKnown && tb !== ta) return tb - ta;
  if (aKnown !== bKnown) return aKnown ? -1 : 1;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

export function dedupeArticles(articles) {
  const best = new Map();
  for (const article of articles) {
    const key = article.link ? canonicalLinkKey(article.link) : `id:${article.id}`;
    const current = best.get(key);
    if (!current || article.fullText.length > current.fullText.length) best.set(key, article);
  }
  return [...best.values()];
}

/**
 * Keep the newest `perFeed` items from each feed, drop duplicate links,
 * then keep the newest `total` items overall.
 */
export function selectArticles(groups, { perFeed = DEFAULT_PER_FEED_CAP, total = DEFAULT_TOTAL_CAP } = {}) {
  const capped = [];
  for (const group of groups) {
    const sorted = [...group.articles].sort(byNewest);
    capped.push(...sorted.slice(0, perFeed));
  }
  const unique = dedupeArticles(capped);
  unique.sort(byNewest);
  return unique.slice(0, total);
}

export function summarizeFeeds(feeds, resultsById, articles) {
  const counts = new Map();
  for (const article of articles) {
    counts.set(article.sourceFeed, (counts.get(article.sourceFeed) || 0) + 1);
  }
  return feeds.map((feed) => {
    const result = resultsById.get(feed.id);
    const ok = feed.enabled ? Boolean(result?.ok) : true;
    return {
      id: feed.id,
      name: feed.name,
      url: feed.url,
      category: feed.category,
      enabled: Boolean(feed.enabled),
      ok,
      error: feed.enabled ? (ok ? null : result?.error || "failed") : null,
      articleCount: counts.get(feed.id) || 0,
    };
  });
}

export function stableContent(snapshot) {
  return JSON.stringify({ feeds: snapshot.feeds, articles: snapshot.articles });
}

/**
 * Skip the write when every feed failed and a previous snapshot exists,
 * and when articles plus feed status are unchanged (so generatedAt stays put).
 */
export function decideWrite(previous, next, { anySuccess }) {
  if (!anySuccess && previous?.articles?.length) {
    return { write: false, reason: "all-failed", snapshot: previous };
  }
  if (previous && stableContent(previous) === stableContent(next)) {
    return { write: false, reason: "unchanged", snapshot: previous };
  }
  return { write: true, reason: "updated", snapshot: next };
}
