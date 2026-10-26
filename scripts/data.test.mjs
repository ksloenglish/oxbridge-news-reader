import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SELECTION,
  articlesForSelection,
  formatPublishedAt,
  formatSnapshotUpdated,
  readCatalog,
  readSnapshot,
  selectionLabel,
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

test("a catalog feed with no articles stays selectable", () => {
  const catalog = readCatalog(catalogRaw);
  const snapshot = readSnapshot({ generatedAt: null, feeds: [], articles: [] });
  assert.equal(articlesForSelection(catalog, snapshot, "feed:rfa-english").length, 0);
  assert.equal(selectionLabel(catalog, "feed:rfa-english"), "Radio Free Asia English");
});
