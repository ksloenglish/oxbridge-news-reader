/** Build identity baked in by Vite. Hong Kong time, same shape as the S2 vocab stamp. */

export function buildIdentity(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value || "";
  const year = pick("year");
  const two = (value) => String(value).padStart(2, "0");
  const stamp = `v${year.slice(-2)}${two(pick("month"))}${two(pick("day"))}-${two(pick("hour"))}${two(pick("minute"))}${two(pick("second"))}`;
  return { stamp, year };
}
