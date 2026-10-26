# K S Lo Oxbridge News Reader

K S Lo English news desk for school reading. Pick an English source, read the story, and study Oxbridge A1–C2 words in the text. Nothing in the reader calls an AI model.

Live site: https://ksloenglish.github.io/oxbridge-news-reader/

Vocabulary lives at `public/data/vocab.json`. Lookup rules are in `public/data/LOOKUP.md`.

## One-time GitHub Pages setup

Ken: in this repository open **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.

After that, `.github/workflows/deploy-pages.yml` publishes the site on every push to `main` and from its own manual run. `.github/workflows/fetch-feeds.yml` refreshes the feeds on a schedule and from **Run workflow**. When the snapshot changes, that same Fetch run builds and deploys Pages, then commits the JSON. Both workflows install dependencies with pnpm, build with `VITE_BASE_PATH=/${{ github.event.repository.name }}/`, upload `dist`, and deploy with `actions/deploy-pages`. The project URL is https://ksloenglish.github.io/oxbridge-news-reader/.

## Run locally

Node 22 and pnpm 10.15.1.

```bash
pnpm install
pnpm dev
```

Open http://localhost:5173/. The dev server uses base path `/`.

```bash
pnpm test
VITE_BASE_PATH=/oxbridge-news-reader/ pnpm build
pnpm preview --host 127.0.0.1 --port 4173
```

The production preview is http://127.0.0.1:4173/oxbridge-news-reader/.

## Sections

- **News Desk** — source picker, story list, full text. The default source is **RTHK English News**: all five RTHK English channels (Local, Greater China, World, Finance, Sport). **Check for updates** re-reads the published article snapshot without reloading the page. It keeps the current source, an open story that is still in the list, the reading position, and the Word Bank. The desk does that same re-read about every 15 minutes, and again when you return to a background tab after that interval has passed. It does not fetch publisher RSS from the browser. A green tick beside the button confirms the check, then fades away. If the check fails, the desk still shows a short written note. Under the source picker, the desk says **Auto-updates through the day.** It also shows **Feeds checked** and **News changed**, with the time labeled HKT. A feed check older than 45 minutes is marked overdue, and a source that failed on the last check is named. Each story in the list and in the open story shows its publication time in HKT when `publishedAt` is present, and leaves the time out when it is not. The open story ends with a count of highlighted words for each selected CEFR level, then **Word Lists**: one card per selected level that has a match, using the same six CEFR colours. Each chip is the dictionary lemma and its part of speech (`disrupt (v)`, not `disrupting`). **Copy** puts those lines on the clipboard. Clicking a chip opens the same word card as a highlight in the text. **All** turns every highlight level on, or off when every level is already on.
- **Word Bank** — words you save in this browser. Filter by CEFR, open a word, export CSV. **All** selects or clears every level. **Remove** asks before deleting one saved word. **Delete all** asks for confirmation, then removes every saved word. Levels with no saved words are greyed out. The word list scrolls inside a capped height. Highlight chips stay on News Desk only.
- **About** — what the desk does, and the publisher disclaimer.

The highlight chips, section, Word Bank filter, and export levels are stored in `localStorage`. Reloading the page returns the news source to All RTHK English, does not reopen the last story, and loads a fresh article snapshot, the same cache-bypass request **Check for updates** uses.

Saved words stay on this device only. Clearing the site data or cache deletes them.

## CEFR colours

| Level | Text | Background | Default highlight |
| --- | --- | --- | --- |
| A1 | `#166534` | `#dcfce7` | off |
| A2 | `#b45309` | `#ffedd5` | off |
| B1 | `#0e7490` | `#cffafe` | off |
| B2 | `#1d4ed8` | `#dbeafe` | on |
| C1 | `#7e22ce` | `#f3e8ff` | on |
| C2 | `#be123c` | `#ffe4e6` | on |

These six hues are separate. None of them is the school plate `#1054a9`. A2 text uses the same amber as the accent, on its own peach background.

A word with more than one CEFR level is drawn with a **dashed outline** instead of a single colour. In the word card, senses that match the highlight chips stay under Definitions, and every part of speech is expanded in that list. Other levels sit under Other meanings. A hyphenated compound is not highlighted in pieces: in `K-pop`, neither `K` nor `pop` is marked. A standalone `pop` still is.

Mid-sentence lowercase `march` and `may` prefer the non-month sense. `March` and `May` with a capital prefer the month.

## Word card and export

Click a highlighted word for the CEFR pill, part of speech, and the Hong Kong Traditional Chinese gloss (`tc`), IPA in `/.../` when the pack has `phonetic`, and **Listen (en-GB)** (`speechSynthesis`, British voice when the browser has one). English `en` stays in the pack and is not shown on the card.

Save adds the word to Word Bank. If that lemma is already saved, the card says **Already in Word Bank** and offers Remove instead of a second save. The card shows the surface form when it differs from the headword. Copy uses the level checkboxes and includes the word, CEFR, part of speech, and definitions. Copy leaves out the surface form, lemma, IPA, source, and URL. CSV columns:

`word, CEFR, POS, defs`

## RSS feeds

Approved English feeds live in [`public/data/feeds.json`](public/data/feeds.json). That catalog is the source of truth. Each entry has `id`, `name`, `url`, `category` (`rthk`, `hk`, or `international`), and `enabled`.

To change what gets ingested, edit the catalog and merge it to `main`. The fetch Action reads enabled feeds on its next run. The locked set is five RTHK English wires, news.gov.hk Top Story, news.gov.hk At School, At Work, Radio Free Asia English, and MIT Technology Review. Unstable sources stay out of the catalog.

| id | name | category | url |
| --- | --- | --- | --- |
| rthk-local | RTHK English — Local | rthk | https://rthk.hk/rthk/news/rss/e_expressnews_elocal.xml |
| rthk-greater-china | RTHK English — Greater China | rthk | https://rthk.hk/rthk/news/rss/e_expressnews_egreaterchina.xml |
| rthk-world | RTHK English — World | rthk | https://rthk.hk/rthk/news/rss/e_expressnews_einternational.xml |
| rthk-finance | RTHK English — Finance | rthk | https://rthk.hk/rthk/news/rss/e_expressnews_efinance.xml |
| rthk-sport | RTHK English — Sport | rthk | https://rthk.hk/rthk/news/rss/e_expressnews_esport.xml |
| news-gov-hk-top | news.gov.hk — Top Story | hk | https://www.news.gov.hk/en/common/html/topstories.rss.xml |
| news-gov-hk-school-work | news.gov.hk — At School, At Work | hk | https://www.news.gov.hk/en/categories/school_work/html/articlelist.rss.xml |
| rfa-english | Radio Free Asia English | international | https://www.rfa.org/english/rss |
| mit-technology-review | MIT Technology Review | international | https://www.technologyreview.com/feed |

### Snapshot

`node scripts/fetch-feeds.mjs` fetches each enabled feed with a browser-like User-Agent and a 20 second timeout, parses RSS or Atom, and writes [`public/data/articles.json`](public/data/articles.json):

```json
{ "generatedAt": "ISO-8601", "checkedAt": "ISO-8601", "feeds": [], "articles": [] }
```

`generatedAt` is when the story list last changed. `checkedAt` is when a check last succeeded (at least one enabled feed). A quiet check updates `checkedAt` and leaves `generatedAt` where it is. A snapshot from before `checkedAt` existed shows `generatedAt` as the last check until the next successful fetch. `feeds` repeats the catalog row plus `ok`, `error`, and `articleCount` for that run. Each article has:

| field | meaning |
| --- | --- |
| id | First 16 hex characters of SHA-256 over the canonical link (fragment and trailing slash ignored). Guid is used when a link is missing. |
| title | Plain text |
| excerpt | Plain text, about 20 words. Longer text is cut on a word boundary and ends with an ellipsis. |
| fullText | Plain text from `content:encoded` or `description`, whichever is longer. Script, style, and iframe blocks are removed. |
| imageUrl | `media:content`, `media:thumbnail`, `enclosure`, or an image in the feed HTML. `null` when the item has none. |
| publishedAt | ISO 8601 UTC, or `null` when the date is missing |
| source | Display name from the catalog |
| sourceFeed | Feed `id` |
| link | Absolute article URL |

Items are de-duplicated by link and sorted newest first. The catalog `caps` keep 20 items per feed, 150 articles in total, and excerpts of about 20 words (`excerptWords`).

A feed that returns an HTTP error, times out, or sends a non-feed page is logged and skipped. Articles from the feeds that succeeded are still written. The feed row keeps `ok: false` and the error text. When every enabled feed fails and a snapshot is already on disk, the script leaves that file unchanged, so `checkedAt` stays on the last successful read. A source that keeps failing is removed from the catalog instead of left enabled.

Ingest dependencies are pinned in [`scripts/package.json`](scripts/package.json), separate from the Vite app manifest.

```bash
cd scripts
npm ci
npm test
cd ..
node scripts/fetch-feeds.mjs
```

### GitHub Action

[`.github/workflows/fetch-feeds.yml`](.github/workflows/fetch-feeds.yml) runs at minutes 8, 23, 38, and 53 UTC (`8 * * * *`, `23 * * * *`, `38 * * * *`, and `53 * * * *`) and from a manual `workflow_dispatch`. The start of the hour is when GitHub delays or drops scheduled runs, so none of the crons uses minute 0. The extra slots cover a missed run. GitHub may still start a run late. The 12/27/42/57 set from #28 did not restore schedule events; changing the expressions again re-arms the schedule when its associated actor has stopped firing.

The run installs the pinned ingest dependencies and fetches. When the story list, the feed status, or `checkedAt` changed, it builds the site and deploys GitHub Pages in that same run, using `GITHUB_TOKEN` with `contents: write`, `pages: write`, and `id-token: write`. It commits `public/data/articles.json` only after that deploy succeeds, so a failed publish is retried on the next run. A successful check writes `checkedAt` even when the stories are unchanged, and that file change is published so the desk can show the check time. `generatedAt` does not move on that quiet check. When every enabled feed fails, the file is left unchanged and the run skips the Pages build and the commit. That fetch does not take the Pages concurrency lock.

[`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml) publishes pushes to `main` and its own `workflow_dispatch`. It does not chain off Fetch with `workflow_run`. The snapshot push uses `GITHUB_TOKEN`, which does not start Deploy again, so a feed refresh produces one Pages deployment. Deploy holds the `github-pages` concurrency group for its whole run and checks out the latest `main` once the lock is free, so a queued code publish includes a snapshot that landed while it waited. Fetch holds that group only for the build and deploy that follow a changed snapshot. `queue: max` keeps a waiting publish instead of cancelling it.

### Frontend

Vite copies `public/` into the site root. With base `/oxbridge-news-reader/`, the live files are:

- https://ksloenglish.github.io/oxbridge-news-reader/data/articles.json
- https://ksloenglish.github.io/oxbridge-news-reader/data/feeds.json

```js
const snapshot = await fetch(`${import.meta.env.BASE_URL}data/articles.json`).then((response) => {
  if (!response.ok) throw new Error(`articles.json HTTP ${response.status}`);
  return response.json();
});
```

The browser loads that file from the Pages origin. Publisher feed URLs are requested only by the ingest script and the Action. CEFR tags are not written into the snapshot. The reader highlights words in the browser with `public/data/vocab.json`.

## Vocabulary lookup

`public/data/vocab.json` is the Lex pack (`words` keyed by lemma, `inflection_map` from surface form to a lemma or a list of lemmas). Client lookup:

1. Lowercase the token, then read `inflection_map` (string or string array).
2. Special-case `I`, `it`, and `IT` before a blind lowercase guess. `I` is the pronoun stored under `i`. Lowercase `it` prefers the pronoun; `IT` prefers the acronym.
3. If the map misses, try the token as a `words` key, then suffix heuristics for `-ed`, `-ing`, `-ies`, `-es`, and `-s`.
4. A sense with no `cefr` uses the headword’s `cefr`. A sense may carry its own `cefr` when the level differs.

The card, Word Bank, and copy/CSV show the Hong Kong Traditional Chinese `tc` field. English `en` stays in `vocab.json` and is not shown. If `tc` is empty, the gloss falls back to `defs`, then `definition`. IPA is `phonetic`. See `public/data/LOOKUP.md`.

## Brand

K S Lo English. Ink `#111827`, paper `#f9f6f1`, accent `#b45309`, on-accent `#ffffff`, muted `#6b7280`. The header mark is the K S Lo English logo on the school plate `#1054a9` (3rem, radius 0.62rem, inset padding so the white mark does not touch the plate). The same crest, on that plate, is the favicon. The link-preview image (`og.png`) uses that plate with square corners. The reader is light Oxbridge night only. The school plate is not a CEFR level colour.
