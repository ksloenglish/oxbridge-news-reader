import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SELECTION } from "../src/data.js";
import { loadUi, saveUi } from "../src/storage.js";

const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: (key) => memory.delete(key),
  clear: () => memory.clear(),
};

test("reload keeps CEFR choices and drops the news source and open article", () => {
  memory.clear();
  saveUi({
    section: "news",
    selection: "feed:rfa-english",
    levels: { A1: true, A2: false, B1: false, B2: false, C1: true, C2: true },
    bankLevels: { A1: false, A2: true, B1: true, B2: true, C1: true, C2: true },
    exportLevels: { A1: true, A2: true, B1: true, B2: false, C1: true, C2: true },
    articleId: "story-42",
  });
  const stored = JSON.parse(memory.get("kslo.oxbridge.ui.v1"));
  assert.equal(stored.selection, DEFAULT_SELECTION);
  assert.equal(stored.articleId, null);
  assert.equal(stored.levels.A1, true);
  assert.equal(stored.levels.B2, false);

  const ui = loadUi();
  assert.equal(ui.selection, DEFAULT_SELECTION);
  assert.equal(ui.articleId, null);
  assert.equal(ui.levels.A1, true);
  assert.equal(ui.levels.B2, false);
  assert.equal(ui.bankLevels.A1, false);
  assert.equal(ui.exportLevels.B2, false);
  assert.equal(ui.section, "news");
});
