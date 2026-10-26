import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { AUTO_REFRESH_MS, applyPublishedSnapshot, quietRefreshAction } from "../src/auto-refresh.js";
import { FEED_CHECK_INTERVAL_MS } from "../src/data.js";

test("quiet refresh matches the 15 minute feed check interval", () => {
  assert.equal(AUTO_REFRESH_MS, 15 * 60 * 1000);
  assert.equal(AUTO_REFRESH_MS, FEED_CHECK_INTERVAL_MS);
});

test("quiet refresh waits out the interval, then catches up when a hidden tab returns", () => {
  const start = 1_000_000;
  assert.equal(quietRefreshAction({ now: start, lastCheckAt: start, hidden: false }), "wait");
  assert.equal(quietRefreshAction({
    now: start + AUTO_REFRESH_MS - 1,
    lastCheckAt: start,
    hidden: false,
  }), "wait");
  assert.equal(quietRefreshAction({
    now: start + AUTO_REFRESH_MS,
    lastCheckAt: start,
    hidden: false,
  }), "refresh");
  assert.equal(quietRefreshAction({
    now: start + AUTO_REFRESH_MS + 5_000,
    lastCheckAt: start,
    hidden: true,
  }), "wait");
  assert.equal(quietRefreshAction({
    now: start + AUTO_REFRESH_MS + 5_000,
    lastCheckAt: start,
    hidden: true,
    becameVisible: true,
  }), "refresh");
  assert.equal(quietRefreshAction({
    now: start + 1_000,
    lastCheckAt: start,
    becameVisible: true,
  }), "wait");
  assert.equal(quietRefreshAction({ now: start + AUTO_REFRESH_MS, lastCheckAt: Number.NaN }), "wait");
});

test("an in-flight check blocks a second quiet or manual start", () => {
  const now = 5_000_000;
  const due = { now, lastCheckAt: now - AUTO_REFRESH_MS, refreshing: true };
  assert.equal(quietRefreshAction({ ...due, hidden: false }), "wait");
  assert.equal(quietRefreshAction({ ...due, becameVisible: true }), "wait");
});

test("a quiet check keeps the source, open story, and word bank", () => {
  const words = [{ id: "w1", lemma: "harbour" }];
  const openHit = { hit: { lemma: "harbour" } };
  const kept = applyPublishedSnapshot({
    selection: "feed:rthk-local",
    articleId: "story-1",
    openHit,
    words,
  }, [{ id: "story-1" }, { id: "story-2" }]);
  assert.equal(kept.selection, "feed:rthk-local");
  assert.equal(kept.articleId, "story-1");
  assert.equal(kept.openHit, openHit);
  assert.equal(kept.words, words);

  const closed = applyPublishedSnapshot(kept, [{ id: "story-2" }]);
  assert.equal(closed.selection, "feed:rthk-local");
  assert.equal(closed.articleId, null);
  assert.equal(closed.openHit, null);
  assert.equal(closed.words, words);
});

test("the desk re-reads published articles.json and does not call GitHub", () => {
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(main, /articles\.json\?refresh=\$\{Date\.now\(\)\}`, \{ cache: "no-store" \}/);
  assert.equal(main.includes("api.github.com"), false);
  assert.equal(main.includes("raw.githubusercontent"), false);
  assert.match(main, /refreshArticles\(\{ automatic: true \}\)/);
  assert.match(main, /holdScroll\(\(\) => render\(\)\)/);
  assert.match(main, /Auto-updates through the day\./);
  assert.match(main, /Feeds checked /);
  assert.match(main, /News changed /);
  assert.equal(main.includes("Stories update automatically at different times of the day."), false);
  assert.equal(main.includes("Feeds last checked"), false);
  assert.equal(main.includes("News last changed"), false);
  assert.match(main, /Check for updates/);
  assert.match(main, /Stories checked\./);
});
