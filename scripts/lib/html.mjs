/** Plain-text cleanup for feed HTML. Script and style blocks are removed. */

/** News Desk card excerpts are about this many words. `fullText` stays whole. */
export const EXCERPT_WORDS = 20;

const NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  bull: "•",
  middot: "·",
  copy: "©",
  reg: "®",
  trade: "™",
  times: "×",
  divide: "÷",
  laquo: "«",
  raquo: "»",
};

export function decodeEntities(value) {
  return String(value).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]+);/g, (match, body) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X"
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return match;
      return String.fromCodePoint(code);
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body] : match;
  });
}

function stripDangerous(value) {
  return value
    .replace(/<\s*(script|style|noscript|iframe|object|embed|svg|form|template)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, " ")
    .replace(/<\s*(script|style|noscript|iframe|object|embed|svg|form|template)\b[^>]*>[\s\S]*$/gi, " ")
    .replace(/<\s*(script|style|noscript|iframe|object|embed|svg|form|template)\b[^>]*\/?\s*>/gi, " ");
}

function breakBlocks(value) {
  return value
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|h[1-6]|li|tr|blockquote|section|article|figcaption|ul|ol)\s*>/gi, "\n")
    .replace(/<\s*li\b[^>]*>/gi, "\n- ");
}

function normalizeWhitespace(value) {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function htmlToText(input) {
  let text = String(input ?? "").replace(/^\uFEFF/, "");
  for (let pass = 0; pass < 3; pass += 1) {
    text = stripDangerous(text);
    text = text.replace(/<!--[\s\S]*?-->/g, " ");
    text = breakBlocks(text);
    text = text.replace(/<[^>]+>/g, " ");
    text = decodeEntities(text);
  }
  text = stripDangerous(text);
  text = breakBlocks(text);
  text = text.replace(/<[^>]+>/g, " ");
  return normalizeWhitespace(text);
}

/** Whitespace-separated tokens. Punctuation stays attached to its word. */
export function wordsOf(value) {
  const flat = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!flat) return [];
  return flat.split(" ");
}

/**
 * Card excerpt of about `maxWords` words (default 20).
 * Shorter text is returned whole. A cut ends on a word boundary with an ellipsis.
 */
export function makeExcerpt(fullText, maxWords = EXCERPT_WORDS) {
  const words = wordsOf(fullText);
  const limit = Number.isInteger(maxWords) && maxWords > 0 ? maxWords : EXCERPT_WORDS;
  if (words.length <= limit) return words.join(" ");
  const cut = words.slice(0, limit).join(" ").replace(/[.,;:!?]+$/u, "");
  return cut ? `${cut}…` : "…";
}

export function resolveHttpUrl(value, base) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed || /^(javascript|data|vbscript):/i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function extractImageFromHtml(html, base) {
  if (!html) return null;
  const source = String(html);
  for (const match of source.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    if (!/(?:property|name)\s*=\s*["']og:image(?::secure_url)?["']/i.test(tag)) continue;
    const content = /content\s*=\s*["']([^"']+)["']/i.exec(tag);
    const resolved = content && resolveHttpUrl(decodeEntities(content[1]), base);
    if (resolved) return resolved;
  }
  for (const match of source.matchAll(/<img\b[^>]*>/gi)) {
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(match[0]);
    const resolved = src && resolveHttpUrl(decodeEntities(src[1]), base);
    if (resolved) return resolved;
  }
  return null;
}
