import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { EXCERPT_WORDS, extractImageFromHtml, htmlToText, makeExcerpt, wordsOf } from "./lib/html.mjs";
import { parseFeedXml, toIso } from "./lib/parse-feed.mjs";
import {
  articleId,
  canonicalLinkKey,
  decideWrite,
  selectArticles,
  summarizeFeeds,
} from "./lib/snapshot.mjs";
import { assertFeedDocument, loadCatalog } from "./fetch-feeds.mjs";

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
    ["ted-blog", "international", "https://blog.ted.com/feed/", true],
  ]);
  const urls = catalog.feeds.map((feed) => feed.url).join("\n");
  assert.equal(/scmp|bbci\.co\.uk|voanews|hongkongfp|dimsumdaily/i.test(urls), false);
});

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
