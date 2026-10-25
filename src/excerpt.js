/** News Desk cards show about this many words, then an ellipsis. */
export const DESK_EXCERPT_WORDS = 20;

/**
 * Keep the first `limit` words. Longer text ends with one ellipsis.
 * A stored excerpt that is already short is left as it is.
 */
export function deskExcerpt(text, limit = DESK_EXCERPT_WORDS) {
  const words = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  if (words.length <= limit) return words.join(" ");
  const cut = words.slice(0, limit).join(" ").replace(/[.,;:!?…]+$/u, "");
  return `${cut}…`;
}
