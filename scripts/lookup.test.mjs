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

test("title-case runs stay plain, while a lone listed word such as Sunday or Jazz still matches", () => {
  const levels = new Set(["A1", "A2", "B1", "B2", "C1", "C2"]);
  const text = "John Catlin of the United States on Sunday claimed victory at the Hong Kong Open. Thailand's Jazz Janewattananond and Nick Voke of New Zealand, and Jazz on Sunday. The PGA Tour is new.";
  const hits = annotate(text, lex, levels).filter((part) => part.type === "hit").map((part) => part.text);
  for (const blocked of ["United", "States", "John", "Catlin", "Hong", "Kong", "Open", "Nick", "Voke", "New", "Zealand", "Janewattananond", "Thailand"]) {
    assert.equal(hits.includes(blocked), false, blocked);
  }
  assert.equal(hits.filter((word) => word === "Sunday").length, 2);
  assert.equal(hits.filter((word) => word === "Jazz").length, 1);
  assert.ok(hits.includes("claimed"));
  assert.ok(hits.includes("victory"));
  assert.ok(hits.includes("Tour"));
  assert.ok(hits.includes("new"));

  const lower = annotate("the united states", lex, levels).filter((part) => part.type === "hit").map((part) => part.text);
  assert.ok(lower.includes("united"));
  assert.ok(lower.includes("states"));

  const sentence = annotate("New rules open the tour.", lex, levels).filter((part) => part.type === "hit").map((part) => part.text);
  assert.ok(sentence.includes("New"));
  assert.ok(sentence.includes("open"));
  assert.ok(sentence.includes("tour"));

  assert.equal(lookupSurface(lex, "Sunday", { nameRun: true }), null);
  assert.equal(lookupSurface(lex, "New", { nameRun: true }), null);
  assert.equal(lookupSurface(lex, "Sunday").reading[0].word, "Sunday");
  assert.equal(lookupSurface(lex, "Jazz").reading[0].word, "jazz");
  assert.equal(lookupSurface(lex, "jazz").reading[0].word, "jazz");
  assert.equal(lookupSurface(lex, "United").reading[0].key, "united");
  assert.equal(lookupSurface(lex, "States").reading[0].key, "state");
  assert.equal(lookupSurface(lex, "IT").reading[0].key, "IT");
  assert.equal(lookupSurface(lex, "it").reading[0].key, "it");
});

test("a capitalised word before a numeral prefers the noun", () => {
  const all = new Set(["A1", "A2", "B1", "B2", "C1", "C2"]);
  const text = "Visit Part 2 of Hong Kong's First Five-Year Plan for more details.";
  const hits = annotate(text, lex, all).filter((part) => part.type === "hit");
  const part = hits.find((item) => item.text === "Part");
  assert.ok(part);
  assert.equal(part.style.kind, "solid");
  assert.equal(part.style.level, "A1");
  assert.equal(part.hit.ambiguous, false);
  assert.ok(part.hit.reading.every((entry) => entry.senses.every((sense) => sense.pos === "n")));
  assert.ok(part.hit.secondary.some((sense) => sense.pos === "v" && sense.cefr === "C2"));
  const parts = partitionSenses(part.hit, all);
  assert.ok(parts.match.every((sense) => sense.pos === "n" && sense.cefr === "A1"));
  assert.equal(parts.match.some((sense) => sense.pos === "v"), false);
  assert.ok(hits.some((item) => item.text === "Visit"));
  for (const blocked of ["Hong", "First", "Five", "Year", "Plan"]) {
    assert.equal(hits.some((item) => item.text === blocked), false, blocked);
  }

  const hidden = annotate(text, lex, advanced).find((item) => item.text === "Part");
  assert.equal(hidden.type, "text");

  const ofPart = annotate("Part of the plan.", lex, all).find((item) => item.text === "Part");
  assert.equal(ofPart.style.kind, "solid");
  assert.equal(ofPart.style.level, "A1");
  assert.ok(ofPart.hit.reading.every((entry) => entry.senses.every((sense) => sense.pos === "n")));
  const lower = annotate("Read part 2 now.", lex, all).find((item) => item.text === "part");
  assert.equal(lower.style.kind, "solid");
  assert.equal(lower.style.level, "A1");

  const chapter = annotate("Chapter 3 starts.", lex, all).find((item) => item.text === "Chapter");
  assert.equal(chapter.style.kind, "solid");
  assert.equal(chapter.style.level, "B1");
  const figure = annotate("See Figure 1.", lex, all).find((item) => item.text === "Figure");
  assert.equal(figure.style.kind, "solid");
  assert.equal(figure.style.level, "A2");
  assert.ok(figure.hit.secondary.some((sense) => sense.pos === "v"));

  const said = annotate("Said 2 people left.", lex, all).find((item) => item.text === "Said");
  assert.equal(said.style.kind, "solid");
  assert.equal(said.style.level, "A1");
  assert.ok(said.hit.reading.every((entry) => entry.senses.every((sense) => sense.pos === "v" || sense.pos === "modal v")));

  const may = annotate("On May 2 the term starts.", lex, all).find((item) => item.text === "May");
  assert.equal(may.style.kind, "solid");
  assert.equal(may.style.level, "A1");
  assert.ok(may.hit.reading[0].senses.every((sense) => sense.month));
  const march = annotate("The March 3 parade is new.", lex, all).find((item) => item.text === "March");
  assert.equal(march.style.kind, "solid");
  assert.equal(march.style.level, "A1");
  assert.ok(march.hit.reading[0].senses.every((sense) => sense.month));
});

test("inflected verbs keep verb senses only, bare lemmas stay multi-level", () => {
  const all = new Set(["A1", "A2", "B1", "B2", "C1", "C2"]);
  const said = lookupSurface(lex, "said");
  assert.deepEqual(said.levels, ["A1"]);
  assert.equal(said.ambiguous, false);
  assert.ok(said.reading.every((entry) => entry.senses.every((sense) => sense.pos === "v" || sense.pos === "modal v")));
  assert.ok(said.secondary.some((sense) => sense.pos === "n" && sense.cefr === "C1"));
  const saidParts = partitionSenses(said, all);
  assert.ok(saidParts.match.every((sense) => sense.pos === "v" && sense.cefr === "A1"));
  assert.equal(saidParts.match.some((sense) => sense.cefr === "C1"), false);

  const line = annotate("Chan said he directed the bureau.", lex, all);
  const saidHit = line.find((part) => part.text === "said");
  assert.equal(saidHit.style.kind, "solid");
  assert.equal(saidHit.style.level, "A1");
  const hidden = annotate("Chan said he directed the bureau.", lex, advanced);
  assert.equal(hidden.find((part) => part.text === "said").type, "text");

  for (const form of ["went", "told"]) {
    const hit = lookupSurface(lex, form);
    assert.equal(hit.ambiguous, false, form);
    assert.ok(hit.reading.every((entry) => entry.senses.every((sense) => sense.pos === "v" || sense.pos === "modal v")), form);
  }

  const says = lookupSurface(lex, "says");
  assert.equal(says.ambiguous, true);
  assert.ok(says.reading.some((entry) => entry.senses.some((sense) => sense.pos === "n")));
  const heSays = annotate("He says it clearly.", lex, all).find((part) => part.text === "says");
  assert.equal(heSays.style.kind, "solid");
  assert.equal(heSays.style.level, "A1");
  assert.ok(heSays.hit.reading.every((entry) => entry.senses.every((sense) => sense.pos === "v" || sense.pos === "modal v")));

  const say = lookupSurface(lex, "say");
  assert.deepEqual(say.levels.sort(), ["A1", "C1"]);
  assert.equal(say.ambiguous, true);
  assert.equal(say.secondary.length, 0);
  const sayHit = annotate("They say it.", lex, all).find((part) => part.text === "say");
  assert.equal(sayHit.style.kind, "multi");

  const saying = lookupSurface(lex, "saying");
  assert.ok(saying.reading.some((entry) => entry.key === "saying" && entry.senses.some((sense) => sense.pos === "n")));
  assert.ok(saying.reading.some((entry) => entry.key === "say" && entry.senses.every((sense) => sense.pos === "v")));
  assert.equal(saying.levels.includes("C1"), false);
  assert.ok(saying.secondary.some((sense) => sense.cefr === "C1" && sense.pos === "n"));

  const marched = lookupSurface(lex, "marched");
  assert.ok(marched.reading[0].senses.every((sense) => sense.pos === "v"));
  assert.equal(marched.levels.includes("A1"), false);
});

test("part context prefers noun or verb before the highlight colour is chosen", () => {
  const all = new Set(["A1", "A2", "B1", "B2", "C1", "C2"]);
  const nounOnly = (hit) => hit.reading.every((entry) => entry.senses.every((sense) => sense.pos === "n"));
  const verbOnly = (hit) => hit.reading.every((entry) => entry.senses.every((sense) => sense.pos === "v" || sense.pos === "modal v"));

  const cases = [
    ["Visit Part 2 of the plan.", "Part", "solid", "A1", nounOnly],
    ["Read part 2 now.", "part", "solid", "A1", nounOnly],
    ["Part II opens tonight.", "Part", "solid", "A1", nounOnly],
    ["Act I begins.", "Act", "solid", "B1", nounOnly],
    ["See Section 1.2 for the map.", "Section", "solid", "A1", nounOnly],
    ["Chapter 3 starts.", "Chapter", "solid", "B1", nounOnly],
    ["A part of the plan failed.", "part", "solid", "A1", nounOnly],
    ["The parts of the plan failed.", "parts", "solid", "A1", nounOnly],
    ["She read the part.", "part", "solid", "A1", nounOnly],
    ["They decided to part.", "part", "solid", "C2", verbOnly],
    ["They will part soon.", "part", "solid", "C2", verbOnly],
    ["Go to Part 2 now.", "Part", "solid", "A1", nounOnly],
    ["He says it.", "says", "solid", "A1", verbOnly],
    ["He books a table.", "books", "solid", "A2", verbOnly],
  ];
  for (const [text, token, kind, level, check] of cases) {
    const hit = annotate(text, lex, all).find((part) => part.text === token);
    assert.ok(hit && hit.type === "hit", text);
    assert.equal(hit.style.kind, kind, text);
    assert.equal(hit.style.level, level, text);
    assert.ok(check(hit.hit), text);
  }

  const bare = lookupSurface(lex, "part");
  assert.equal(bare.ambiguous, true);
  assert.deepEqual(bare.levels, ["A1", "C2"]);
  const face = partitionSenses(bare, all);
  assert.ok(face.match.every((sense) => sense.pos === "n" && sense.cefr === "A1"));
  assert.ok(face.secondary.some((sense) => sense.pos === "v" && sense.cefr === "C2"));
  const bareHit = annotate("Then part quietly.", lex, all).find((part) => part.text === "part");
  assert.equal(bareHit.style.kind, "multi");

  for (const form of ["parts", "books", "lines"]) {
    const hit = lookupSurface(lex, form);
    assert.ok(hit.reading.some((entry) => entry.senses.some((sense) => sense.pos === "n")), form);
    assert.equal(hit.reading.every((entry) => entry.senses.every((sense) => sense.pos === "v")), false, form);
  }
});

test("evening is the A1 noun and does not attach the adjective even", () => {
  const all = new Set(["A1", "A2", "B1", "B2", "C1", "C2"]);
  const hit = lookupSurface(lex, "evening");
  assert.deepEqual(hit.reading.map((entry) => entry.key), ["evening"]);
  assert.deepEqual(hit.levels, ["A1"]);
  assert.equal(hit.ambiguous, false);
  assert.ok(hit.reading.every((entry) => entry.senses.every((sense) => sense.pos === "n")));
  assert.equal(hit.secondary.some((sense) => sense.lemma === "even"), false);
  const face = partitionSenses(hit, all);
  assert.ok(face.match.every((sense) => sense.pos === "n" && sense.cefr === "A1" && sense.lemma === "evening"));
  assert.equal(face.match.some((sense) => sense.lemma === "even"), false);
  assert.equal(face.secondary.some((sense) => sense.lemma === "even"), false);

  const shown = annotate("in the evening.", lex, all).find((part) => part.text === "evening");
  assert.equal(shown.style.kind, "solid");
  assert.equal(shown.style.level, "A1");
  const thursday = annotate("Thursday evening.", lex, all).find((part) => part.text === "evening");
  assert.equal(thursday.style.kind, "solid");
  assert.equal(thursday.style.level, "A1");
  const possessive = annotate("the evening's programme.", lex, all).find((part) => part.text.startsWith("evening"));
  assert.equal(possessive.style.kind, "solid");
  assert.equal(possessive.style.level, "A1");
  const hidden = annotate("in the evening.", lex, advanced).find((part) => part.text === "evening");
  assert.equal(hidden.type, "text");

  for (const form of ["longing", "outing"]) {
    const word = lookupSurface(lex, form);
    assert.deepEqual(word.reading.map((entry) => entry.key), [form], form);
    assert.equal(word.reading.some((entry) => entry.key === "long" || entry.key === "out" || entry.key === "even"), false, form);
  }

  const better = lookupSurface(lex, "better");
  assert.ok(better.reading.some((entry) => entry.key === "better"));
  assert.ok(better.reading.some((entry) => entry.key === "good"));
  const saying = lookupSurface(lex, "saying");
  assert.ok(saying.reading.some((entry) => entry.key === "saying"));
  assert.ok(saying.reading.some((entry) => entry.key === "say"));

  const tiny = createLexicon({
    words: {
      even: { word: "even", cefr: "A1", pos: ["adj", "adv"], definitions: [{ pos: "adj", cefr: "B2", tc: "平坦" }] },
      walk: { word: "walk", cefr: "A1", pos: ["v"], definitions: [{ pos: "v", tc: "行" }] },
      box: { word: "box", cefr: "A1", pos: ["n"], definitions: [{ pos: "n", tc: "盒" }] },
    },
    inflection_map: {},
  });
  assert.equal(lookupSurface(tiny, "evening"), null);
  assert.equal(lookupSurface(tiny, "evened"), null);
  assert.equal(lookupSurface(tiny, "walked").reading[0].key, "walk");
  assert.equal(lookupSurface(tiny, "boxes").reading[0].key, "box");

  assert.equal(lookupSurface(lex, "evened"), null);
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
