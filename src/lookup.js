/** CEFR lookup over the Lex pack. See public/data/LOOKUP.md. */

export const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

const POS_LABEL = {
  n: "noun",
  v: "verb",
  adj: "adjective",
  adv: "adverb",
  prep: "preposition",
  pron: "pronoun",
  conj: "conjunction",
  det: "determiner",
  number: "number",
  exclam: "exclamation",
  "modal v": "modal verb",
  "det/pron": "determiner / pronoun",
  "pron/det": "pronoun / determiner",
  "adj/adv": "adjective / adverb",
  "exclam/n": "exclamation / noun",
  "adj/pron": "adjective / pronoun",
  "det/adj": "determiner / adjective",
  "det/number": "determiner / number",
  "number/det": "number / determiner",
  "adv/prep": "adverb / preposition",
  "conj/prep": "conjunction / preposition",
};

export function posLabel(pos) {
  return POS_LABEL[pos] || pos || "word";
}

export function createLexicon(data) {
  return {
    words: data?.words || {},
    imap: data?.inflection_map || data?.imap || {},
  };
}

export function formatIpa(phonetic) {
  if (!phonetic) return "";
  return String(phonetic)
    .split(/\.\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => (part.startsWith("/") ? part : `/${part}/`))
    .join(" ");
}

/**
 * Student-facing gloss. Hong Kong Traditional Chinese `tc` is the line
 * on the card, in Word Bank, and in copy/CSV. English `en` stays in the
 * pack and is not shown. Other fields are used only when `tc` is empty.
 */
function senseText(def) {
  if (!def || typeof def !== "object") return "";
  if (typeof def.tc === "string" && def.tc.trim()) return def.tc.trim();
  if (Array.isArray(def.defs) && def.defs.length) {
    const joined = def.defs.filter(Boolean).join("; ");
    if (joined) return joined;
  }
  if (typeof def.definition === "string" && def.definition.trim()) return def.definition.trim();
  return "";
}

function packEntryForSense(lex, sense, record) {
  const words = lex?.words || {};
  for (const value of [sense?.lemma, record?.lemma, sense?.word, record?.word]) {
    if (!value) continue;
    const text = String(value);
    if (words[text]) return words[text];
    const lower = text.toLowerCase();
    if (words[lower]) return words[lower];
  }
  return null;
}

function definitionForSavedSense(lex, sense, record) {
  const raw = packEntryForSense(lex, sense, record);
  if (!raw) return null;
  const matches = (raw.definitions || []).filter((def) => {
    const pos = def.pos || "";
    const cefr = def.cefr || raw.cefr || "";
    return pos === (sense?.pos || "") && cefr === (sense?.cefr || "");
  });
  return matches.length === 1 ? matches[0] : null;
}

/** Replace a stored English gloss with the current `tc` for that sense. */
export function refreshSavedGlosses(lex, records) {
  if (!Array.isArray(records)) return [];
  return records.map((record) => {
    if (!record || !Array.isArray(record.senses)) return record;
    let changed = false;
    const senses = record.senses.map((sense) => {
      const def = definitionForSavedSense(lex, sense, record);
      if (!def) return sense;
      const text = senseText(def);
      if (!text || text === sense.text) return sense;
      changed = true;
      return { ...sense, text };
    });
    return changed ? { ...record, senses } : record;
  });
}

function isMonthSense(raw, def, index) {
  const tc = def.tc || "";
  if (raw.word === "March" && tc.includes("三月")) return true;
  if (raw.word === "May" && tc.includes("五月")) return true;
  if ((raw.word === "March" || raw.word === "May") && def.pos === "n" && !def.cefr && index === 0) {
    return true;
  }
  return false;
}

function buildEntry(key, raw) {
  if (!raw) return null;
  const senses = (raw.definitions || []).map((def, index) => ({
    pos: def.pos || "",
    cefr: def.cefr || raw.cefr || "",
    text: senseText(def),
    list: def.list || raw.list || "",
    month: isMonthSense(raw, def, index),
  }));
  return {
    key,
    word: raw.word || key,
    cefr: raw.cefr || "",
    phonetic: raw.phonetic || "",
    pos: Array.isArray(raw.pos) ? raw.pos : [],
    list: raw.list || "",
    senses,
  };
}

function asList(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function unique(list) {
  return [...new Set(list)];
}

function isAllCaps(token) {
  return token.length >= 2 && token === token.toUpperCase() && /[A-Z]/.test(token);
}

/** Initial capital plus a lowercase letter. All-caps acronyms and single letters are not title case. */
function isTitleCaseWord(token) {
  const letters = String(token).replace(/['’]/g, "");
  if (letters.length < 2) return false;
  if (letters === letters.toUpperCase()) return false;
  return /^[A-Z]/.test(letters) && /[a-z]/.test(letters);
}

function isNameJoin(separator) {
  return /^[\s-]+$/.test(separator);
}

/** True when a letter sits immediately across an adjacent hyphen (`K-pop`, `well-known`). */
function hasLetterAcrossHyphen(source, start, end) {
  const hyphen = (ch) => ch === "-" || ch === "\u2010" || ch === "\u2011";
  if (start >= 2 && hyphen(source[start - 1]) && /[A-Za-z]/.test(source[start - 2] || "")) return true;
  if (end + 1 < source.length && hyphen(source[end]) && /[A-Za-z]/.test(source[end + 1] || "")) return true;
  return false;
}

function isCapitalizedWord(token) {
  const letters = String(token).replace(/['’]/g, "");
  if (!letters) return false;
  const first = letters[0];
  return first === first.toUpperCase() && first !== first.toLowerCase();
}

/** Part 2, Chapter 3, Section 1, Figure 1.2 — a section label, not a name. */
function followedByNumeral(source, end) {
  return /^\s*[#.:-]?\s*\d/.test(source.slice(end));
}

function heuristicStems(lower) {
  const stems = [];
  const push = (stem) => {
    if (stem && stem.length >= 3 && stem !== lower) stems.push(stem);
  };

  if (lower.endsWith("ies") && lower.length > 4) push(`${lower.slice(0, -3)}y`);
  if (lower.endsWith("ied") && lower.length > 4) push(`${lower.slice(0, -3)}y`);

  if (lower.endsWith("ing") && lower.length > 5) {
    const stem = lower.slice(0, -3);
    if (stem.length > 2 && stem.at(-1) === stem.at(-2) && /[a-z]/.test(stem.at(-1))) {
      push(stem.slice(0, -1));
    }
    push(`${stem}e`);
    push(stem);
  }

  if (lower.endsWith("ed") && lower.length > 4) {
    const stem = lower.slice(0, -2);
    if (stem.length > 2 && stem.at(-1) === stem.at(-2) && /[a-z]/.test(stem.at(-1))) {
      push(stem.slice(0, -1));
    }
    push(`${stem}e`);
    push(stem);
  }

  if (lower.endsWith("es") && lower.length > 4 && !lower.endsWith("ss")) {
    push(lower.slice(0, -2));
  }
  if (lower.endsWith("s") && !lower.endsWith("ss") && lower.length > 3) {
    push(lower.slice(0, -1));
  }

  return unique(stems);
}

function keysFromMap(lex, form) {
  return asList(lex.imap[form]).filter((key) => lex.words[key]);
}

function posLabels(entry) {
  const listed = Array.isArray(entry?.pos) ? entry.pos : [];
  const defined = (entry?.definitions || []).map((def) => def.pos).filter(Boolean);
  return [...listed, ...defined];
}

function lemmaHasVerb(lex, key) {
  const entry = lex.words[key];
  if (!entry) return false;
  return posLabels(entry).some((pos) => String(pos).split(/[/ ]+/).includes("v"));
}

/** evening, walked, tried. Comparatives such as better are not participles. */
function isParticipleSurface(lower) {
  return lower.endsWith("ing") || lower.endsWith("ied") || lower.endsWith("ed");
}

/**
 * A participle strip may land on a verb lemma only.
 * `evening`→`even` is dropped; `saying`→`say` and `walked`→`walk` stay.
 * The surface's own lemma is always kept.
 */
function verbParticipleTargets(lex, surfaceLower, keys) {
  if (!isParticipleSurface(surfaceLower)) return keys;
  return keys.filter((key) => key.toLowerCase() === surfaceLower || lemmaHasVerb(lex, key));
}

function resolveKeys(lex, token) {
  if (token === "I") {
    if (lex.words.I) return ["I"];
    if (lex.words.i) return ["i"];
    return [];
  }

  if (token === "IT" || token === "it") {
    const mapped = unique([
      ...keysFromMap(lex, token),
      ...keysFromMap(lex, token.toLowerCase()),
    ]);
    if (mapped.length) return mapped;
    if (lex.words[token]) return [token];
    return [];
  }

  if (isAllCaps(token)) {
    const upperKeys = unique([
      ...(lex.words[token] ? [token] : []),
      ...keysFromMap(lex, token),
      ...keysFromMap(lex, token.toLowerCase()),
    ]).filter((key) => key === key.toUpperCase() && key !== key.toLowerCase());
    return upperKeys;
  }

  const lower = token.toLowerCase();
  const mapped = verbParticipleTargets(
    lex,
    lower,
    unique([...keysFromMap(lex, lower), ...keysFromMap(lex, token)]),
  );
  if (mapped.length) return mapped;
  if (lex.words[lower]) return [lower];
  if (lex.words[token]) return [token];

  for (const stem of heuristicStems(lower)) {
    const stemmed = keysFromMap(lex, stem);
    const candidates = stemmed.length ? stemmed : (lex.words[stem] ? [stem] : []);
    if (!candidates.length) continue;
    // -ing / -ed / -ied may invent a stem (`evening` → `even`). Accept only a verb lemma.
    if (isParticipleSurface(lower)) {
      const verbs = candidates.filter((key) => lemmaHasVerb(lex, key));
      if (verbs.length) return unique(verbs);
      continue;
    }
    return unique(candidates);
  }
  return [];
}

function splitReading(token, keys) {
  const prefer = (key) => {
    if (!keys.includes(key)) return { reading: keys, alternates: [] };
    return { reading: [key], alternates: keys.filter((item) => item !== key) };
  };

  if (token === "I") return prefer(keys.includes("I") ? "I" : "i");
  if (token === "IT") return prefer("IT");
  if (token.toLowerCase() === "it") return prefer("it");
  if (isAllCaps(token)) {
    const upper = keys.find((key) => key === key.toUpperCase() && key !== key.toLowerCase());
    if (upper) return prefer(upper);
  }
  return { reading: keys, alternates: [] };
}

function monthPreference(token, sentenceStart) {
  const lower = token.toLowerCase();
  if (lower !== "march" && lower !== "may") return null;
  const capitalized = token[0] === token[0].toUpperCase() && token[0] !== token[0].toLowerCase();
  if (!capitalized && !sentenceStart) return "non-month";
  if (capitalized) return "month";
  return null;
}

function levelsOf(entries) {
  return unique(entries.flatMap((entry) => entry.senses.map((sense) => sense.cefr)).filter(Boolean));
}

function isVerbPos(pos) {
  return pos === "v" || pos === "modal v";
}

function isNounPos(pos) {
  return pos === "n";
}

const MODALS = new Set(["will", "would", "can", "could", "may", "might", "must", "should", "shall"]);
const AUXILIARIES = new Set([
  "do", "does", "did", "done", "doing",
  "don't", "dont", "doesn't", "doesnt", "didn't", "didnt",
  "be", "am", "is", "are", "was", "were", "been", "being",
  "have", "has", "had", "having",
]);
const DETERMINERS = new Set([
  "a", "an", "the", "this", "that", "these", "those",
  "my", "your", "his", "her", "its", "our", "their",
  "each", "every", "any", "some", "many", "much", "more", "most", "few", "several", "no",
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty",
  "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety", "hundred", "thousand",
  "another", "both", "all",
]);

function cueWord(token) {
  if (!token) return { lower: "", possessive: false };
  const raw = String(token).replace(/[’]/g, "'");
  const possessive = /'s$/i.test(raw);
  const lower = raw.replace(/'s$/i, "").replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "").toLowerCase();
  return { lower, possessive };
}

/** Regular noun-plural shape (`parts`, `books`, `lines`). Not `-ed` / `-ing`. */
function looksLikeRegularPlural(lower) {
  if (lower.endsWith("ing") || lower.endsWith("ed")) return false;
  if (lower.length > 4 && lower.endsWith("ies")) return true;
  if (lower.length > 4 && lower.endsWith("es") && !lower.endsWith("ss")) return true;
  if (lower.length > 3 && lower.endsWith("s") && !lower.endsWith("ss")) return true;
  return false;
}

/**
 * Clear verb inflection: irregular past/participle (`said`, `went`, `told`, `left`)
 * or a regular `-ed` / `-ing` ending. A regular plural alone is not verb morphology.
 */
function isClearVerbInflection(lower) {
  if (lower.endsWith("ed") || lower.endsWith("ing")) return true;
  if (looksLikeRegularPlural(lower)) return false;
  return true;
}

function isRomanNumeral(token) {
  return /^(?:i{1,3}|iv|v|vi{0,3}|ix|x|xi{0,3}|xiv|xv|xvi{0,3}|xix|xx)$/i.test(token);
}

/** Part 2, Part II, Act I, Section 1.2. A lone "I" after a modal (`May I`) is the pronoun. */
function nextIsSectionNumber(ctx, surfaceKey) {
  if (/^\s*[#.:-]?\s*\d/.test(String(ctx.nextRaw || ""))) return true;
  const next = cueWord(ctx.next).lower;
  if (!next || !isRomanNumeral(next)) return false;
  if (next.length === 1 && (MODALS.has(surfaceKey) || AUXILIARIES.has(surfaceKey) || !ctx.capitalized)) return false;
  return true;
}

function nextIsOf(next) {
  return cueWord(next).lower === "of";
}

function hasVerbContext(prev, surfaceKey) {
  const { lower } = cueWord(prev);
  if (!lower) return false;
  if (lower === "to" || MODALS.has(lower) || AUXILIARIES.has(lower)) return true;
  if ((lower === "he" || lower === "she" || lower === "it") && looksLikeRegularPlural(surfaceKey)) return true;
  return false;
}

function hasDeterminer(prev, prevRaw) {
  const cue = cueWord(prev);
  if (cue.possessive || DETERMINERS.has(cue.lower)) return true;
  if (!cue.lower && /\d+(?:\.\d+)?\s*$/.test(String(prevRaw || "").trim())) return true;
  return false;
}

function keepSenses(entry, chosenFn, secondary) {
  const chosen = entry.senses.filter(chosenFn);
  if (!chosen.length || chosen.length === entry.senses.length) return entry;
  entry.senses.forEach((sense, index) => {
    if (chosen.includes(sense)) return;
    secondary.push({
      ...sense,
      lemma: entry.key,
      word: entry.word,
      phonetic: entry.phonetic,
      order: index,
      rank: 1,
    });
  });
  return { ...entry, senses: chosen, pos: unique(chosen.map((sense) => sense.pos)) };
}

/**
 * Filter senses before levels. Morphology first, then context.
 * Numeral / "of" beats to/modal/aux, which beats a determiner.
 * A regular plural is not verb morphology. Multi-target imap entries
 * are filtered per lemma, so `saying` keeps its own noun.
 * @returns {{ reading: object[], secondary: object[] }}
 */
function filterReadingSenses(entries, cleaned, preference, ctx) {
  const surfaceKey = cleaned.toLowerCase();
  const secondary = [];
  const section = nextIsSectionNumber(ctx, surfaceKey);
  const ofCue = nextIsOf(ctx.next);
  let family = null;
  if (preference === "month" && section) family = "month";
  else if (section || ofCue) family = "n";
  else if (hasVerbContext(ctx.prev, surfaceKey)) family = "v";
  else if (hasDeterminer(ctx.prev, ctx.prevRaw)) family = "n";

  const reading = entries.map((entry) => {
    const inflected = surfaceKey !== entry.key && isClearVerbInflection(surfaceKey);
    if (inflected && entry.senses.some((sense) => isVerbPos(sense.pos))) {
      return keepSenses(entry, (sense) => isVerbPos(sense.pos), secondary);
    }
    if (family === "month") return keepSenses(entry, (sense) => sense.month, secondary);
    if (family === "n") return keepSenses(entry, (sense) => isNounPos(sense.pos), secondary);
    if (family === "v") return keepSenses(entry, (sense) => isVerbPos(sense.pos), secondary);
    return entry;
  });
  return { reading, secondary };
}

/**
 * @param {ReturnType<typeof createLexicon>} lex
 * @param {string} surface raw token, possessives allowed
 * @param {{ sentenceStart?: boolean, nameRun?: boolean, prev?: string|null, next?: string|null, nextRaw?: string, prevRaw?: string, capitalized?: boolean }} [ctx]
 */
export function lookupSurface(lex, surface, ctx = {}) {
  // A Title-Case run of two or more words (United States, New Zealand) is a name span.
  if (ctx.nameRun) return null;

  const cleaned = String(surface)
    .replace(/[’]/g, "'")
    .replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "")
    .replace(/'s$/i, "");
  if (!cleaned || !/[A-Za-z]/.test(cleaned)) return null;

  const keys = resolveKeys(lex, cleaned);
  if (!keys.length) return null;
  const { reading, alternates } = splitReading(cleaned, keys);
  const toEntries = (list) => list.map((key) => buildEntry(key, lex.words[key])).filter(Boolean);
  const readingEntries = toEntries(reading);
  if (!readingEntries.length) return null;
  const alternateEntries = toEntries(alternates);
  // Month ranking first. Then filter senses, and only then levels / ambiguous / colour.
  const preference = monthPreference(cleaned, Boolean(ctx.sentenceStart));
  const context = {
    ...ctx,
    capitalized: ctx.capitalized ?? isCapitalizedWord(cleaned),
  };
  const filtered = filterReadingSenses(readingEntries, cleaned, preference, context);
  const levels = levelsOf(filtered.reading);

  return {
    surface: cleaned,
    preference,
    reading: filtered.reading,
    secondary: filtered.secondary,
    alternates: alternateEntries,
    levels,
    ambiguous: levels.length > 1,
  };
}

function preferenceRank(sense, preference) {
  if (preference === "non-month") return sense.month ? 1 : 0;
  if (preference === "month") return sense.month ? 0 : 1;
  return 0;
}

export function primaryEntry(hit) {
  if (hit.preference) {
    const wantMonth = hit.preference === "month";
    const found = hit.reading.find((entry) => entry.senses.some((sense) => sense.month === wantMonth));
    if (found) return found;
  }
  return hit.reading[0];
}

function taggedSenses(entries, preference) {
  const rows = [];
  entries.forEach((entry) => {
    entry.senses.forEach((sense, index) => {
      rows.push({
        ...sense,
        lemma: entry.key,
        word: entry.word,
        phonetic: entry.phonetic,
        order: index,
        rank: preferenceRank(sense, preference),
      });
    });
  });
  rows.sort((a, b) => a.rank - b.rank || a.order - b.order);
  return rows;
}

/** Senses on the chosen reading, split by the active CEFR filter. */
export function partitionSenses(hit, activeLevels) {
  const rows = taggedSenses(hit.reading, hit.preference);
  const match = [];
  const other = [];
  for (const row of rows) {
    if (activeLevels.has(row.cefr)) match.push(row);
    else other.push(row);
  }
  // When several CEFR levels remain, the card face is the lowest one
  // (then definition order). Higher senses stay collapsed. They still
  // sit on the hit, so a bare lemma can keep a multi-level highlight.
  const topRank = match.reduce((min, row) => Math.min(min, row.rank), Infinity);
  const preferred = match.filter((row) => row.rank === topRank);
  const deferred = match.filter((row) => row.rank !== topRank);
  const faceLevels = unique(preferred.map((row) => row.cefr));
  let face = preferred;
  let collapsed = deferred;
  if (faceLevels.length > 1) {
    const best = faceLevels.reduce((lowest, level) => (
      LEVELS.indexOf(level) < LEVELS.indexOf(lowest) ? level : lowest
    ));
    face = preferred.filter((row) => row.cefr === best);
    collapsed = [...preferred.filter((row) => row.cefr !== best), ...deferred];
  }
  return {
    match: face,
    other,
    secondary: [...(hit.secondary || []), ...collapsed],
    alternates: taggedSenses(hit.alternates, null),
  };
}

export function highlightStyle(hit, activeLevels) {
  const active = hit.levels.filter((level) => activeLevels.has(level));
  if (!active.length) return null;
  if (hit.ambiguous) return { kind: "multi", level: active[0] };
  return { kind: "solid", level: active[0] };
}

/**
 * Split running text into plain pieces and vocabulary hits.
 * @returns {Array<{type:'text', text:string} | {type:'hit', text:string, hit:object, style:object}>}
 */
export function annotate(text, lex, activeLevels) {
  const source = String(text || "");
  const pattern = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;
  const matches = [];
  let match;
  while ((match = pattern.exec(source))) {
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      token: match[0],
      title: isTitleCaseWord(match[0]),
    });
  }

  const sectionLabel = matches.map((item) => isCapitalizedWord(item.token) && followedByNumeral(source, item.end));
  const nameRun = matches.map(() => false);
  let index = 0;
  while (index < matches.length) {
    if (!matches[index].title || sectionLabel[index]) {
      index += 1;
      continue;
    }
    let end = index;
    while (
      end + 1 < matches.length &&
      matches[end + 1].title &&
      !sectionLabel[end + 1] &&
      isNameJoin(source.slice(matches[end].end, matches[end + 1].start))
    ) {
      end += 1;
    }
    if (end > index) {
      for (let cursor = index; cursor <= end; cursor += 1) nameRun[cursor] = true;
    }
    index = end + 1;
  }

  const parts = [];
  let last = 0;
  let sentenceStart = true;
  matches.forEach((item, itemIndex) => {
    if (item.start > last) {
      const sep = source.slice(last, item.start);
      parts.push({ type: "text", text: sep });
      if (/[.!?]|\n/.test(sep)) sentenceStart = true;
    }
    const prev = itemIndex > 0 ? matches[itemIndex - 1] : null;
    const next = itemIndex + 1 < matches.length ? matches[itemIndex + 1] : null;
    const prevGap = prev ? source.slice(prev.end, item.start) : source.slice(0, item.start);
    const nextGap = source.slice(item.end, next ? next.start : source.length);
    const brokenBefore = /[.!?\n]/.test(prevGap);
    const brokenAfter = /[.!?\n]/.test(nextGap);
    // Hyphen-linked pieces (K-pop) are one compound: do not highlight either segment.
    const linked = hasLetterAcrossHyphen(source, item.start, item.end);
    const hit = lex && !linked
      ? lookupSurface(lex, item.token, {
        sentenceStart,
        nameRun: nameRun[itemIndex],
        capitalized: isCapitalizedWord(item.token),
        prev: prev && !brokenBefore ? prev.token : null,
        next: next && !brokenAfter ? next.token : null,
        prevRaw: prevGap,
        nextRaw: nextGap,
      })
      : null;
    const style = hit ? highlightStyle(hit, activeLevels) : null;
    if (hit && style) parts.push({ type: "hit", text: item.token, hit, style });
    else parts.push({ type: "text", text: item.token });
    sentenceStart = false;
    last = item.end;
  });
  if (last < source.length) parts.push({ type: "text", text: source.slice(last) });
  return parts;
}

/**
 * Highlighted lemmas for Word Lists.
 * One row per dictionary headword at each active level. The label is the
 * lemma (`disrupt`), not the surface form in the article (`disrupting`).
 * @returns {{ level: string, items: { lemma: string, pos: string, hit: object }[] }[]}
 */
export function wordListsByLevel(parts, activeLevels) {
  const allow = activeLevels instanceof Set ? activeLevels : new Set(activeLevels || []);
  const grouped = new Map();
  for (const part of parts || []) {
    if (part?.type !== "hit") continue;
    for (const entry of part.hit?.reading || []) {
      for (const sense of entry.senses || []) {
        if (!allow.has(sense.cefr)) continue;
        if (!grouped.has(sense.cefr)) grouped.set(sense.cefr, new Map());
        const bucket = grouped.get(sense.cefr);
        if (bucket.has(entry.key)) continue;
        const pos = sense.pos || (entry.pos || []).find(Boolean) || "";
        bucket.set(entry.key, { lemma: entry.word || entry.key, pos, hit: part.hit });
      }
    }
  }
  return LEVELS.filter((level) => grouped.has(level)).map((level) => ({
    level,
    items: [...grouped.get(level).values()].sort((a, b) => a.lemma.localeCompare(b.lemma, "en", { sensitivity: "base" })),
  }));
}

/** Occurrence counts for highlighted tokens, only at levels in the active set. */
export function countHighlightedLevels(text, lex, activeLevels) {
  const counts = Object.fromEntries(LEVELS.map((level) => [level, 0]));
  const allow = activeLevels instanceof Set ? activeLevels : new Set(activeLevels);
  for (const part of annotate(text, lex, allow)) {
    if (part.type !== "hit") continue;
    for (const level of part.hit.levels || []) {
      if (allow.has(level)) counts[level] += 1;
    }
  }
  return counts;
}
