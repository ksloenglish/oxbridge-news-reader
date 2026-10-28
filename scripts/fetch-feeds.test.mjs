import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { EXCERPT_WORDS, extractImageFromHtml, htmlToText, makeExcerpt, wordsOf } from "./lib/html.mjs";
import { parseFeedXml, toIso } from "./lib/parse-feed.mjs";
import {
  articleId,
  buildSnapshot,
  canonicalLinkKey,
  decideWrite,
  selectArticles,
  summarizeFeeds,
} from "./lib/snapshot.mjs";
import { assertFeedDocument, ingest, loadCatalog } from "./fetch-feeds.mjs";

const FEED = {
  id: "example",
  name: "Example News",
  url: "https://example.com/rss.xml",
  category: "hk",
  enabled: true,
};

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>Example</title>
    <docs >http://blogs.law.harvard.edu/tech/rss</docs >
    <item>
      <title><![CDATA[Fish &amp; chips &lt;today&gt;]]></title>
      <link>https://example.com/stories/one/</link>
      <guid>https://example.com/stories/one/</guid>
      <pubDate>Sun, 25 Oct 2026 18:56:54 +0800</pubDate>
      <description><![CDATA[A distinct harbour teaser that does not open the article body.]]></description>
      <content:encoded><![CDATA[<p>Full story about the harbour and the people who keep the typhoon shelters working through the night.</p><script>alert("x")</script><iframe src="https://evil.example/a"></iframe><img src="javascript:alert(1)"><img src="/images/harbour.jpg"><p>Second paragraph with more detail from the scene.</p>]]></content:encoded>
      <enclosure url="https://cdn.example.com/audio.mp3" type="audio/mpeg"/>
      <media:content url="https://cdn.example.com/harbour.jpg" medium="image" type="image/jpeg" width="1200" height="800"/>
    </item>
    <item>
      <title>Older note</title>
      <link>https://example.com/stories/two</link>
      <pubDate>Sat, 24 Oct 2026 08:00:00 +0800</pubDate>
      <description><![CDATA[<img src="https://cdn.example.com/two.png"><p>Gov style body&nbsp;text.</p>]]></description>
    </item>
  </channel>
</rss>`;

test("htmlToText drops scripts and keeps paragraphs", () => {
  const text = htmlToText('<p>Hello</p><script>alert(1)</script><style>.x{}</style><p>World &amp; city</p>');
  assert.equal(text.includes("alert"), false);
  assert.equal(text.includes("<"), false);
  assert.match(text, /Hello/);
  assert.match(text, /World & city/);
});

test("makeExcerpt keeps about 20 words and ellipsizes a cut", () => {
  const words = Array.from({ length: 30 }, (_, index) => `word${index + 1}`);
  const excerpt = makeExcerpt(words.join("  \n"));
  assert.equal(excerpt.endsWith("…"), true);
  assert.equal(wordsOf(excerpt.replace(/…$/u, "")).length, EXCERPT_WORDS);
  assert.equal(excerpt.startsWith("word1 word2"), true);
  assert.equal(excerpt.includes("word21"), false);
  assert.equal(EXCERPT_WORDS, 20);
});

test("makeExcerpt leaves a short passage whole", () => {
  assert.equal(makeExcerpt("one two three"), "one two three");
  assert.equal(makeExcerpt("  one   two \n three  "), "one two three");
  assert.equal(makeExcerpt(""), "");
  assert.equal(makeExcerpt(null), "");
  const exact = Array.from({ length: EXCERPT_WORDS }, (_, index) => `w${index + 1}`).join(" ");
  assert.equal(makeExcerpt(exact), exact);
});

test("makeExcerpt cuts on a word and drops trailing punctuation", () => {
  const excerpt = makeExcerpt("one two three four", 2);
  assert.equal(excerpt, "one two…");
  assert.equal(makeExcerpt("alpha, beta. gamma! delta?", 3), "alpha, beta. gamma…");
});

test("toIso converts RTHK-style pubDate", () => {
  assert.equal(toIso("Sun, 25 Oct 2026 18:56:54 +0800"), "2026-10-25T10:56:54.000Z");
});

test("parse RSS prefers full text, media image, and a stable id", () => {
  const articles = parseFeedXml(RSS, FEED);
  assert.equal(articles.length, 2);
  const [latest] = articles.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  assert.equal(latest.title, "Fish & chips");
  assert.match(latest.fullText, /Full story about the harbour and the people/);
  assert.match(latest.fullText, /Second paragraph with more detail/);
  assert.equal(latest.fullText.includes("alert"), false);
  assert.equal(latest.fullText.includes("distinct harbour teaser"), false);
  assert.equal(latest.excerpt, "A distinct harbour teaser that does not open the article body.");
  assert.equal(wordsOf(latest.excerpt).length <= EXCERPT_WORDS, true);
  assert.equal(latest.imageUrl, "https://cdn.example.com/harbour.jpg");
  assert.equal(latest.publishedAt, "2026-10-25T10:56:54.000Z");
  assert.equal(latest.source, "Example News");
  assert.equal(latest.sourceFeed, "example");
  assert.equal(latest.link, "https://example.com/stories/one/");
  assert.equal(latest.id, articleId(latest.link));

  const older = articles.find((article) => article.link.endsWith("/two"));
  assert.equal(older.imageUrl, "https://cdn.example.com/two.png");
  assert.match(older.fullText, /Gov style body text/);
});

test("canonical link ignores trailing slash and hash", () => {
  assert.equal(
    canonicalLinkKey("https://example.com/stories/one/#part"),
    canonicalLinkKey("https://example.com/stories/one"),
  );
  assert.equal(
    articleId("https://example.com/stories/one/"),
    articleId("https://example.com/stories/one#x"),
  );
});

test("a long body becomes a 20-word excerpt and fullText stays whole", () => {
  const words = Array.from({ length: 40 }, (_, index) => `term${index + 1}`);
  const xml = `<?xml version="1.0"?>
    <rss version="2.0"><channel><item>
      <title>Long story</title>
      <link>https://example.com/stories/long</link>
      <description><![CDATA[<p>${words.join(" ")}.</p>]]></description>
    </item></channel></rss>`;
  const [article] = parseFeedXml(xml, FEED);
  assert.equal(article.fullText, `${words.join(" ")}.`);
  assert.equal(article.excerpt.endsWith("…"), true);
  assert.equal(wordsOf(article.excerpt.replace(/…$/u, "")).join(" "), words.slice(0, EXCERPT_WORDS).join(" "));
  assert.equal(article.fullText.length > article.excerpt.length, true);
});

test("a long distinct teaser is cut to 20 words", () => {
  const teaser = Array.from({ length: 28 }, (_, index) => `tease${index + 1}`);
  const body = Array.from({ length: 60 }, (_, index) => `body${index + 1}`);
  const xml = `<?xml version="1.0"?>
    <rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><item>
      <title>Teaser story</title>
      <link>https://example.com/stories/teaser</link>
      <description><![CDATA[${teaser.join(" ")}]]></description>
      <content:encoded><![CDATA[<p>${body.join(" ")}</p>]]></content:encoded>
    </item></channel></rss>`;
  const [article] = parseFeedXml(xml, FEED);
  assert.equal(article.fullText, body.join(" "));
  assert.equal(article.excerpt.endsWith("…"), true);
  assert.equal(wordsOf(article.excerpt.replace(/…$/u, "")).join(" "), teaser.slice(0, EXCERPT_WORDS).join(" "));
  assert.equal(article.excerpt.includes("body1"), false);
});

test("parse Atom entries", () => {
  const xml = `<?xml version="1.0"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <title type="html">Atom &amp; title</title>
        <link rel="enclosure" href="https://cdn.example.com/a.jpg" type="image/jpeg"/>
        <link rel="alternate" href="https://example.com/atom/1"/>
        <id>urn:example:1</id>
        <updated>2026-10-20T00:00:00Z</updated>
        <summary>Teaser</summary>
        <content type="html">&lt;p&gt;Atom body text.&lt;/p&gt;</content>
      </entry>
    </feed>`;
  const [article] = parseFeedXml(xml, FEED);
  assert.equal(article.title, "Atom & title");
  assert.equal(article.link, "https://example.com/atom/1");
  assert.match(article.fullText, /Atom body text/);
  assert.equal(article.imageUrl, "https://cdn.example.com/a.jpg");
  assert.equal(article.publishedAt, "2026-10-20T00:00:00.000Z");
});

test("javascript image urls are ignored", () => {
  assert.equal(
    extractImageFromHtml('<img src="javascript:alert(1)"><img src="https://cdn.example.com/ok.png">', "https://example.com/a"),
    "https://cdn.example.com/ok.png",
  );
});

test("selectArticles caps per feed, dedupes, and sorts newest first", () => {
  const older = published("2026-10-01T00:00:00.000Z");
  const newer = published("2026-10-25T00:00:00.000Z");
  const groups = [
    {
      articles: [
        article("https://example.com/shared", "short", "2026-10-20T00:00:00.000Z", "a"),
        article("https://example.com/a-new", "a", newer, "a"),
        article("https://example.com/a-old", "a", older, "a"),
      ],
    },
    {
      articles: [
        article("https://example.com/shared/", "a much longer body from the second feed", "2026-10-20T00:00:00.000Z", "b"),
        article("https://example.com/b-only", "b", "2026-10-22T00:00:00.000Z", "b"),
      ],
    },
  ];
  const selected = selectArticles(groups, { perFeed: 2, total: 3 });
  assert.equal(selected.length, 3);
  assert.deepEqual(selected.map((item) => item.link.replace(/\/$/, "")), [
    "https://example.com/a-new",
    "https://example.com/b-only",
    "https://example.com/shared",
  ]);
  const shared = selected.find((item) => item.link.includes("shared"));
  assert.match(shared.fullText, /much longer/);
  assert.equal(shared.sourceFeed, "b");
});

test("total cap keeps the newest articles across feeds", () => {
  const groups = [0, 1].map((feed) => ({
    articles: [0, 1, 2].map((n) => article(
      `https://example.com/${feed}-${n}`,
      "body",
      new Date(Date.UTC(2026, 9, 20 - n, feed)).toISOString(),
      String(feed),
    )),
  }));
  const selected = selectArticles(groups, { perFeed: 20, total: 4 });
  assert.equal(selected.length, 4);
  const times = selected.map((item) => Date.parse(item.publishedAt));
  assert.deepEqual(times, [...times].sort((a, b) => b - a));
});

test("decideWrite preserves an existing snapshot when every feed fails", () => {
  const previous = { generatedAt: "2026-10-01T00:00:00.000Z", feeds: [], articles: [{ id: "abc" }] };
  const next = { generatedAt: "2026-10-25T00:00:00.000Z", feeds: [], articles: [] };
  const decision = decideWrite(previous, next, { anySuccess: false });
  assert.equal(decision.write, false);
  assert.equal(decision.reason, "all-failed");
  assert.equal(decision.snapshot, previous);
});

test("decideWrite skips a rewrite when articles are unchanged", () => {
  const previous = {
    generatedAt: "2026-10-01T00:00:00.000Z",
    feeds: [{ id: "a", ok: true, error: null, articleCount: 1 }],
    articles: [{ id: "abc" }],
  };
  const next = {
    generatedAt: "2026-10-25T00:00:00.000Z",
    feeds: [{ id: "a", ok: true, error: null, articleCount: 1 }],
    articles: [{ id: "abc" }],
  };
  const decision = decideWrite(previous, next, { anySuccess: true });
  assert.equal(decision.write, false);
  assert.equal(decision.reason, "unchanged");
  assert.equal(decision.snapshot, previous);
});

test("decideWrite records checkedAt without moving generatedAt when stories stay put", () => {
  const previous = {
    generatedAt: "2026-10-26T03:20:16.000Z",
    checkedAt: "2026-10-26T03:20:16.000Z",
    feeds: [{ id: "a", ok: true, error: null, articleCount: 1 }],
    articles: [{ id: "abc" }],
  };
  const next = {
    generatedAt: "2026-10-26T03:48:42.114Z",
    checkedAt: "2026-10-26T03:48:42.114Z",
    feeds: [{ id: "a", ok: true, error: null, articleCount: 1 }],
    articles: [{ id: "abc" }],
  };
  const decision = decideWrite(previous, next, { anySuccess: true });
  assert.equal(decision.write, true);
  assert.equal(decision.reason, "checked");
  assert.equal(decision.snapshot.generatedAt, "2026-10-26T03:20:16.000Z");
  assert.equal(decision.snapshot.checkedAt, "2026-10-26T03:48:42.114Z");
  assert.equal(decision.snapshot.articles, previous.articles);
  assert.equal(decision.snapshot.feeds, previous.feeds);
});

test("decideWrite keeps generatedAt when only a feed status changes", () => {
  const previous = {
    generatedAt: "2026-10-26T03:20:16.000Z",
    checkedAt: "2026-10-26T03:20:16.000Z",
    feeds: [{ id: "a", ok: true, error: null, articleCount: 1 }],
    articles: [{ id: "abc" }],
  };
  const next = {
    generatedAt: "2026-10-26T03:48:42.114Z",
    checkedAt: "2026-10-26T03:48:42.114Z",
    feeds: [{ id: "a", ok: false, error: "HTTP 503", articleCount: 1 }],
    articles: [{ id: "abc" }],
  };
  const decision = decideWrite(previous, next, { anySuccess: true });
  assert.equal(decision.write, true);
  assert.equal(decision.reason, "checked");
  assert.equal(decision.snapshot.generatedAt, previous.generatedAt);
  assert.equal(decision.snapshot.checkedAt, next.checkedAt);
  assert.equal(decision.snapshot.articles, previous.articles);
  assert.deepEqual(decision.snapshot.feeds, next.feeds);
});

test("decideWrite moves generatedAt when the stories change", () => {
  const previous = {
    generatedAt: "2026-10-26T03:20:16.000Z",
    checkedAt: "2026-10-26T03:20:16.000Z",
    feeds: [{ id: "a", ok: true, articleCount: 1 }],
    articles: [{ id: "old" }],
  };
  const next = {
    generatedAt: "2026-10-26T03:48:42.114Z",
    checkedAt: "2026-10-26T03:48:42.114Z",
    feeds: [{ id: "a", ok: true, articleCount: 1 }],
    articles: [{ id: "new" }],
  };
  const decision = decideWrite(previous, next, { anySuccess: true });
  assert.equal(decision.write, true);
  assert.equal(decision.reason, "updated");
  assert.equal(decision.snapshot, next);
});

test("decideWrite does not move checkedAt when every feed fails", () => {
  const previous = {
    generatedAt: "2026-10-01T00:00:00.000Z",
    checkedAt: "2026-10-01T00:00:00.000Z",
    feeds: [{ id: "a", ok: true }],
    articles: [{ id: "abc" }],
  };
  const next = {
    generatedAt: "2026-10-26T03:48:42.114Z",
    checkedAt: "2026-10-26T03:48:42.114Z",
    feeds: [{ id: "a", ok: false, error: "HTTP 503" }],
    articles: [],
  };
  const decision = decideWrite(previous, next, { anySuccess: false });
  assert.equal(decision.write, false);
  assert.equal(decision.reason, "all-failed");
  assert.equal(decision.snapshot, previous);
  assert.equal(decision.snapshot.checkedAt, "2026-10-01T00:00:00.000Z");
});

test("buildSnapshot keeps stored articles for feeds that fail in a partial run", () => {
  const rthkLocal = catalogFeed("rthk-local");
  const rthkWorld = catalogFeed("rthk-world");
  const newsGov = catalogFeed("news-gov-hk-top", "hk");
  const keptLocal = article(
    "https://news.rthk.hk/rthk/en/component/k2/local-pipe",
    "Shau Kei Wan water supply returns after pipe burst",
    "2026-10-28T01:00:00.000Z",
    "rthk-local",
  );
  keptLocal.title = "Shau Kei Wan water supply returns after pipe burst";
  const droppedLocal = article(
    "https://news.rthk.hk/rthk/en/component/k2/local-old",
    "older local",
    "2026-10-01T00:00:00.000Z",
    "rthk-local",
  );
  const keptWorld = article(
    "https://news.rthk.hk/rthk/en/component/k2/world-new",
    "newer world",
    "2026-10-27T00:00:00.000Z",
    "rthk-world",
  );
  const priorGov = article(
    "https://www.news.gov.hk/eng/2026/10/old.htm",
    "old gov",
    "2026-10-26T00:00:00.000Z",
    "news-gov-hk-top",
  );
  const nextGov = article(
    "https://www.news.gov.hk/eng/2026/10/new.htm",
    "new gov",
    "2026-10-28T02:00:00.000Z",
    "news-gov-hk-top",
  );
  const previous = {
    generatedAt: "2026-10-28T01:30:00.000Z",
    checkedAt: "2026-10-28T01:30:00.000Z",
    feeds: [rthkLocal, rthkWorld, newsGov].map((feed) => ({ ...feed, ok: true, error: null, articleCount: 1 })),
    articles: [keptLocal, droppedLocal, keptWorld, priorGov],
  };
  const { anySuccess, decision } = buildSnapshot({
    feeds: [rthkLocal, rthkWorld, newsGov],
    results: [
      { feed: rthkLocal, ok: false, error: "HTTP 502 Bad Gateway", articles: [] },
      { feed: rthkWorld, ok: false, error: "HTTP 502 Bad Gateway", articles: [] },
      { feed: newsGov, ok: true, error: null, articles: [nextGov] },
    ],
    previous,
    perFeed: 1,
    total: 150,
    now: new Date("2026-10-28T02:00:00.000Z"),
  });
  assert.equal(anySuccess, true);
  assert.equal(decision.write, true);
  assert.equal(decision.reason, "updated");
  assert.equal(decision.snapshot.checkedAt, "2026-10-28T02:00:00.000Z");
  assert.equal(decision.snapshot.generatedAt, "2026-10-28T02:00:00.000Z");
  assert.deepEqual(
    decision.snapshot.articles.map((item) => item.link),
    [nextGov.link, keptLocal.link, keptWorld.link],
  );
  assert.equal(decision.snapshot.articles.some((item) => item.link === priorGov.link), false);
  assert.equal(decision.snapshot.articles.some((item) => item.link === droppedLocal.link), false);
  for (const id of ["rthk-local", "rthk-world"]) {
    const feed = decision.snapshot.feeds.find((item) => item.id === id);
    assert.equal(feed.ok, false);
    assert.equal(feed.error, "HTTP 502 Bad Gateway");
    assert.equal(feed.articleCount, 1);
  }
  const gov = decision.snapshot.feeds.find((item) => item.id === "news-gov-hk-top");
  assert.equal(gov.ok, true);
  assert.equal(gov.error, null);
  assert.equal(gov.articleCount, 1);
});

test("buildSnapshot advances checkedAt and keeps generatedAt when a partial failure does not change stories", () => {
  const rthkLocal = catalogFeed("rthk-local");
  const newsGov = catalogFeed("news-gov-hk-top", "hk");
  const gov = article(
    "https://www.news.gov.hk/eng/2026/10/same.htm",
    "same gov",
    "2026-10-28T02:00:00.000Z",
    "news-gov-hk-top",
  );
  const local = article(
    "https://news.rthk.hk/rthk/en/component/k2/local-pipe",
    "Shau Kei Wan water supply returns after pipe burst",
    "2026-10-28T01:00:00.000Z",
    "rthk-local",
  );
  const previous = {
    generatedAt: "2026-10-28T01:30:00.000Z",
    checkedAt: "2026-10-28T01:30:00.000Z",
    feeds: [rthkLocal, newsGov].map((feed) => ({ ...feed, ok: true, error: null, articleCount: 1 })),
    articles: [gov, local],
  };
  const { decision } = buildSnapshot({
    feeds: [rthkLocal, newsGov],
    results: [
      { feed: rthkLocal, ok: false, error: "HTTP 502 Bad Gateway", articles: [] },
      { feed: newsGov, ok: true, error: null, articles: [gov] },
    ],
    previous,
    now: new Date("2026-10-28T02:05:00.000Z"),
  });
  assert.equal(decision.write, true);
  assert.equal(decision.reason, "checked");
  assert.equal(decision.snapshot.generatedAt, previous.generatedAt);
  assert.equal(decision.snapshot.checkedAt, "2026-10-28T02:05:00.000Z");
  assert.deepEqual(decision.snapshot.articles, previous.articles);
  const failed = decision.snapshot.feeds.find((feed) => feed.id === "rthk-local");
  assert.equal(failed.ok, false);
  assert.equal(failed.error, "HTTP 502 Bad Gateway");
  assert.equal(failed.articleCount, 1);
});

test("buildSnapshot keeps every failed RTHK feed when one other feed succeeds", () => {
  const failedIds = ["rthk-local", "rthk-greater-china", "rthk-world", "rthk-finance", "rthk-sport"];
  const failedFeeds = failedIds.map((id) => catalogFeed(id));
  const newsGov = catalogFeed("news-gov-hk-top", "hk");
  const prior = failedIds.map((id, index) => article(
    `https://news.rthk.hk/rthk/en/component/k2/${id}`,
    id,
    new Date(Date.UTC(2026, 9, 20, index)).toISOString(),
    id,
  ));
  const nextGov = article(
    "https://www.news.gov.hk/eng/2026/10/new.htm",
    "new gov",
    "2026-10-28T02:00:00.000Z",
    "news-gov-hk-top",
  );
  const previous = {
    generatedAt: "2026-10-28T01:30:00.000Z",
    checkedAt: "2026-10-28T01:30:00.000Z",
    feeds: [],
    articles: prior,
  };
  const { decision } = buildSnapshot({
    feeds: [...failedFeeds, newsGov],
    results: [
      ...failedFeeds.map((feed) => ({ feed, ok: false, error: "HTTP 502 Bad Gateway", articles: [] })),
      { feed: newsGov, ok: true, error: null, articles: [nextGov] },
    ],
    previous,
    now: new Date("2026-10-28T02:00:00.000Z"),
  });
  assert.equal(decision.write, true);
  assert.equal(decision.reason, "updated");
  assert.equal(decision.snapshot.checkedAt, "2026-10-28T02:00:00.000Z");
  assert.equal(decision.snapshot.generatedAt, "2026-10-28T02:00:00.000Z");
  for (const id of failedIds) {
    assert.equal(decision.snapshot.articles.filter((item) => item.sourceFeed === id).length, 1);
    const feed = decision.snapshot.feeds.find((item) => item.id === id);
    assert.equal(feed.ok, false);
    assert.equal(feed.error, "HTTP 502 Bad Gateway");
    assert.equal(feed.articleCount, 1);
  }
  assert.equal(decision.snapshot.articles.some((item) => item.link === nextGov.link), true);
});

test("buildSnapshot does not rewrite or move checkedAt when every feed fails", () => {
  const rthkLocal = catalogFeed("rthk-local");
  const newsGov = catalogFeed("news-gov-hk-top", "hk");
  const previous = {
    generatedAt: "2026-10-28T01:30:00.000Z",
    checkedAt: "2026-10-28T01:30:00.000Z",
    feeds: [rthkLocal, newsGov].map((feed) => ({ ...feed, ok: true, error: null, articleCount: 1 })),
    articles: [
      article("https://example.com/rthk", "local", "2026-10-28T01:00:00.000Z", "rthk-local"),
      article("https://example.com/gov", "gov", "2026-10-28T01:10:00.000Z", "news-gov-hk-top"),
    ],
  };
  const { anySuccess, decision } = buildSnapshot({
    feeds: [rthkLocal, newsGov],
    results: [
      { feed: rthkLocal, ok: false, error: "HTTP 502 Bad Gateway", articles: [] },
      { feed: newsGov, ok: false, error: "HTTP 502 Bad Gateway", articles: [] },
    ],
    previous,
    now: new Date("2026-10-28T02:00:00.000Z"),
  });
  assert.equal(anySuccess, false);
  assert.equal(decision.write, false);
  assert.equal(decision.reason, "all-failed");
  assert.equal(decision.snapshot, previous);
  assert.equal(decision.snapshot.checkedAt, "2026-10-28T01:30:00.000Z");
});

test("buildSnapshot does not treat a disabled feed as a successful check", () => {
  const rthkLocal = catalogFeed("rthk-local");
  const retired = { ...catalogFeed("retired", "hk"), enabled: false };
  const previous = {
    generatedAt: "2026-10-28T01:30:00.000Z",
    checkedAt: "2026-10-28T01:30:00.000Z",
    feeds: [],
    articles: [article("https://example.com/rthk", "local", "2026-10-28T01:00:00.000Z", "rthk-local")],
  };
  const { anySuccess, decision } = buildSnapshot({
    feeds: [rthkLocal, retired],
    results: [
      { feed: rthkLocal, ok: false, error: "HTTP 502 Bad Gateway", articles: [] },
      { feed: retired, ok: true, error: null, articles: [] },
    ],
    previous,
    now: new Date("2026-10-28T02:00:00.000Z"),
  });
  assert.equal(anySuccess, false);
  assert.equal(decision.write, false);
  assert.equal(decision.reason, "all-failed");
  assert.equal(decision.snapshot, previous);
});

test("ingest keeps prior RTHK articles when that feed returns HTTP 502 and another feed succeeds", async () => {
  const rthkUrl = "https://rthk.hk/rthk/news/rss/e_expressnews_elocal.xml";
  const govUrl = "https://www.news.gov.hk/en/common/html/topstories.rss.xml";
  const local = article(
    "https://news.rthk.hk/rthk/en/component/k2/local-pipe",
    "Shau Kei Wan water supply returns after pipe burst",
    "2026-10-28T01:00:00.000Z",
    "rthk-local",
  );
  local.title = "Shau Kei Wan water supply returns after pipe burst";
  local.source = "RTHK English — Local";
  const { feedsPath, outputPath, previous } = await writeFixture([
    ["rthk-local", "RTHK English — Local", rthkUrl, "rthk"],
    ["news-gov-hk-top", "news.gov.hk — Top Story", govUrl, "hk"],
  ], [
    local,
    article(
      "https://www.news.gov.hk/eng/2026/10/old.htm",
      "Old gov story",
      "2026-10-27T00:00:00.000Z",
      "news-gov-hk-top",
    ),
  ]);

  const govXml = `<?xml version="1.0"?><rss version="2.0"><channel><item>
    <title>New gov story</title>
    <link>https://www.news.gov.hk/eng/2026/10/new.htm</link>
    <pubDate>Tue, 28 Oct 2026 10:00:00 +0800</pubDate>
    <description>Fresh copy from news.gov.hk.</description>
  </item></channel></rss>`;
  const result = await ingest({
    feedsPath,
    outputPath,
    now: new Date("2026-10-28T02:00:00.000Z"),
    log() {},
    warn() {},
    fetchImpl: async (url) => {
      if (url === rthkUrl) return httpResponse(502, "Bad Gateway", "");
      if (url === govUrl) return httpResponse(200, "OK", govXml);
      throw new Error(`unexpected fetch ${url}`);
    },
  });

  assert.equal(result.wrote, true);
  assert.equal(result.reason, "updated");
  const written = JSON.parse(await readFile(outputPath, "utf8"));
  assert.equal(written.checkedAt, "2026-10-28T02:00:00.000Z");
  assert.equal(written.generatedAt, "2026-10-28T02:00:00.000Z");
  const rthk = written.articles.find((item) => item.sourceFeed === "rthk-local");
  assert.equal(rthk.title, "Shau Kei Wan water supply returns after pipe burst");
  assert.equal(rthk.link, previous.articles[0].link);
  assert.equal(written.articles.some((item) => item.link === "https://www.news.gov.hk/eng/2026/10/new.htm"), true);
  assert.equal(written.articles.some((item) => item.link === "https://www.news.gov.hk/eng/2026/10/old.htm"), false);
  const rthkFeed = written.feeds.find((feed) => feed.id === "rthk-local");
  assert.equal(rthkFeed.ok, false);
  assert.equal(rthkFeed.error, "HTTP 502 Bad Gateway");
  assert.equal(rthkFeed.articleCount, 1);
  const govFeed = written.feeds.find((feed) => feed.id === "news-gov-hk-top");
  assert.equal(govFeed.ok, true);
  assert.equal(govFeed.error, null);
  assert.equal(govFeed.articleCount, 1);
});

test("ingest leaves the snapshot file untouched when every feed fails", async () => {
  const rthkUrl = "https://rthk.hk/rthk/news/rss/e_expressnews_elocal.xml";
  const govUrl = "https://www.news.gov.hk/en/common/html/topstories.rss.xml";
  const { feedsPath, outputPath, raw } = await writeFixture([
    ["rthk-local", "RTHK English — Local", rthkUrl, "rthk"],
    ["news-gov-hk-top", "news.gov.hk — Top Story", govUrl, "hk"],
  ], [
    article("https://example.com/rthk", "local", "2026-10-28T01:00:00.000Z", "rthk-local"),
    article("https://example.com/gov", "gov", "2026-10-28T01:10:00.000Z", "news-gov-hk-top"),
  ]);
  const result = await ingest({
    feedsPath,
    outputPath,
    now: new Date("2026-10-28T02:00:00.000Z"),
    log() {},
    warn() {},
    fetchImpl: async () => httpResponse(502, "Bad Gateway", ""),
  });
  assert.equal(result.wrote, false);
  assert.equal(result.reason, "all-failed");
  assert.equal(result.articleCount, 2);
  assert.equal(await readFile(outputPath, "utf8"), raw);
  assert.deepEqual(result.feeds.map((feed) => [feed.id, feed.ok, feed.error]), [
    ["rthk-local", true, null],
    ["news-gov-hk-top", true, null],
  ]);
  assert.equal(JSON.parse(raw).checkedAt, "2026-10-28T01:30:00.000Z");
});

test("summarizeFeeds counts articles that survived the cap", () => {
  const feeds = [
    { ...FEED, id: "kept" },
    { ...FEED, id: "down", name: "Down" },
  ];
  const results = new Map([
    ["kept", { ok: true, error: null }],
    ["down", { ok: false, error: "HTTP 403" }],
  ]);
  const summary = summarizeFeeds(feeds, results, [
    { sourceFeed: "kept" },
    { sourceFeed: "kept" },
  ]);
  assert.equal(summary[0].articleCount, 2);
  assert.equal(summary[0].ok, true);
  assert.equal(summary[1].ok, false);
  assert.equal(summary[1].error, "HTTP 403");
  assert.equal(summary[1].articleCount, 0);
});

test("non-feed HTML is rejected", () => {
  assert.throws(() => assertFeedDocument("<!DOCTYPE html><title>Checking your browser...</title>"), /not RSS or Atom/);
  assert.doesNotThrow(() => assertFeedDocument("<?xml version='1.0'?><rss version='2.0'></rss>"));
});

test("approved catalog is the locked English list", () => {
  const raw = readFileSync(new URL("../public/data/feeds.json", import.meta.url), "utf8");
  const catalog = loadCatalog(raw);
  assert.equal(catalog.perFeed, 20);
  assert.equal(catalog.total, 150);
  assert.equal(JSON.parse(raw).caps.excerptWords, EXCERPT_WORDS);
  assert.deepEqual(catalog.feeds.map((feed) => [feed.id, feed.category, feed.url, feed.enabled]), [
    ["rthk-local", "rthk", "https://rthk.hk/rthk/news/rss/e_expressnews_elocal.xml", true],
    ["rthk-greater-china", "rthk", "https://rthk.hk/rthk/news/rss/e_expressnews_egreaterchina.xml", true],
    ["rthk-world", "rthk", "https://rthk.hk/rthk/news/rss/e_expressnews_einternational.xml", true],
    ["rthk-finance", "rthk", "https://rthk.hk/rthk/news/rss/e_expressnews_efinance.xml", true],
    ["rthk-sport", "rthk", "https://rthk.hk/rthk/news/rss/e_expressnews_esport.xml", true],
    ["news-gov-hk-top", "hk", "https://www.news.gov.hk/en/common/html/topstories.rss.xml", true],
    ["news-gov-hk-school-work", "hk", "https://www.news.gov.hk/en/categories/school_work/html/articlelist.rss.xml", true],
    ["rfa-english", "international", "https://www.rfa.org/english/rss", true],
    ["mit-technology-review", "international", "https://www.technologyreview.com/feed", true],
  ]);
  const urls = catalog.feeds.map((feed) => feed.url).join("\n");
  assert.equal(/scmp|bbci\.co\.uk|voanews|hongkongfp|dimsumdaily/i.test(urls), false);
});

function catalogFeed(id, category = "rthk") {
  return {
    id,
    name: id,
    url: `https://example.com/${id}.xml`,
    category,
    enabled: true,
  };
}

function httpResponse(status, statusText, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: {
      get(name) {
        return String(name).toLowerCase() === "content-type" ? "application/rss+xml; charset=utf-8" : null;
      },
    },
    arrayBuffer: async () => Buffer.from(body),
  };
}

async function writeFixture(feedRows, articles) {
  const dir = await mkdtemp(path.join(tmpdir(), "oxbridge-feeds-"));
  const feedsPath = path.join(dir, "feeds.json");
  const outputPath = path.join(dir, "articles.json");
  const feeds = feedRows.map(([id, name, url, category]) => ({
    id,
    name,
    url,
    category,
    enabled: true,
  }));
  const previous = {
    generatedAt: "2026-10-28T01:30:00.000Z",
    checkedAt: "2026-10-28T01:30:00.000Z",
    feeds: feeds.map((feed) => ({ ...feed, ok: true, error: null, articleCount: 1 })),
    articles,
  };
  const raw = `${JSON.stringify(previous, null, 2)}\n`;
  await writeFile(feedsPath, `${JSON.stringify({ caps: { perFeed: 20, total: 150 }, feeds }, null, 2)}\n`);
  await writeFile(outputPath, raw);
  return { feedsPath, outputPath, previous, raw };
}

function article(link, fullText, publishedAt, sourceFeed) {
  return {
    id: articleId(link),
    title: link,
    excerpt: fullText,
    fullText,
    imageUrl: null,
    publishedAt,
    source: sourceFeed,
    sourceFeed,
    link,
  };
}

function published(iso) {
  return iso;
}
