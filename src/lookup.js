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

function senseText(def) {
  if (Array.isArray(def.defs) && def.defs.length) {
    return def.defs.filter(Boolean).join("; ");
  }
  if (typeof def.en === "string" && def.en.trim()) return def.en.trim();
  if (typeof def.definition === "string" && def.definition.trim()) return def.definition.trim();
  if (typeof def.tc === "string") return def.tc.trim();
  return "";
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
  const mapped = unique([...keysFromMap(lex, lower), ...keysFromMap(lex, token)]);
  if (mapped.length) return mapped;
  if (lex.words[lower]) return [lower];
  if (lex.words[token]) return [token];

  for (const stem of heuristicStems(lower)) {
    const stemmed = keysFromMap(lex, stem);
    if (stemmed.length) return unique(stemmed);
    if (lex.words[stem]) return [stem];
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

/**
 * Inflected surfaces prefer verb senses. A bare lemma (surface === key) keeps every sense.
 * Multi-target hits are filtered per lemma, so `saying` keeps its own noun entry.
 * @returns {{ reading: object[], secondary: object[] }}
 */
function preferInflectedVerbs(entries, surfaceKey) {
  const secondary = [];
  const reading = entries.map((entry) => {
    if (surfaceKey === entry.key) return entry;
    const verbs = entry.senses.filter((sense) => isVerbPos(sense.pos));
    if (!verbs.length) return entry;
    entry.senses.forEach((sense, index) => {
      if (isVerbPos(sense.pos)) return;
      secondary.push({
        ...sense,
        lemma: entry.key,
        word: entry.word,
        phonetic: entry.phonetic,
        order: index,
        rank: 1,
      });
    });
    return { ...entry, senses: verbs, pos: unique(verbs.map((sense) => sense.pos)) };
  });
  return { reading, secondary };
}

/**
 * @param {ReturnType<typeof createLexicon>} lex
 * @param {string} surface raw token, possessives allowed
 * @param {{ sentenceStart?: boolean }} [ctx]
 */
export function lookupSurface(lex, surface, ctx = {}) {
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
  // Month choice first, then drop non-verb senses on inflected forms before levels and colour.
  const preference = monthPreference(cleaned, Boolean(ctx.sentenceStart));
  const filtered = preferInflectedVerbs(readingEntries, cleaned.toLowerCase());
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
  return {
    match,
    other,
    secondary: hit.secondary || [],
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
    });
  }

  const parts = [];
  let last = 0;
  let sentenceStart = true;
  matches.forEach((item) => {
    if (item.start > last) {
      const sep = source.slice(last, item.start);
      parts.push({ type: "text", text: sep });
      if (/[.!?]|\n/.test(sep)) sentenceStart = true;
    }
    const hit = lex ? lookupSurface(lex, item.token, { sentenceStart }) : null;
    const style = hit ? highlightStyle(hit, activeLevels) : null;
    if (hit && style) parts.push({ type: "hit", text: item.token, hit, style });
    else parts.push({ type: "text", text: item.token });
    sentenceStart = false;
    last = item.end;
  });
  if (last < source.length) parts.push({ type: "text", text: source.slice(last) });
  return parts;
}
