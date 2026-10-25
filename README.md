# oxbridge-news-reader

## RSS feeds

Approved English feeds live in [`public/data/feeds.json`](public/data/feeds.json). That catalog is the source of truth. Each entry has `id`, `name`, `url`, `category` (`rthk`, `hk`, or `international`), and `enabled`.

To change what gets ingested, edit the catalog and merge it to `main`. The fetch Action reads enabled feeds on its next run. The locked set is five RTHK English wires, Hong Kong Free Press, news.gov.hk Top Story, news.gov.hk At School, At Work, Dimsum Daily, and Radio Free Asia English.

| id | name | category | url |
| --- | --- | --- | --- |
| rthk-local | RTHK English — Local | rthk | https://rthk.hk/rthk/news/rss/e_expressnews_elocal.xml |
| rthk-greater-china | RTHK English — Greater China | rthk | https://rthk.hk/rthk/news/rss/e_expressnews_egreaterchina.xml |
| rthk-world | RTHK English — World | rthk | https://rthk.hk/rthk/news/rss/e_expressnews_einternational.xml |
| rthk-finance | RTHK English — Finance | rthk | https://rthk.hk/rthk/news/rss/e_expressnews_efinance.xml |
| rthk-sport | RTHK English — Sport | rthk | https://rthk.hk/rthk/news/rss/e_expressnews_esport.xml |
| hkfp | Hong Kong Free Press | hk | https://hongkongfp.com/feed/ |
| news-gov-hk-top | news.gov.hk — Top Story | hk | https://www.news.gov.hk/en/common/html/topstories.rss.xml |
| news-gov-hk-school-work | news.gov.hk — At School, At Work | hk | https://www.news.gov.hk/en/categories/school_work/html/articlelist.rss.xml |
| dimsum-daily | Dimsum Daily | hk | https://www.dimsumdaily.hk/feed/ |
| rfa-english | Radio Free Asia English | international | https://www.rfa.org/english/rss |

### Snapshot

`node scripts/fetch-feeds.mjs` fetches each enabled feed with a browser-like User-Agent and a 20 second timeout, parses RSS or Atom, and writes [`public/data/articles.json`](public/data/articles.json):

```json
{ "generatedAt": "ISO-8601", "feeds": [], "articles": [] }
```

`feeds` repeats the catalog row plus `ok`, `error`, and `articleCount` for that run. Each article has:

| field | meaning |
| --- | --- |
| id | First 16 hex characters of SHA-256 over the canonical link (fragment and trailing slash ignored). Guid is used when a link is missing. |
| title | Plain text |
| excerpt | Plain text, at most 280 characters |
| fullText | Plain text from `content:encoded` or `description`, whichever is longer. Script, style, and iframe blocks are removed. |
| imageUrl | `media:content`, `media:thumbnail`, `enclosure`, or an image in the feed HTML. `null` when the item has none. |
| publishedAt | ISO 8601 UTC, or `null` when the date is missing |
| source | Display name from the catalog |
| sourceFeed | Feed `id` |
| link | Absolute article URL |

Items are de-duplicated by link and sorted newest first. The catalog `caps` keep 20 items per feed and 150 articles in total.

A feed that returns an HTTP error, times out, or sends a non-feed page is logged and skipped. Articles from the feeds that succeeded are still written. The feed row keeps `ok: false` and the error text. When every enabled feed fails and a snapshot is already on disk, the script leaves that file unchanged. Hong Kong Free Press and Dimsum Daily sometimes answer datacenter addresses with a bot check; the next run that receives the feed fills those articles in.

Ingest dependencies are pinned in [`scripts/package.json`](scripts/package.json), separate from the Vite app manifest.

```bash
cd scripts
npm ci
npm test
cd ..
node scripts/fetch-feeds.mjs
```

### GitHub Action

[`.github/workflows/fetch-feeds.yml`](.github/workflows/fetch-feeds.yml) runs every 4 hours UTC and from a manual `workflow_dispatch`. It installs the pinned ingest dependencies, runs the script, and commits `public/data/articles.json` with the default `GITHUB_TOKEN` when the article list or feed status changed. Scheduled runs commit on `main`, which is what GitHub Pages publishes.

### Frontend

Vite copies `public/` into the site root. With base `/oxbridge-news-reader/`, the live file is:

https://ksloenglish.github.io/oxbridge-news-reader/data/articles.json

```js
const snapshot = await fetch(`${import.meta.env.BASE_URL}data/articles.json`).then((response) => {
  if (!response.ok) throw new Error(`articles.json HTTP ${response.status}`);
  return response.json();
});
```

The browser loads that file from the Pages origin. Publisher feed URLs are requested only by this script and the Action. CEFR tagging is a separate step and is not written into the snapshot.
