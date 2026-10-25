# K S Lo Oxbridge News Reader

K S Lo English news desk for school reading. Pick an English source, read the story, and study Oxbridge A1–C2 words in the text. Nothing in the reader calls an AI model.

Live site: https://ksloenglish.github.io/oxbridge-news-reader/

Vocabulary lives at `public/data/vocab.json`. Lookup rules are in `public/data/LOOKUP.md`.

## One-time GitHub Pages setup

Ken: in this repository open **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.

After that, `.github/workflows/deploy-pages.yml` publishes the site on every push to `main`. The workflow installs dependencies with pnpm, builds with `VITE_BASE_PATH=/${{ github.event.repository.name }}/`, uploads `dist`, and deploys with `actions/deploy-pages`. The project URL is https://ksloenglish.github.io/oxbridge-news-reader/.

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

- **News Desk** — source picker, story list, full text. The default source is **RTHK English News**: all five RTHK English channels (Local, Greater China, World, Finance, Sport). **Refresh** reloads the published article snapshot and shows the current source again. The open story ends with a count of highlighted words for each selected CEFR level. **All** turns every highlight level on, or off when every level is already on.
- **Word Bank** — words you save in this browser. Filter by CEFR, open a word, export CSV. **All** selects or clears every level. **Remove** asks before deleting one saved word. **Delete all** asks for confirmation, then removes every saved word. Levels with no saved words are greyed out. The word list scrolls inside a capped height. Highlight chips stay on News Desk only.
- **About** — what the desk does, and the publisher disclaimer.

The highlight chips, section, Word Bank filter, and export levels are stored in `localStorage`. Reloading the page returns the news source to All RTHK English, does not reopen the last story, and loads a fresh article snapshot, the same cache-bypass request **Refresh** uses.

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

Click a highlighted word for the CEFR pill, part of speech, Traditional Chinese glosses grouped by part of speech, IPA in `/.../` when the pack has `phonetic`, and **Listen (en-GB)** (`speechSynthesis`, British voice when the browser has one).

Save adds the word to Word Bank. If that lemma is already saved, the card says **Already in Word Bank** and offers Remove instead of a second save. The card shows the surface form when it differs from the headword. Copy uses the level checkboxes and includes the word, CEFR, part of speech, and definitions. Copy leaves out the surface form, lemma, IPA, source, and URL. CSV columns:

`word, CEFR, POS, defs`

## RSS feeds

Approved English feeds live in [`public/data/feeds.json`](public/data/feeds.json). That catalog is the source of truth. Each entry has `id`, `name`, `url`, `category` (`rthk`, `hk`, or `international`), and `enabled`.

To change what gets ingested, edit the catalog and merge it to `main`. The fetch Action reads enabled feeds on its next run. The locked set is five RTHK English wires, news.gov.hk Top Story, news.gov.hk At School, At Work, and Radio Free Asia English. Unstable sources stay out of the catalog.

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
| excerpt | Plain text, about 20 words. Longer text is cut on a word boundary and ends with an ellipsis. |
| fullText | Plain text from `content:encoded` or `description`, whichever is longer. Script, style, and iframe blocks are removed. |
| imageUrl | `media:content`, `media:thumbnail`, `enclosure`, or an image in the feed HTML. `null` when the item has none. |
| publishedAt | ISO 8601 UTC, or `null` when the date is missing |
| source | Display name from the catalog |
| sourceFeed | Feed `id` |
| link | Absolute article URL |

Items are de-duplicated by link and sorted newest first. The catalog `caps` keep 20 items per feed, 150 articles in total, and excerpts of about 20 words (`excerptWords`).

A feed that returns an HTTP error, times out, or sends a non-feed page is logged and skipped. Articles from the feeds that succeeded are still written. The feed row keeps `ok: false` and the error text. When every enabled feed fails and a snapshot is already on disk, the script leaves that file unchanged. A source that keeps failing is removed from the catalog instead of left enabled.

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

Glosses are the Traditional Chinese `tc` field. IPA is `phonetic`.

## Brand

K S Lo English. Ink `#111827`, paper `#f9f6f1`, accent `#b45309`, on-accent `#ffffff`, muted `#6b7280`. The header mark is the K S Lo English logo on the school plate `#1054a9` (3rem, radius 0.62rem, inset padding so the white mark does not touch the plate). The same crest, on that plate, is the favicon. The reader is light Oxbridge night only. The school plate is not a CEFR level colour.
