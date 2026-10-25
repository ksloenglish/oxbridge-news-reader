import { LEVELS } from "./lookup.js";

const UI_KEY = "kslo.oxbridge.ui.v1";
const WORD_KEY = "kslo.oxbridge.words.v1";

const defaultLevels = () => ({
  A1: false,
  A2: false,
  B1: false,
  B2: true,
  C1: true,
  C2: true,
});

const allLevels = () => ({
  A1: true,
  A2: true,
  B1: true,
  B2: true,
  C1: true,
  C2: true,
});

function mixLevels(base, saved) {
  const next = { ...base };
  if (!saved || typeof saved !== "object") return next;
  for (const level of LEVELS) {
    if (typeof saved[level] === "boolean") next[level] = saved[level];
  }
  return next;
}

export function defaultUi() {
  return {
    section: "news",
    selection: "category:rthk",
    levels: defaultLevels(),
    bankLevels: allLevels(),
    exportLevels: allLevels(),
    articleId: null,
  };
}

export function loadUi() {
  const base = defaultUi();
  try {
    const raw = JSON.parse(localStorage.getItem(UI_KEY) || "null");
    if (!raw || typeof raw !== "object") return base;
    return {
      ...base,
      section: raw.section === "bank" ? "bank" : "news",
      selection: typeof raw.selection === "string" ? raw.selection : base.selection,
      levels: mixLevels(base.levels, raw.levels),
      bankLevels: mixLevels(base.bankLevels, raw.bankLevels),
      exportLevels: mixLevels(base.exportLevels, raw.exportLevels),
      articleId: typeof raw.articleId === "string" ? raw.articleId : null,
    };
  } catch {
    return base;
  }
}

export function saveUi(ui) {
  localStorage.setItem(UI_KEY, JSON.stringify(ui));
}

export function loadWords() {
  try {
    const raw = JSON.parse(localStorage.getItem(WORD_KEY) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export function saveWords(words) {
  localStorage.setItem(WORD_KEY, JSON.stringify(words));
}

export function activeSet(map) {
  return new Set(LEVELS.filter((level) => map?.[level]));
}
