import {
  DEFAULT_SELECTION,
  articlesForSelection,
  categoryLabel,
  readCatalog,
  readSnapshot,
  selectionLabel,
  statusForSelection,
} from "./data.js";
import { toCsv, formatWordText, hitToRecord } from "./export.js";
import {
  LEVELS,
  annotate,
  countHighlightedLevels,
  createLexicon,
  wordListsByLevel,
  formatIpa,
  partitionSenses,
  posLabel,
  primaryEntry,
} from "./lookup.js";
import { activeSet, loadUi, loadWords, saveUi, saveWords } from "./storage.js";

const base = import.meta.env.BASE_URL;
const app = document.querySelector("#app");

const ui = loadUi();
let words = loadWords();
let catalog = { feeds: [], policy: "", caps: null };
let bundle = { articles: [], feeds: [], generatedAt: null };
let lex = null;
let loadError = "";
let openHit = null; // { hit, source }
let copyNote = "";
let bankId = null;
let confirmWipe = false;
let confirmRemoveId = null;
const listCopyText = new Map();
let refreshing = false;
let refreshNote = "";
const hits = [];

function persist() {
  saveUi(ui);
  saveWords(words);
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

function safeUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.href;
  } catch {
    /* ignore bad urls */
  }
  return "";
}

function formatWhen(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

async function loadData(name) {
  const response = await fetch(`${base}data/${name}`);
  if (!response.ok) throw new Error(`${name} HTTP ${response.status}`);
  return response.json();
}

function everyLevelOn(map) {
  return LEVELS.every((level) => map[level]);
}

/** All is on only when every level is on. Clicking it turns every level on, or off if they already are. */
function toggleLevel(map, level) {
  if (level === "all") {
    const next = !everyLevelOn(map);
    for (const item of LEVELS) map[item] = next;
    return;
  }
  if (LEVELS.includes(level)) map[level] = !map[level];
}

function levelButtons(map, dataAttr, emptyLevels = null) {
  const all = `<button type="button" class="level level-all" data-${dataAttr}="all" aria-pressed="${everyLevelOn(map) ? "true" : "false"}">All</button>`;
  const levels = LEVELS.map((level) => {
    const vacant = Boolean(emptyLevels?.has(level));
    return `<button type="button" class="level${vacant ? " is-empty" : ""}" data-level="${level}" data-${dataAttr}="${level}" aria-pressed="${map[level] ? "true" : "false"}"><i></i>${level}</button>`;
  }).join("");
  return all + levels;
}

function findSaved(record) {
  if (!record) return null;
  return (
    words.find((item) => item.id === record.id) ||
    words.find((item) => record.lemma && item.lemma === record.lemma) ||
    null
  );
}

function orderedLevels(levels) {
  const have = new Set(levels || []);
  return LEVELS.filter((level) => have.has(level));
}

function recordLevels(record) {
  if (record?.levels?.length) return orderedLevels(record.levels);
  return orderedLevels(String(record?.cefr || "").split("|"));
}

/** One level needs no chooser. Several levels use only the ones this word (or set) actually has. */
function levelsForCopy(levels) {
  const present = orderedLevels(levels);
  if (present.length <= 1) return new Set(present);
  return new Set(present.filter((level) => ui.exportLevels[level]));
}

function copyLevelsBox(levels) {
  const present = orderedLevels(levels);
  if (present.length < 2) return "";
  const boxes = present
    .map((level) => `<label><input type="checkbox" data-export="${level}" ${ui.exportLevels[level] ? "checked" : ""}/> ${level}</label>`)
    .join("");
  return `<div class="export-box"><span class="quiet">Copy levels</span>${boxes}</div>`;
}

function renderFooter() {
  return `
    <footer class="site-footer">
      <div class="footer-inner">
        <div class="build-stamp">${__KSLO_BUILD__}</div>
        <p>&copy; <span id="copyright-year">${__KSLO_YEAR__}</span> <a href="https://english.kslo.hk/" target="_blank" rel="noopener noreferrer">K S Lo English</a>. All Rights Reserved.</p>
      </div>
    </footer>`;
}

function renderAnnotated(text) {
  const levels = activeSet(ui.levels);
  return annotate(text, lex, levels)
    .map((part) => {
      if (part.type !== "hit") return esc(part.text);
      const id = hits.length;
      hits.push(part.hit);
      const label = part.style.kind === "multi"
        ? `${part.text}, more than one CEFR level`
        : `${part.text}, ${part.style.level}`;
      return `<button type="button" class="token ${part.style.kind}" data-level="${esc(part.style.level)}" data-hit="${id}" aria-label="${esc(label)}">${esc(part.text)}</button>`;
    })
    .join("");
}

function paragraphs(text) {
  const blocks = String(text || "")
    .split(/\n{2,}|\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (!blocks.length) return "<p>This snapshot has no article text.</p>";
  return blocks.map((part) => `<p>${renderAnnotated(part)}</p>`).join("");
}

function feedOptions() {
  const categories = [];
  const seen = new Set();
  for (const feed of catalog.feeds) {
    if (!feed.category || seen.has(feed.category)) continue;
    seen.add(feed.category);
    categories.push(feed.category);
  }
  return categories
    .map((category) => {
      const members = catalog.feeds.filter((feed) => feed.category === category);
      const label = categoryLabel(category);
      const allLabel = category === "rthk" ? "All RTHK English" : `All ${label}`;
      const all = members.length > 1 ? `<option value="category:${esc(category)}">${esc(allLabel)}</option>` : "";
      const items = members
        .map((feed) => `<option value="feed:${esc(feed.id)}">${esc(feed.name)}</option>`)
        .join("");
      return `<optgroup label="${esc(label)}">${all}${items}</optgroup>`;
    })
    .join("");
}

function currentArticles() {
  return articlesForSelection(catalog, bundle, ui.selection);
}

function renderShell() {
  const highlightRow = ui.section === "news"
    ? `<div class="level-row">
        <p>Highlight</p>
        ${levelButtons(ui.levels, "highlight")}
        <p class="hint">Dashed outline means more than one CEFR level. Default is B2, C1, and C2.</p>
      </div>`
    : "";
  return `
    <header class="top">
      <div class="top-row">
        <div class="brand">
          <div class="mark"><img src="${base}branding/kslo-english-logo.png" alt="K S Lo English" /></div>
          <div class="titles">
            <p class="eyebrow">K S Lo English</p>
            <h1>Oxbridge News Reader</h1>
          </div>
        </div>
        <nav class="nav" aria-label="Sections">
          <button type="button" data-section="news" aria-pressed="${ui.section === "news" ? "true" : "false"}">News Desk</button>
          <button type="button" data-section="bank" aria-pressed="${ui.section === "bank" ? "true" : "false"}">Word Bank</button>
          <button type="button" data-section="about" aria-pressed="${ui.section === "about" ? "true" : "false"}">About</button>
        </nav>
      </div>
      ${highlightRow}
    </header>
    <main class="view" id="view">${ui.section === "bank" ? renderBank() : ui.section === "about" ? renderAbout() : renderNews()}</main>
    ${renderFooter()}
    <div id="modal"></div>
  `;
}

function renderNews() {
  const articles = currentArticles();
  const current = articles.find((article) => article.id === ui.articleId) || null;
  const reading = Boolean(current);
  const list = articles.length
    ? articles
        .map((article) => {
          return `<button type="button" class="story" data-article="${esc(article.id)}" aria-current="${article.id === current?.id ? "true" : "false"}">
            <span class="kicker">${esc(article.source || "")}</span>
            <strong>${esc(article.title)}</strong>
            <span class="excerpt">${esc(article.excerpt)}</span>
            <span class="meta">${esc(formatWhen(article.publishedAt))}</span>
          </button>`;
        })
        .join("")
    : `<p class="empty">${esc(emptySelectionNote())}</p>`;

  const reader = current
    ? `<div class="pane reader"><article class="reader">
        <button type="button" class="back back-stories" data-close-article>All stories</button>
        <p class="kicker">${esc(current.source || selectionLabel(catalog, ui.selection))}</p>
        <h2>${renderAnnotated(current.title)}</h2>
        <p class="meta">${esc(formatWhen(current.publishedAt))}${current.link ? ` · <a class="original" href="${esc(safeUrl(current.link))}" target="_blank" rel="noopener noreferrer">Original article</a>` : ""}</p>
        ${current.imageUrl && safeUrl(current.imageUrl) ? `<img class="hero" alt="" src="${esc(safeUrl(current.imageUrl))}" />` : ""}
        <div class="body">${paragraphs(current.fullText)}</div>
        ${highlightSummary(current)}
        ${renderWordLists(current)}
      </article></div>`
    : "";

  return `
    <section class="desk${reading ? " reading" : ""}" aria-label="${esc(selectionLabel(catalog, ui.selection))}">
      <div class="pane list-pane">
        <div class="toolbar">
          <label class="field">News source
            <select data-feed aria-label="News source">${feedOptions()}</select>
          </label>
          <button type="button" class="ghost" data-refresh ${refreshing ? "disabled" : ""}>${refreshing ? "Refreshing…" : "Refresh"}</button>
        </div>
        ${refreshNote ? `<p class="quiet" aria-live="polite">${esc(refreshNote)}</p>` : ""}
        ${list}
      </div>
      ${reader}
    </section>`;
}

function renderAbout() {
  return `
    <section class="about" aria-labelledby="about-title">
      <h2 id="about-title">About</h2>
      <p>K S Lo Oxbridge News Reader is an English news desk designed for school reading. It brings together stories from approved RSS feeds and highlights words from the Oxbridge A1–C2 word list, helping you build vocabulary through real news.</p>
      <p>On News Desk, select a source and open a story. Choose the CEFR levels you want to highlight, then click a highlighted word to see its meaning, part of speech, and Traditional Chinese translation. Click Listen to hear the word pronounced in British English, or Save to add it to your Word Bank on this device. In Word Bank, you can filter saved words by level and export them as a CSV file.</p>
      <p class="disclaimer">News articles are provided by their original publishers for language learning. They belong to those sources and do not represent the views of K S Lo English.</p>
    </section>`;
}

function highlightSummary(article) {
  const levels = activeSet(ui.levels);
  const selected = LEVELS.filter((level) => levels.has(level));
  if (!selected.length) {
    return `<aside class="cefr-summary" aria-label="Highlighted words"><h3>Highlighted words</h3><p class="quiet">No highlight levels are selected.</p></aside>`;
  }
  const counts = Object.fromEntries(LEVELS.map((level) => [level, 0]));
  const blocks = String(article.fullText || "")
    .split(/\n{2,}|\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  for (const text of [article.title, ...blocks]) {
    const part = countHighlightedLevels(text, lex, levels);
    for (const level of selected) counts[level] += part[level] || 0;
  }
  const items = selected
    .map((level) => `<li><span class="pill" data-level="${esc(level)}">${esc(level)}</span> <span>${counts[level]}</span></li>`)
    .join("");
  return `<aside class="cefr-summary" aria-label="Highlighted words"><h3>Highlighted words</h3><ul>${items}</ul></aside>`;
}

function wordListLine(item) {
  return item.pos ? `${item.lemma} (${item.pos})` : item.lemma;
}

function articleParts(article) {
  const blocks = String(article.fullText || "")
    .split(/\n{2,}|\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  return [article.title, ...blocks];
}

function renderWordLists(article) {
  const allow = activeSet(ui.levels);
  const selected = LEVELS.filter((level) => allow.has(level));
  const lists = selected.length
    ? wordListsByLevel(articleParts(article).flatMap((text) => annotate(text, lex, allow)), allow)
        .filter((group) => selected.includes(group.level) && group.items.length)
    : [];
  listCopyText.clear();
  if (!lists.length) {
    const note = selected.length ? "No highlighted words in this story." : "No highlight levels are selected.";
    return `<section class="word-lists" aria-label="Word lists"><h3>Word Lists</h3><p class="quiet">${note}</p></section>`;
  }
  const cards = lists.map((group) => {
    const lines = group.items.map(wordListLine);
    listCopyText.set(group.level, lines.join("\n"));
    const count = group.items.length === 1 ? "1 word" : `${group.items.length} words`;
    const chips = group.items.map((item) => {
      const id = hits.length;
      hits.push(item.hit);
      const pos = item.pos ? ` <span class="pos">(${esc(item.pos)})</span>` : "";
      return `<button type="button" class="lemma-chip" data-hit="${id}">${esc(item.lemma)}${pos}</button>`;
    }).join("");
    return `<article class="level-card" data-level="${esc(group.level)}">
      <header>
        <i class="level-dot" aria-hidden="true"></i>
        <h4>${esc(group.level)} Words</h4>
        <div class="level-tools">
          <span class="level-count">${esc(count)}</span>
          <button type="button" class="ghost copy-list" data-copy-list="${esc(group.level)}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 7V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-2M8 7H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-2M8 7h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
            <span class="copy-label">Copy</span>
          </button>
        </div>
      </header>
      <div class="lemma-chips">${chips}</div>
    </article>`;
  }).join("");
  return `<section class="word-lists" aria-label="Word lists"><h3>Word Lists</h3>${cards}</section>`;
}

function emptySelectionNote() {
  const rows = statusForSelection(catalog, bundle, ui.selection).filter((feed) => feed.ok === false);
  if (!rows.length) return "No stories in this snapshot yet.";
  const detail = rows
    .map((feed) => feed.error)
    .filter(Boolean)
    .join(" ");
  return detail
    ? `No stories in this snapshot yet. ${detail}`
    : "No stories in this snapshot yet.";
}

function wordMatchesBank(record) {
  const allow = activeSet(ui.bankLevels);
  const levels = record.levels?.length ? record.levels : String(record.cefr || "").split("|");
  return levels.some((level) => allow.has(level));
}

function renderBank() {
  const visible = words.filter(wordMatchesBank);
  const current = visible.find((record) => record.id === bankId) || words.find((record) => record.id === bankId) || null;
  const reading = Boolean(current);
  const list = visible.length
    ? visible
        .map((record) => {
          const pills = (record.levels || []).map((level) => `<span class="pill" data-level="${esc(level)}">${esc(level)}</span>`).join("");
          return `<button type="button" class="word-row" data-word="${esc(record.id)}" aria-current="${record.id === current?.id ? "true" : "false"}">
            <b>${esc(record.word)}</b><span class="pills">${pills}</span>
          </button>`;
        })
        .join("")
    : `<p class="empty">${words.length ? "No saved words at these levels." : "No saved words yet. Highlight a word in News Desk and save it."}</p>`;

  const detail = current
    ? `<article class="detail">
        <button type="button" class="ghost back" data-close-word>All saved words</button>
        ${renderRecordBody(current)}
        ${copyLevelsBox(recordLevels(current))}
        ${confirmRemoveId === current.id
          ? `<div class="confirm-wipe" role="group" aria-label="Confirm remove">
              <p>Remove this saved word from this browser? This cannot be undone.</p>
              <div class="actions">
                <button type="button" class="solid" data-remove-confirm>Remove</button>
                <button type="button" class="ghost" data-remove-cancel>Cancel</button>
              </div>
            </div>`
          : `<div class="actions">
              <button type="button" class="ghost" data-remove-word="${esc(current.id)}">Remove</button>
            </div>`}
      </article>`
    : `<div class="detail"><p class="empty">Open a saved word to see its glosses.</p></div>`;

  const present = new Set(words.flatMap((record) => recordLevels(record)));
  const emptyLevels = new Set(LEVELS.filter((level) => !present.has(level)));
  const wipe = !words.length
    ? ""
    : confirmWipe
      ? `<div class="confirm-wipe" role="group" aria-label="Confirm delete all">
          <p>Delete every saved word in this browser? This cannot be undone.</p>
          <div class="actions">
            <button type="button" class="solid" data-wipe-confirm>Delete all</button>
            <button type="button" class="ghost" data-wipe-cancel>Cancel</button>
          </div>
        </div>`
      : `<div class="actions"><button type="button" class="ghost" data-wipe>Delete all</button></div>`;
  return `
    <section class="bank${reading ? " reading" : ""}">
      <div class="pane list-pane">
        <h2>Word Bank</h2>
        <p class="warn">Saved words stay in this browser only. Clearing the site data or cache deletes them. They are not sent to a server.</p>
        <div class="export-box" aria-label="Word bank levels">
          ${levelButtons(ui.bankLevels, "bank", emptyLevels)}
        </div>
        <div class="word-list">
          ${list}
        </div>
        ${wipe}
        <h3 class="kicker">Export</h3>
        ${bankExportBox(visible)}
      </div>
      <div class="pane detail">
        ${detail}
      </div>
    </section>`;
}

function bankExportBox(records) {
  const present = orderedLevels(records.flatMap((record) => recordLevels(record)));
  const choices = present.length > 1
    ? present
        .map((level) => `<label><input type="checkbox" data-export="${level}" ${ui.exportLevels[level] ? "checked" : ""}/> ${level}</label>`)
        .join("")
    : "";
  const lead = present.length > 1 ? `<p class="quiet">Choose which CEFR levels to include, then download a CSV.</p>` : "";
  return `${lead}<div class="export-box">${choices}<button type="button" class="solid" data-csv>Export CSV</button></div>`;
}

function renderRecordBody(record) {
  const allow = levelsForCopy(recordLevels(record));
  const senses = (record.senses || []).filter((sense) => allow.has(sense.cefr));
  const other = (record.senses || []).filter((sense) => !allow.has(sense.cefr));
  const pills = [...new Set((record.levels || []).concat(senses.map((sense) => sense.cefr)))]
    .filter(Boolean)
    .map((level) => `<span class="pill" data-level="${esc(level)}">${esc(level)}</span>`)
    .join("");
  return `
    <p class="pills">${pills}</p>
    <h2>${esc(record.word)}</h2>
    <p class="ipa">${esc(formatIpa(record.ipa) || "")}</p>
    <button type="button" class="ghost" data-speak="${esc(record.word)}">Listen (en-GB)</button>
    ${senseBlocks(senses, "")}
    ${other.length ? senseBlocks(other, "Other meanings", true) : ""}
  `;
}

function senseBlocks(rows, title, quiet = false) {
  if (!rows.length) return "";
  const grouped = new Map();
  for (const row of rows) {
    const key = row.pos || "—";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  const body = [...grouped.entries()]
    .map(([pos, senses]) => {
      const lines = senses
        .map((sense) => `<p class="sense ${quiet ? "other" : ""}"><span class="pill" data-level="${esc(sense.cefr)}">${esc(sense.cefr)}</span> ${esc(sense.text)}</p>`)
        .join("");
      return `<h4>${esc(posLabel(pos))}</h4>${lines}`;
    })
    .join("");
  return `${title ? `<h4>${esc(title)}</h4>` : ""}${body}`;
}

function renderCard() {
  const root = document.querySelector("#modal");
  if (!root) return;
  if (!openHit) {
    root.innerHTML = "";
    return;
  }
  const hit = openHit.hit;
  if (!hit) {
    root.innerHTML = "";
    return;
  }
  const record = hitToRecord(hit, openHit.source);
  const saved = findSaved(record);
  const parts = partitionSenses(hit, activeSet(ui.levels));
  const entry = primaryEntry(hit);
  const pills = hit.levels.map((level) => `<span class="pill" data-level="${esc(level)}">${esc(level)}</span>`).join("");
  const facePos = parts.match.map((sense) => sense.pos);
  const pos = [...new Set(facePos.length ? facePos : hit.reading.flatMap((item) => item.pos))].map(posLabel).join(" · ");
  root.innerHTML = `
    <div class="backdrop" data-backdrop>
      <div class="card" role="dialog" aria-modal="true" aria-labelledby="card-title">
        <header>
          <div>
            <div class="pills">${pills}</div>
            <h3 id="card-title">${esc(entry.word)}</h3>
            <p class="meta">${esc(pos)}${hit.surface.toLowerCase() !== entry.word.toLowerCase() ? ` · in the article: ${esc(hit.surface)}` : ""}</p>
          </div>
          <button type="button" class="close" data-close-card aria-label="Close">×</button>
        </header>
        <p class="ipa">${esc(formatIpa(entry.phonetic))}</p>
        <button type="button" class="ghost" data-speak="${esc(entry.word)}">Listen (en-GB)</button>
        ${renderSenseGroup([...parts.match, ...parts.secondary], "Definitions")}
        ${parts.other.length ? renderSenseGroup(parts.other, "Other meanings", true) : ""}
        ${parts.alternates.length ? renderSenseGroup(parts.alternates, "Other readings", true) : ""}
        ${copyLevelsBox(hit.levels)}
        ${saved ? `<p class="already">Already in Word Bank</p>` : ""}
        <div class="actions">
          ${saved
            ? `<button type="button" class="ghost" data-unsave>Remove</button>`
            : `<button type="button" class="solid" data-save>Save to Word Bank</button>`}
          <button type="button" class="ghost" data-copy>Copy word</button>
        </div>
        <p class="copied" aria-live="polite">${esc(copyNote)}</p>
      </div>
    </div>`;
  root.querySelector("[data-close-card]")?.focus();
}

function renderSenseGroup(rows, title, quiet = false) {
  if (!rows.length) return "";
  const grouped = new Map();
  for (const row of rows) {
    const key = `${row.pos}::${row.word}`;
    if (!grouped.has(key)) grouped.set(key, { pos: row.pos, word: row.word, rows: [] });
    grouped.get(key).rows.push(row);
  }
  const many = new Set(rows.map((row) => row.lemma)).size > 1;
  const body = [...grouped.values()]
    .map((group) => {
      const lines = group.rows
        .map((row) => `<p class="sense ${quiet ? "other" : ""}"><span class="pill" data-level="${esc(row.cefr)}">${esc(row.cefr)}</span> ${esc(row.text)}</p>`)
        .join("");
      const head = many ? `${posLabel(group.pos)} · ${group.word}` : posLabel(group.pos);
      return `<h4 class="pos-label">${esc(head)}</h4>${lines}`;
    })
    .join("");
  return `${title ? `<h4>${esc(title)}</h4>` : ""}${body}`;
}

function render() {
  hits.length = 0;
  app.classList.remove("boot");
  if (loadError) {
    app.innerHTML = `<div class="app"><div class="status"><p>${esc(loadError)}</p></div>${renderFooter()}</div>`;
    return;
  }
  app.innerHTML = `<div class="app">${renderShell()}</div>`;
  const select = app.querySelector("[data-feed]");
  if (select) {
    const known = [...select.options].some((option) => option.value === ui.selection);
    select.value = known ? ui.selection : DEFAULT_SELECTION;
    if (!known) ui.selection = select.value || DEFAULT_SELECTION;
  }
  const image = app.querySelector(".hero");
  if (image) {
    image.addEventListener("error", () => {
      image.remove();
    });
  }
  renderCard();
}

function scrollViewToTop() {
  const reset = () => {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    for (const el of app.querySelectorAll(".pane, .word-list")) el.scrollTop = 0;
  };
  reset();
  requestAnimationFrame(reset);
}

function speak(text) {
  if (!window.speechSynthesis || !text) return;
  const utterance = new SpeechSynthesisUtterance(text);
  const voices = window.speechSynthesis.getVoices();
  const voice = voices.find((item) => /^en-GB/i.test(item.lang)) || voices.find((item) => /^en/i.test(item.lang));
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  } else {
    utterance.lang = "en-GB";
  }
  utterance.rate = 0.95;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

app.addEventListener("click", (event) => {
  const section = event.target.closest("[data-section]");
  if (section) {
    const next = section.dataset.section;
    const changed = next !== ui.section;
    ui.section = next;
    openHit = null;
    persist();
    render();
    if (changed) scrollViewToTop();
    return;
  }
  const highlight = event.target.closest("[data-highlight]");
  if (highlight) {
    toggleLevel(ui.levels, highlight.dataset.highlight);
    persist();
    render();
    return;
  }
  const bankLevel = event.target.closest("[data-bank]");
  if (bankLevel) {
    toggleLevel(ui.bankLevels, bankLevel.dataset.bank);
    persist();
    render();
    return;
  }
  const article = event.target.closest("[data-article]");
  if (article) {
    ui.articleId = article.dataset.article;
    ui.section = "news";
    openHit = null;
    persist();
    render();
    return;
  }
  if (event.target.closest("[data-close-article]")) {
    ui.articleId = null;
    persist();
    render();
    return;
  }
  const copyList = event.target.closest("[data-copy-list]");
  if (copyList) {
    const text = listCopyText.get(copyList.dataset.copyList) || "";
    const label = copyList.querySelector(".copy-label");
    const write = navigator.clipboard?.writeText?.(text);
    if (!write) {
      if (label) label.textContent = "Could not copy";
      return;
    }
    write.then(
      () => { if (label) label.textContent = "Copied"; },
      () => { if (label) label.textContent = "Could not copy"; },
    );
    return;
  }
  const token = event.target.closest("[data-hit]");
  if (token) {
    const article = currentArticles().find((item) => item.id === ui.articleId);
    openHit = {
      hit: hits[Number(token.dataset.hit)],
      source: { title: article?.title || "", url: article?.link || "" },
    };
    copyNote = "";
    renderCard();
    return;
  }
  const word = event.target.closest("[data-word]");
  if (word) {
    if (word.dataset.word !== bankId) confirmRemoveId = null;
    bankId = word.dataset.word;
    render();
    return;
  }
  if (event.target.closest("[data-close-word]")) {
    bankId = null;
    confirmRemoveId = null;
    render();
    return;
  }
  const remove = event.target.closest("[data-remove-word]");
  if (remove) {
    confirmRemoveId = remove.dataset.removeWord || null;
    render();
    return;
  }
  if (event.target.closest("[data-remove-confirm]")) {
    const id = confirmRemoveId;
    confirmRemoveId = null;
    if (id) {
      words = words.filter((item) => item.id !== id);
      if (bankId === id) bankId = null;
      persist();
    }
    render();
    return;
  }
  if (event.target.closest("[data-remove-cancel]")) {
    confirmRemoveId = null;
    render();
    return;
  }
  if (event.target.closest("[data-csv]")) {
    downloadCsv();
    return;
  }
  if (event.target.closest("[data-close-card]") || event.target.matches("[data-backdrop]")) {
    openHit = null;
    copyNote = "";
    renderCard();
    return;
  }
  const say = event.target.closest("[data-speak]");
  if (say) {
    speak(say.dataset.speak);
    return;
  }
  if (event.target.closest("[data-wipe-confirm]")) {
    words = [];
    bankId = null;
    confirmWipe = false;
    confirmRemoveId = null;
    openHit = null;
    persist();
    render();
    return;
  }
  if (event.target.closest("[data-wipe-cancel]")) {
    confirmWipe = false;
    render();
    return;
  }
  if (event.target.closest("[data-wipe]")) {
    if (!words.length) return;
    confirmWipe = true;
    render();
    return;
  }
  if (event.target.closest("[data-refresh]")) {
    refreshArticles();
    return;
  }
  if (event.target.closest("[data-save]") && openHit) {
    const hit = openHit.hit;
    if (!hit) return;
    const record = hitToRecord(hit, openHit.source);
    if (findSaved(record)) return;
    words = [record, ...words];
    persist();
    copyNote = "";
    renderCard();
    return;
  }
  if (event.target.closest("[data-unsave]") && openHit) {
    const hit = openHit.hit;
    if (!hit) return;
    const record = hitToRecord(hit, openHit.source);
    const saved = findSaved(record);
    if (!saved) return;
    words = words.filter((item) => item.id !== saved.id);
    if (bankId === saved.id) bankId = null;
    persist();
    copyNote = "Removed from Word Bank.";
    renderCard();
    return;
  }
  if (event.target.closest("[data-copy]") && openHit) {
    const hit = openHit.hit;
    if (!hit) return;
    const record = hitToRecord(hit, openHit.source);
    const text = formatWordText(record, levelsForCopy(hit.levels));
    navigator.clipboard?.writeText(text).then(
      () => {
        copyNote = "Copied.";
        renderCard();
      },
      () => {
        copyNote = "Could not copy. Select the text from the card instead.";
        renderCard();
      },
    );
  }
});

app.addEventListener("change", (event) => {
  const target = event.target;
  if (target.matches("[data-feed]")) {
    ui.selection = target.value;
    ui.articleId = null;
    openHit = null;
    persist();
    render();
    return;
  }
  if (target.matches("[data-export]")) {
    ui.exportLevels[target.dataset.export] = target.checked;
    persist();
    if (ui.section === "bank") render();
    else renderCard();
  }
});

function wheelDeltaY(event) {
  if (event.deltaMode === 1) return event.deltaY * 16;
  if (event.deltaMode === 2) return event.deltaY * window.innerHeight;
  return event.deltaY;
}

function isYScroller(el) {
  const overflow = getComputedStyle(el).overflowY;
  return (overflow === "auto" || overflow === "scroll") && el.scrollHeight - el.clientHeight > 1;
}

function canScrollY(el, delta) {
  const max = el.scrollHeight - el.clientHeight;
  if (max <= 1) return false;
  if (delta > 0) return el.scrollTop < max - 1;
  return el.scrollTop > 0;
}

// At a column or word-list boundary, keep the wheel moving the page so the footer is reachable.
app.addEventListener("wheel", (event) => {
  if (event.ctrlKey) return;
  const delta = wheelDeltaY(event);
  if (!delta) return;
  const target = event.target instanceof Element ? event.target : null;
  if (!target || target.closest(".backdrop")) return;
  const scrollers = [];
  let node = target;
  while (node && node !== app) {
    if (node.matches?.(".pane, .word-list")) scrollers.push(node);
    node = node.parentElement;
  }
  const active = scrollers.filter(isYScroller);
  if (!active.length) return;
  if (canScrollY(active[0], delta)) return;
  event.preventDefault();
  let leftover = delta;
  for (const el of active) {
    const max = el.scrollHeight - el.clientHeight;
    const before = el.scrollTop;
    const next = Math.max(0, Math.min(max, before + leftover));
    if (next !== before) el.scrollTop = next;
    leftover -= next - before;
    if (Math.abs(leftover) < 0.5) return;
  }
  window.scrollBy(0, leftover);
}, { passive: false });

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && openHit) {
    openHit = null;
    copyNote = "";
    renderCard();
  }
});

async function fetchSnapshot() {
  const response = await fetch(`${base}data/articles.json?refresh=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`articles.json HTTP ${response.status}`);
  return readSnapshot(await response.json());
}

async function refreshArticles() {
  if (refreshing) return;
  refreshing = true;
  refreshNote = "";
  render();
  try {
    bundle = await fetchSnapshot();
    const articles = currentArticles();
    if (ui.articleId && !articles.some((article) => article.id === ui.articleId)) {
      ui.articleId = null;
      openHit = null;
    }
    refreshNote = "Article list updated.";
  } catch {
    refreshNote = "Could not refresh the article list.";
  } finally {
    refreshing = false;
    render();
  }
}

function downloadCsv() {
  const visible = words.filter(wordMatchesBank);
  const present = orderedLevels(visible.flatMap((record) => recordLevels(record)));
  const csv = toCsv(visible, levelsForCopy(present));
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "oxbridge-word-bank.csv";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

window.speechSynthesis?.addEventListener?.("voiceschanged", () => {});

Promise.all([
  loadData("feeds.json"),
  fetchSnapshot(),
  loadData("vocab.json"),
])
  .then(([feeds, snapshot, vocab]) => {
    catalog = readCatalog(feeds);
    bundle = snapshot;
    lex = createLexicon(vocab);
    ui.selection = DEFAULT_SELECTION;
    ui.articleId = null;
    openHit = null;
    saveUi(ui);
    render();
  })
  .catch((error) => {
    loadError = `The reader could not load its data (${error.message}).`;
    render();
  });
