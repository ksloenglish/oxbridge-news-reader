import {
  DEFAULT_SELECTION,
  articlesForSelection,
  categoryLabel,
  readCatalog,
  readSnapshot,
  selectionKnown,
  selectionLabel,
  statusForSelection,
} from "./data.js";
import { toCsv, formatWordText, hitToRecord } from "./export.js";
import {
  LEVELS,
  annotate,
  createLexicon,
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

function levelButtons(map, dataAttr) {
  return LEVELS.map(
    (level) =>
      `<button type="button" class="level" data-level="${level}" data-${dataAttr}="${level}" aria-pressed="${map[level] ? "true" : "false"}"><i></i>${level}</button>`,
  ).join("");
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
        </nav>
      </div>
      <div class="level-row">
        <p>Highlight</p>
        ${levelButtons(ui.levels, "highlight")}
        <p class="hint">Dashed outline means more than one CEFR level. Default is B2, C1, and C2.</p>
      </div>
    </header>
    <main class="view" id="view">${ui.section === "bank" ? renderBank() : renderNews()}</main>
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
    ? `<article class="reader">
        <button type="button" class="ghost back" data-close-article>All stories</button>
        <p class="kicker">${esc(current.source || selectionLabel(catalog, ui.selection))}</p>
        <h2>${renderAnnotated(current.title)}</h2>
        <p class="meta">${esc(formatWhen(current.publishedAt))}${current.link ? ` · <a class="original" href="${esc(safeUrl(current.link))}" target="_blank" rel="noopener noreferrer">Original article</a>` : ""}</p>
        ${current.imageUrl && safeUrl(current.imageUrl) ? `<img class="hero" alt="" src="${esc(safeUrl(current.imageUrl))}" />` : ""}
        <div class="body">${paragraphs(current.fullText)}</div>
        <p class="quiet">Highlights use the Oxbridge CEFR pack on this site. Glosses are Traditional Chinese.</p>
      </article>`
    : `<div class="reader"><p class="empty">Choose a story to read it with vocabulary highlights.</p></div>`;

  const stamp = bundle.generatedAt ? `Snapshot ${esc(formatWhen(bundle.generatedAt))}.` : "";
  return `
    <section class="desk${reading ? " reading" : ""}" aria-labelledby="desk-title">
      <div class="pane list-pane">
        <div class="toolbar">
          <label class="field">News source
            <select data-feed aria-label="News source">${feedOptions()}</select>
          </label>
        </div>
        <h2 id="desk-title">${esc(selectionLabel(catalog, ui.selection))}</h2>
        ${list}
        <p class="quiet">${stamp} Stories are saved with the site so the desk works without calling the news sites from your browser.</p>
      </div>
      <div class="pane reader">${reader}</div>
    </section>`;
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
        <div class="actions">
          <button type="button" class="ghost" data-remove-word="${esc(current.id)}">Remove</button>
        </div>
      </article>`
    : `<div class="detail"><p class="empty">Open a saved word to see its glosses.</p></div>`;

  return `
    <section class="bank${reading ? " reading" : ""}">
      <div class="pane list-pane">
        <h2>Word Bank</h2>
        <p class="warn">Saved words stay in this browser only. Clearing the site data or cache deletes them. They are not sent to a server.</p>
        <div class="export-box" aria-label="Word bank levels">
          ${levelButtons(ui.bankLevels, "bank")}
        </div>
        ${list}
        <h3 class="kicker">Export</h3>
        <p class="quiet">Choose which CEFR levels to include, then download a CSV.</p>
        <div class="export-box">
          ${LEVELS.map((level) => `<label><input type="checkbox" data-export="${level}" ${ui.exportLevels[level] ? "checked" : ""}/> ${level}</label>`).join("")}
          <button type="button" class="solid" data-csv>Export CSV</button>
        </div>
      </div>
      <div class="pane detail">
        ${detail}
      </div>
    </section>`;
}

function renderRecordBody(record) {
  const allow = activeSet(ui.exportLevels);
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
    <p class="meta">${esc((record.pos || []).map(posLabel).join(" · "))}${record.sourceTitle ? ` · ${esc(record.sourceTitle)}` : ""}</p>
    ${record.sourceUrl ? `<p><a href="${esc(safeUrl(record.sourceUrl))}" target="_blank" rel="noopener noreferrer">Source article</a></p>` : ""}
    <button type="button" class="ghost" data-speak="${esc(record.word)}">Listen (en-GB)</button>
    ${senseBlocks(senses, "Saved senses")}
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
  return `<h4>${esc(title)}</h4>${body}`;
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
  const saved = words.some((item) => item.id === record.id);
  const parts = partitionSenses(hit, activeSet(ui.levels));
  const entry = primaryEntry(hit);
  const pills = hit.levels.map((level) => `<span class="pill" data-level="${esc(level)}">${esc(level)}</span>`).join("");
  const pos = [...new Set(hit.reading.flatMap((item) => item.pos))].map(posLabel).join(" · ");
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
        ${renderSenseGroup(parts.match, "Definitions")}
        ${parts.other.length ? renderSenseGroup(parts.other, "Other meanings", true) : ""}
        ${parts.alternates.length ? renderSenseGroup(parts.alternates, "Other readings", true) : ""}
        <p class="quiet">Glosses are Traditional Chinese from the Oxbridge pack.</p>
        <div class="export-box">
          <span class="quiet">Copy levels</span>
          ${LEVELS.map((level) => `<label><input type="checkbox" data-export="${level}" ${ui.exportLevels[level] ? "checked" : ""}/> ${level}</label>`).join("")}
        </div>
        <div class="actions">
          <button type="button" class="solid" data-save="${saved ? "1" : "0"}">${saved ? "Saved — remove" : "Save to Word Bank"}</button>
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
      return `<h4>${esc(head)}</h4>${lines}`;
    })
    .join("");
  return `<h4>${esc(title)}</h4>${body}`;
}

function render() {
  hits.length = 0;
  if (loadError) {
    app.innerHTML = `<div class="status"><p>${esc(loadError)}</p></div>`;
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
    ui.section = section.dataset.section;
    openHit = null;
    persist();
    render();
    return;
  }
  const highlight = event.target.closest("[data-highlight]");
  if (highlight) {
    const level = highlight.dataset.highlight;
    ui.levels[level] = !ui.levels[level];
    persist();
    render();
    return;
  }
  const bankLevel = event.target.closest("[data-bank]");
  if (bankLevel) {
    ui.bankLevels[bankLevel.dataset.bank] = !ui.bankLevels[bankLevel.dataset.bank];
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
    bankId = word.dataset.word;
    render();
    return;
  }
  if (event.target.closest("[data-close-word]")) {
    bankId = null;
    render();
    return;
  }
  const remove = event.target.closest("[data-remove-word]");
  if (remove) {
    words = words.filter((item) => item.id !== remove.dataset.removeWord);
    if (bankId === remove.dataset.removeWord) bankId = null;
    persist();
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
  if (event.target.closest("[data-save]") && openHit) {
    const hit = openHit.hit;
    if (!hit) return;
    const record = hitToRecord(hit, openHit.source);
    const exists = words.some((item) => item.id === record.id);
    words = exists ? words.filter((item) => item.id !== record.id) : [record, ...words];
    persist();
    copyNote = exists ? "Removed from Word Bank." : "Saved in Word Bank on this device.";
    renderCard();
    return;
  }
  if (event.target.closest("[data-copy]") && openHit) {
    const hit = openHit.hit;
    if (!hit) return;
    const record = hitToRecord(hit, openHit.source);
    const text = formatWordText(record, activeSet(ui.exportLevels));
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

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && openHit) {
    openHit = null;
    copyNote = "";
    renderCard();
  }
});

function downloadCsv() {
  const visible = words.filter(wordMatchesBank);
  const csv = toCsv(visible, activeSet(ui.exportLevels));
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
  fetch(`${base}data/articles.json`).then((response) => {
    if (!response.ok) throw new Error(`articles.json HTTP ${response.status}`);
    return response.json();
  }),
  loadData("vocab.json"),
])
  .then(([feeds, articles, vocab]) => {
    catalog = readCatalog(feeds);
    bundle = readSnapshot(articles);
    lex = createLexicon(vocab);
    if (!selectionKnown(catalog, ui.selection)) ui.selection = DEFAULT_SELECTION;
    render();
  })
  .catch((error) => {
    loadError = `The reader could not load its data (${error.message}).`;
    render();
  });
