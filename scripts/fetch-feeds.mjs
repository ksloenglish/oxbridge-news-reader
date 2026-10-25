#!/usr/bin/env node
/**
 * Fetch the approved RSS/Atom catalog and write public/data/articles.json.
 *
 * Caps (overridable via public/data/feeds.json `caps`): 20 newest items per
 * feed, then 150 newest articles after de-duplicating by link.
 * Card excerpts are about 20 words. fullText is the cleaned article body.
 * A failed feed is logged and skipped. If every enabled feed fails and a
 * snapshot already exists, that file is left unchanged.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXCERPT_WORDS } from "./lib/html.mjs";
import { parseFeedXml } from "./lib/parse-feed.mjs";
import {
  DEFAULT_PER_FEED_CAP,
  DEFAULT_TOTAL_CAP,
  decideWrite,
  selectArticles,
  summarizeFeeds,
} from "./lib/snapshot.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FEEDS_PATH = path.join(ROOT, "public/data/feeds.json");
const OUT_PATH = path.join(ROOT, "public/data/articles.json");

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const TIMEOUT_MS = 20_000;
const MAX_BYTES = 8_000_000;
const FETCH_CONCURRENCY = 4;
const CATEGORIES = new Set(["rthk", "hk", "international"]);

export function assertFeedDocument(text) {
  const sample = String(text).slice(0, 5000).toLowerCase();
  if (sample.includes("<rss") || sample.includes("<feed") || sample.includes("<rdf:rdf")) return;
  throw new Error("response was not RSS or Atom");
}

function decodeXml(buffer, contentType) {
  const header = Buffer.from(buffer).subarray(0, 240).toString("latin1");
  const fromHeader = /charset=([^;]+)/i.exec(contentType || "")?.[1];
  const fromXml = /encoding=["']([^"']+)["']/i.exec(header)?.[1];
  let label = (fromHeader || fromXml || "utf-8").trim().replace(/["']/g, "").toLowerCase();
  if (label === "utf8") label = "utf-8";
  if (label === "gb2312" || label === "gbk") label = "gb18030";
  try {
    return new TextDecoder(label).decode(buffer).replace(/^\uFEFF/, "");
  } catch {
    return new TextDecoder("utf-8").decode(buffer).replace(/^\uFEFF/, "");
  }
}

export async function fetchFeedXml(url, fetchImpl = globalThis.fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5",
        "Accept-Language": "en-HK,en;q=0.9",
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
    }
    const advertised = Number(response.headers.get("content-length") || 0);
    if (advertised > MAX_BYTES) throw new Error(`feed exceeds ${MAX_BYTES} bytes`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_BYTES) throw new Error(`feed exceeds ${MAX_BYTES} bytes`);
    const xml = decodeXml(buffer, response.headers.get("content-type"));
    assertFeedDocument(xml);
    return xml;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`timeout after ${TIMEOUT_MS}ms`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function errorMessage(error) {
  const message = error?.message || String(error);
  return message.replace(/\s+/g, " ").slice(0, 300);
}

export function loadCatalog(raw) {
  const data = JSON.parse(raw);
  const feeds = Array.isArray(data) ? data : data.feeds;
  if (!Array.isArray(feeds) || feeds.length === 0) {
    throw new Error("feeds catalog must contain a non-empty feeds array");
  }
  const normalized = feeds.map((feed, index) => {
    for (const key of ["id", "name", "url", "category", "enabled"]) {
      if (feed?.[key] === undefined || feed?.[key] === null || feed[key] === "") {
        throw new Error(`feed at index ${index} is missing ${key}`);
      }
    }
    if (!CATEGORIES.has(feed.category)) {
      throw new Error(`feed ${feed.id} has unknown category ${feed.category}`);
    }
    try {
      const url = new URL(feed.url);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("bad protocol");
    } catch {
      throw new Error(`feed ${feed.id} has an invalid url`);
    }
    return {
      id: String(feed.id),
      name: String(feed.name),
      url: String(feed.url),
      category: feed.category,
      enabled: Boolean(feed.enabled),
    };
  });
  const ids = new Set();
  for (const feed of normalized) {
    if (ids.has(feed.id)) throw new Error(`duplicate feed id ${feed.id}`);
    ids.add(feed.id);
  }
  const perFeed = Number(data.caps?.perFeed ?? DEFAULT_PER_FEED_CAP);
  const total = Number(data.caps?.total ?? DEFAULT_TOTAL_CAP);
  if (!Number.isInteger(perFeed) || perFeed < 1 || !Number.isInteger(total) || total < 1) {
    throw new Error("caps.perFeed and caps.total must be positive integers");
  }
  return { feeds: normalized, perFeed, total };
}

async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function readPrevious(outputPath) {
  try {
    return JSON.parse(await readFile(outputPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    console.warn(`Ignoring unreadable snapshot (${errorMessage(error)}).`);
    return null;
  }
}

export async function ingest(options = {}) {
  const feedsPath = options.feedsPath ?? FEEDS_PATH;
  const outputPath = options.outputPath ?? OUT_PATH;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? new Date();
  const log = options.log ?? console.log;
  const warn = options.warn ?? console.warn;

  const catalog = loadCatalog(await readFile(feedsPath, "utf8"));
  const results = await mapPool(catalog.feeds, FETCH_CONCURRENCY, async (feed) => {
    if (!feed.enabled) {
      log(`[skip] ${feed.id}: disabled`);
      return { feed, ok: true, error: null, articles: [] };
    }
    try {
      const xml = await fetchFeedXml(feed.url, fetchImpl);
      const articles = parseFeedXml(xml, feed);
      log(`[ok] ${feed.id}: parsed ${articles.length}`);
      return { feed, ok: true, error: null, articles };
    } catch (error) {
      const message = errorMessage(error);
      warn(`[fail] ${feed.id}: ${message}`);
      return { feed, ok: false, error: message, articles: [] };
    }
  });

  const enabled = results.filter((result) => result.feed.enabled);
  const anySuccess = enabled.some((result) => result.ok);
  const articles = selectArticles(
    results.filter((result) => result.ok).map((result) => ({ articles: result.articles })),
    { perFeed: catalog.perFeed, total: catalog.total },
  );
  const feeds = summarizeFeeds(catalog.feeds, new Map(results.map((result) => [result.feed.id, result])), articles);
  const next = {
    generatedAt: now.toISOString(),
    feeds,
    articles,
  };
  const previous = await readPrevious(outputPath);
  const decision = decideWrite(previous, next, { anySuccess });

  if (!decision.write) {
    if (decision.reason === "all-failed") {
      warn("All enabled feeds failed; left the existing snapshot unchanged.");
    } else {
      log("Snapshot content unchanged; left public/data/articles.json as-is.");
    }
    return {
      wrote: false,
      reason: decision.reason,
      outputPath,
      articleCount: decision.snapshot.articles.length,
      feeds: decision.snapshot.feeds,
    };
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(decision.snapshot, null, 2)}\n`, "utf8");
  log(`Wrote ${articles.length} articles (per feed ${catalog.perFeed}, total ${catalog.total}, excerpt ${EXCERPT_WORDS} words) to ${path.relative(ROOT, outputPath)}`);
  return {
    wrote: true,
    reason: decision.reason,
    outputPath,
    articleCount: articles.length,
    feeds,
  };
}

const isDirectRun = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  ingest().catch((error) => {
    console.error(errorMessage(error));
    process.exitCode = 1;
  });
}
