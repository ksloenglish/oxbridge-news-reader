import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SELECTION,
  FEED_CHECK_OVERDUE_MS,
  articlesForSelection,
  describeFeedCheck,
  formatFeedCheckFailure,
  formatPublishedAt,
  formatSnapshotUpdated,
  isFeedCheckOverdue,
  readCatalog,
  readSnapshot,
  selectionLabel,
  statusForSelection,
} from "../src/data.js";

const catalogRaw = {
  policy: "Free English RSS only.",
  caps: { perFeed: 20, total: 150, excerptWords: 20 },
  feeds: [
    { id: "rthk-local", name: "RTHK English — Local", url: "https://example.com/local.xml", category: "rthk", enabled: true },
    { id: "rthk-world", name: "RTHK English — World", url: "https://example.com/world.xml", category: "rthk", enabled: true },
    { id: "news-gov-hk-top", name: "news.gov.hk — Top Story", url: "https://example.com/top.xml", category: "hk", enabled: true },
    { id: "rfa-english", name: "Radio Free Asia English", url: "https://example.com/rfa.xml", category: "international", enabled: true },
  ],
};

test("default desk is every RTHK channel in the catalog", () => {
  const catalog = readCatalog(catalogRaw);
  const snapshot = readSnapshot({
    generatedAt: "2026-10-25T00:00:00.000Z",
    feeds: catalogRaw.feeds.map((feed) => ({ ...feed, ok: true, error: null, articleCount: 1 })),
    articles: [
      { id: "a", title: "Local", excerpt: "L", fullText: "Local text", imageUrl: null, publishedAt: "2026-10-25T00:00:00.000Z", source: "RTHK English — Local", sourceFeed: "rthk-local", link: "https://example.com/a" },
      { id: "b", title: "World", excerpt: "W", fullText: "World text", imageUrl: "https://example.com/w.jpg", publishedAt: "2026-10-25T01:00:00.000Z", source: "RTHK English — World", sourceFeed: "rthk-world", link: "https://example.com/b" },
      { id: "c", title: "Top", excerpt: "T", fullText: "Top text", imageUrl: null, publishedAt: null, source: "news.gov.hk — Top Story", sourceFeed: "news-gov-hk-top", link: "https://example.com/c" },
    ],
  });
  assert.equal(selectionLabel(catalog, DEFAULT_SELECTION), "RTHK English News");
  const rows = articlesForSelection(catalog, snapshot, DEFAULT_SELECTION);
  assert.deepEqual(rows.map((row) => row.id), ["a", "b"]);
  assert.equal(rows[1].imageUrl, "https://example.com/w.jpg");
  assert.equal(rows[1].fullText, "World text");
  const top = articlesForSelection(catalog, snapshot, "feed:news-gov-hk-top");
  assert.equal(top.length, 1);
  assert.equal(top[0].link, "https://example.com/c");
});

test("snapshot time is shown in Hong Kong time", () => {
  assert.equal(formatSnapshotUpdated("2026-10-25T23:50:03.092Z"), "26 Oct 2026, 7:50 am");
  assert.equal(formatSnapshotUpdated("2026-10-26T03:48:42.114Z"), "26 Oct 2026, 11:48 am");
  assert.equal(formatSnapshotUpdated(null), "");
  assert.equal(formatSnapshotUpdated("not-a-date"), "");
});

test("publication time uses publishedAt in Hong Kong time and is omitted when missing", () => {
  assert.equal(formatPublishedAt("2026-10-25T10:56:54.000Z"), "Published 25 Oct 2026, 6:56 pm (HKT)");
  assert.equal(formatPublishedAt("2026-10-26T03:20:16.000Z"), "Published 26 Oct 2026, 11:20 am (HKT)");
  assert.equal(formatPublishedAt(null), "");
  assert.equal(formatPublishedAt(""), "");
  assert.equal(formatPublishedAt("not-a-date"), "");
});

test("readSnapshot keeps the feed check separate from the story change", () => {
  const snapshot = readSnapshot({
    generatedAt: "2026-10-26T03:20:16.000Z",
    checkedAt: "2026-10-26T03:48:42.114Z",
    feeds: [{ id: "rthk-local", ok: true }],
    articles: [],
  });
  assert.equal(snapshot.generatedAt, "2026-10-26T03:20:16.000Z");
  assert.equal(snapshot.checkedAt, "2026-10-26T03:48:42.114Z");
  assert.equal(readSnapshot({ generatedAt: "", checkedAt: "", feeds: null, articles: {} }).checkedAt, null);
});

test("a quiet check shows when the feeds were read", () => {
  const now = Date.parse("2026-10-26T04:00:00.000Z");
  const health = describeFeedCheck({
    generatedAt: "2026-10-26T03:20:16.000Z",
    checkedAt: "2026-10-26T03:48:42.114Z",
  }, now);
  assert.equal(health.overdue, false);
  assert.equal(health.text, "Feeds checked 26 Oct 2026, 11:48 am (HKT).");
});

test("a check older than 45 minutes is overdue, and a missing stamp says so", () => {
  const checkedAt = "2026-10-26T03:00:00.000Z";
  const atLimit = Date.parse(checkedAt) + FEED_CHECK_OVERDUE_MS;
  assert.equal(FEED_CHECK_OVERDUE_MS, 45 * 60 * 1000);
  assert.equal(isFeedCheckOverdue(checkedAt, atLimit), false);
  assert.equal(isFeedCheckOverdue(checkedAt, atLimit + 1), true);
  const overdue = describeFeedCheck({ checkedAt, generatedAt: "2026-10-26T01:00:00.000Z" }, atLimit + 1);
  assert.equal(overdue.overdue, true);
  assert.match(overdue.text, /^Feeds checked /);
  assert.match(overdue.text, /This check is overdue\.$/);

  const freshFile = describeFeedCheck({
    generatedAt: "2026-10-26T03:20:16.000Z",
    checkedAt: null,
  }, Date.parse("2026-10-26T03:30:00.000Z"));
  assert.equal(freshFile.overdue, false);
  assert.equal(freshFile.stamp, "2026-10-26T03:20:16.000Z");
  assert.equal(freshFile.text, "Feeds checked 26 Oct 2026, 11:20 am (HKT).");

  const staleFile = describeFeedCheck({
    generatedAt: checkedAt,
    checkedAt: null,
  }, atLimit + 1);
  assert.equal(staleFile.overdue, true);
  assert.equal(staleFile.text, "Feeds checked 26 Oct 2026, 11:00 am (HKT). This check is overdue.");
  const missing = describeFeedCheck({ generatedAt: null, checkedAt: null });
  assert.equal(missing.overdue, true);
  assert.equal(missing.text, "Feeds checked not recorded yet. This check is overdue.");
});

test("a failed source is named for the current selection only", () => {
  const catalog = readCatalog(catalogRaw);
  const snapshot = readSnapshot({
    generatedAt: "2026-10-26T03:48:42.114Z",
    checkedAt: "2026-10-26T03:48:42.114Z",
    feeds: [
      { id: "rthk-local", name: "RTHK English — Local", ok: false, error: "HTTP 503" },
      { id: "rthk-world", name: "RTHK English — World", ok: true, error: null },
      { id: "rfa-english", name: "Radio Free Asia English", ok: false, error: "timeout" },
    ],
    articles: [],
  });
  assert.equal(
    formatFeedCheckFailure(statusForSelection(catalog, snapshot, DEFAULT_SELECTION)),
    "Could not read RTHK English — Local on the last check.",
  );
  assert.equal(
    formatFeedCheckFailure(statusForSelection(catalog, snapshot, "category:international")),
    "Could not read Radio Free Asia English on the last check.",
  );
  assert.equal(formatFeedCheckFailure(statusForSelection(catalog, snapshot, "feed:rthk-world")), "");
  assert.equal(
    formatFeedCheckFailure([
      { id: "a", name: "Alpha", ok: false },
      { id: "b", name: "Beta", ok: false },
      { id: "c", name: "Gamma", ok: true },
    ]),
    "Could not read these sources on the last check: Alpha, Beta.",
  );
  assert.equal(formatFeedCheckFailure([{ id: "rthk-sport", ok: false }]), "Could not read rthk-sport on the last check.");
  assert.equal(formatFeedCheckFailure([{ ok: false }]), "Some sources could not be read on the last check.");
  assert.equal(formatFeedCheckFailure([]), "");
});

test("a catalog feed with no articles stays selectable", () => {
  const catalog = readCatalog(catalogRaw);
  const snapshot = readSnapshot({ generatedAt: null, feeds: [], articles: [] });
  assert.equal(articlesForSelection(catalog, snapshot, "feed:rfa-english").length, 0);
  assert.equal(selectionLabel(catalog, "feed:rfa-english"), "Radio Free Asia English");
});
