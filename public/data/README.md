# Oxbridge CEFR vocab data

Static pack for K S Lo Oxbridge News Reader (zero-AI frontend).

| File | Purpose |
|------|---------|
| `vocab.json` | Headwords, CEFR, POS, English glosses (`en`, kept in the pack, not shown) and HK Traditional Chinese glosses (`tc`, the gloss on the card), IPA (`phonetic`), multi-level senses, `inflection_map`. The client shows `tc`. |
| `LOOKUP.md` | Lemmatization / lookup algorithm |
| `oxford-cefr-a1-c2.csv` | Source Oxford/Cambridge A1–C2 list (reference) |

Load `vocab.json` at runtime. Follow `LOOKUP.md`: lowercase → `inflection_map` (value may be a string or array of lemmas); special-case `it`/`IT` and `I`.

Maintained by Lex (Oxbridge vocab specialist).
