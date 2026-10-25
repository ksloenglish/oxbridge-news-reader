import { posLabel, primaryEntry } from "./lookup.js";

export function hitToRecord(hit, source = {}) {
  const preferred = primaryEntry(hit);
  const senses = hit.reading.flatMap((entry) =>
    entry.senses.map((sense) => ({
      lemma: entry.key,
      word: entry.word,
      pos: sense.pos,
      cefr: sense.cefr,
      text: sense.text,
    })),
  );
  const levels = [...new Set(senses.map((sense) => sense.cefr).filter(Boolean))];
  return {
    id: hit.reading
      .map((entry) => entry.key)
      .sort()
      .join("+"),
    word: preferred.word,
    lemma: preferred.key,
    cefr: levels.join("|"),
    levels,
    pos: [...new Set(hit.reading.flatMap((entry) => entry.pos))],
    ipa: preferred.phonetic || "",
    senses,
    savedAt: new Date().toISOString(),
    sourceTitle: source.title || "",
    sourceUrl: source.url || "",
    surface: hit.surface,
  };
}

function selectedSenses(record, levels) {
  const allow = levels instanceof Set ? levels : new Set(levels);
  return (record.senses || []).filter((sense) => allow.has(sense.cefr));
}

export function formatWordText(record, levels) {
  const senses = selectedSenses(record, levels);
  const cefr = [...new Set(senses.map((sense) => sense.cefr))].join(", ");
  const lines = [
    `Word: ${record.word}`,
    `CEFR: ${cefr || "—"}`,
    `Part of speech: ${(record.pos || []).map(posLabel).join(", ") || "—"}`,
    "Definitions:",
  ];
  if (!senses.length) lines.push("- (no senses at the chosen levels)");
  for (const sense of senses) {
    lines.push(`- ${posLabel(sense.pos)} (${sense.cefr}): ${sense.text}`);
  }
  return lines.join("\n");
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(records, levels) {
  const header = ["word", "CEFR", "POS", "defs"];
  const lines = [header.join(",")];
  for (const record of records) {
    const senses = selectedSenses(record, levels);
    const cefr = [...new Set(senses.map((sense) => sense.cefr))].join("|");
    const defs = senses.map((sense) => `${sense.pos} (${sense.cefr}): ${sense.text}`).join(" | ");
    lines.push([record.word, cefr, (record.pos || []).join("|"), defs].map(csvCell).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
