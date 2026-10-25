import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { annotate, createLexicon, lookupSurface, partitionSenses } from "../src/lookup.js";
import { formatWordText, hitToRecord, toCsv } from "../src/export.js";

const pack = JSON.parse(await readFile(new URL("../public/data/vocab.json", import.meta.url), "utf8"));
const lex = createLexicon(pack);
const advanced = new Set(["B2", "C1", "C2"]);

test("inflection map resolves regular and irregular forms", () => {
  assert.equal(lookupSurface(lex, "marched").reading[0].key, "march");
  assert.equal(lookupSurface(lex, "studies").reading[0].key, "study");
  assert.equal(lookupSurface(lex, "went").reading[0].key, "go");
  assert.equal(lookupSurface(lex, "children").reading[0].key, "child");
});

test("I, it, and IT follow the special cases", () => {
  const pronoun = lookupSurface(lex, "I");
  assert.equal(pronoun.reading[0].key, "i");
  assert.equal(pronoun.reading[0].word, "I");
  assert.equal(pronoun.ambiguous, false);

  const lower = lookupSurface(lex, "it");
  assert.equal(lower.reading[0].key, "it");
  assert.equal(lower.alternates[0].key, "IT");

  const upper = lookupSurface(lex, "IT");
  assert.equal(upper.reading[0].key, "IT");
  assert.equal(upper.alternates[0].key, "it");
  assert.equal(upper.ambiguous, false);
});

test("all-caps tokens do not fall through to a lowercase lemma", () => {
  assert.equal(lookupSurface(lex, "US"), null);
  assert.equal(lookupSurface(lex, "CD").reading[0].key, "CD");
});

test("mid-sentence lowercase march prefers the non-month sense and stays ambiguous", () => {
  const hit = lookupSurface(lex, "march", { sentenceStart: false });
  assert.equal(hit.preference, "non-month");
  assert.equal(hit.ambiguous, true);
  assert.deepEqual(hit.levels.sort(), ["A1", "C1"]);
  const parts = partitionSenses(hit, advanced);
  assert.ok(parts.match.every((sense) => sense.cefr === "C1" || sense.cefr === "B2" || sense.cefr === "C2"));
  assert.ok(parts.match.some((sense) => !sense.month));
  assert.ok(parts.other.some((sense) => sense.month && sense.cefr === "A1"));
});

test("capitalised May prefers the month sense", () => {
  const hit = lookupSurface(lex, "May", { sentenceStart: true });
  assert.equal(hit.preference, "month");
  const parts = partitionSenses(hit, new Set(["A1", "A2", "B1", "B2", "C1", "C2"]));
  assert.equal(parts.match[0].month, true);
});

test("default highlights keep B2–C2 and dash multi-level words", () => {
  const parts = annotate("They march past the school.", lex, advanced);
  const march = parts.find((part) => part.type === "hit" && part.text === "march");
  assert.ok(march);
  assert.equal(march.style.kind, "multi");
  const school = parts.find((part) => part.text === "school");
  assert.equal(school.type, "text");
});

test("suffix heuristics cover forms missing from the map", () => {
  const tiny = createLexicon({
    words: {
      walk: { word: "walk", cefr: "A2", phonetic: "wɔːk", pos: ["v"], definitions: [{ pos: "v", tc: "行" }] },
      box: { word: "box", cefr: "A1", phonetic: "bɒks", pos: ["n"], definitions: [{ pos: "n", tc: "盒" }] },
      study: { word: "study", cefr: "A1", phonetic: "", pos: ["v"], definitions: [{ pos: "v", tc: "學習" }] },
    },
    inflection_map: {},
  });
  assert.equal(lookupSurface(tiny, "walked").reading[0].key, "walk");
  assert.equal(lookupSurface(tiny, "walking").reading[0].key, "walk");
  assert.equal(lookupSurface(tiny, "walks").reading[0].key, "walk");
  assert.equal(lookupSurface(tiny, "boxes").reading[0].key, "box");
  assert.equal(lookupSurface(tiny, "studies").reading[0].key, "study");
});

test("copy text and CSV keep only the chosen CEFR levels", () => {
  const hit = lookupSurface(lex, "address");
  const record = hitToRecord(hit, { title: "A story", url: "https://example.com/a" });
  const text = formatWordText(record, new Set(["B2"]));
  assert.match(text, /B2/);
  assert.doesNotMatch(text, /\(A1\)/);
  assert.match(text, /\/ə'dres\//);
  const csv = toCsv([record], new Set(["A1", "B2"]));
  assert.match(csv, /word,lemma,CEFR,POS,defs,IPA,savedAt,sourceTitle,sourceUrl/);
  assert.match(csv, /A story/);
  assert.match(csv, /https:\/\/example\.com\/a/);
});
