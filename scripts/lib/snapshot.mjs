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

/**
 * One group per fetch result. A feed that succeeded contributes this run.
 * A feed that failed contributes articles already stored for that feed id,
 * so a partial outage is re-capped with the rest instead of dropped.
 */
export function selectionGroups(results, previousArticles = []) {
  const priorByFeed = new Map();
  const prior = Array.isArray(previousArticles) ? previousArticles : [];
  for (const article of prior) {
    const id = article?.sourceFeed;
    if (!id) continue;
    const bucket = priorByFeed.get(id);
    if (bucket) bucket.push(article);
    else priorByFeed.set(id, [article]);
  }
  return results.map((result) => {
    if (result.ok) return { articles: result.articles ?? [] };
    const id = result.feed?.id;
    return { articles: id ? (priorByFeed.get(id) ?? []) : [] };
  });
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

/**
 * Skip the write when every enabled feed failed and a previous snapshot
 * exists, so a bad run cannot wipe stories or move checkedAt.
 *
 * generatedAt is the last time the stories changed. A successful check
 * still records checkedAt when the stories are the same. Feed-status
 * edits with the same stories keep generatedAt and take the new feed rows.
 *
 * Partial failure is applied before this runs: `next.articles` already
 * includes stored stories for feeds that failed, when some feed succeeded.
 */
export function decideWrite(previous, next, { anySuccess }) {
  if (!anySuccess && previous?.articles?.length) {
    return { write: false, reason: "all-failed", snapshot: previous };
  }
  if (!previous) return { write: true, reason: "updated", snapshot: next };

  const articlesSame = JSON.stringify(previous.articles ?? []) === JSON.stringify(next.articles ?? []);
  const feedsSame = JSON.stringify(previous.feeds ?? []) === JSON.stringify(next.feeds ?? []);
  if (articlesSame && feedsSame) {
    if ((previous.checkedAt ?? null) === (next.checkedAt ?? null)) {
      return { write: false, reason: "unchanged", snapshot: previous };
    }
    return {
      write: true,
      reason: "checked",
      snapshot: stampCheck(previous, next.checkedAt, previous.feeds),
    };
  }
  if (articlesSame) {
    return {
      write: true,
      reason: "checked",
      snapshot: stampCheck(previous, next.checkedAt, next.feeds),
    };
  }
  return { write: true, reason: "updated", snapshot: next };
}

function stampCheck(previous, checkedAt, feeds) {
  return {
    generatedAt: previous.generatedAt ?? null,
    checkedAt: checkedAt ?? null,
    feeds,
    articles: previous.articles,
  };
}

/**
 * Build the next snapshot from one fetch run.
 * When at least one enabled feed succeeded, failed feeds keep the previous
 * articles for their ids and the check stamps move with the merged list.
 * When every enabled feed failed, decideWrite keeps the previous file.
 */
export function buildSnapshot({
  feeds,
  results,
  previous = null,
  perFeed = DEFAULT_PER_FEED_CAP,
  total = DEFAULT_TOTAL_CAP,
  now = new Date(),
}) {
  const anySuccess = results.some((result) => result.feed?.enabled && result.ok);
  const priorArticles = anySuccess && Array.isArray(previous?.articles) ? previous.articles : [];
  const articles = selectArticles(selectionGroups(results, priorArticles), { perFeed, total });
  const summary = summarizeFeeds(
    feeds,
    new Map(results.map((result) => [result.feed.id, result])),
    articles,
  );
  const checkedAt = now.toISOString();
  const next = {
    generatedAt: checkedAt,
    checkedAt,
    feeds: summary,
    articles,
  };
  return { anySuccess, decision: decideWrite(previous, next, { anySuccess }) };
}
