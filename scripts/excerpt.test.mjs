import assert from "node:assert/strict";
import test from "node:test";
import { DESK_EXCERPT_WORDS, deskExcerpt } from "../src/excerpt.js";

test("news desk excerpts stop at about 20 words", () => {
  const words = Array.from({ length: 43 }, (_, index) => `w${index + 1}`);
  const excerpt = deskExcerpt(words.join(" "));
  assert.equal(excerpt.split(" ").length, DESK_EXCERPT_WORDS);
  assert.equal(excerpt.endsWith("…"), true);
  assert.equal(excerpt.includes("w21"), false);
  assert.equal(excerpt.startsWith("w1 "), true);
});

test("a short excerpt is not given an extra ellipsis", () => {
  assert.equal(deskExcerpt("Only six words live in this line."), "Only six words live in this line.");
  assert.equal(deskExcerpt(""), "");
});

test("the cut drops a trailing comma before the ellipsis", () => {
  const words = Array.from({ length: 21 }, (_, index) => (index === 19 ? "seaters," : `w${index + 1}`));
  const excerpt = deskExcerpt(words.join(" "));
  assert.equal(excerpt.endsWith("seaters…"), true);
  assert.equal(excerpt.includes("w21"), false);
});
