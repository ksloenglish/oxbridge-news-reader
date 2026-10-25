# CEFR enriched JSON — lookup rules

File: `oxford-cefr-a1-c2.enriched.json`

## Structure

- `words`: lemma entries keyed by lookup key (usually lowercase; acronyms `CD`/`DVD`/`IT`/`ID`/`DNA` keep uppercase; `it` and `IT` are distinct keys).
- `inflection_map` (`imap`): surface form → lemma key, or **array of lemma keys** when a form collides with another lemma.

## Lookup algorithm

1. Normalize the token for map lookup: **lowercase**, except keep as-is for special cases below.
2. Special-case **case-sensitive** pronouns / acronyms before blind lowercasing:
   - `I` → look up `I` (if present); do not treat as `i`.
   - `it` / `IT`: after lowercasing you get `it`, whose imap value is `["it","IT"]`. Prefer the pronoun entry `it` in running text; if the token was uppercase `IT` (or clearly an acronym), prefer `IT` (Information Technology). Readers may return both and disambiguate by POS/context.
3. Look up the form in `inflection_map`.
   - If value is a **string**: that is the lemma key in `words`.
   - If value is an **array**: multi-target hit (form is itself a lemma *and* an inflection of another). Try all targets; rank by context/POS (e.g. `broken` → `["broken","break"]`, `found` → `["found","find"]`, `better`/`best` → include `good`, `could` → `["could","can"]`).
4. If missing from imap, try the token as a direct `words` key (and uppercase acronym key).
5. Display casing: use each entry’s `word` field (e.g. `May`, `March`) for UI; keys stay lowercase for months/modals sharing a key.

## Acronyms

`CD`, `DVD`, `IT`, `ID`, `DNA` are stored under uppercase keys in `words`. Imap includes **both** `cd`→`CD` and `CD`→`CD` (same for the others) so lowercase-then-map still resolves.

## Core additions

Lemmas `be` and `do` (list: `Core`, CEFR A1) are added for a school news reader. Forms `am/is/are/was/were/been/being` map to `be` (with `being` multi-target `["being","be"]`). Forms `does/did/done/doing` map to `do`.

## Authoritative morphology

Per-entry `forms` arrays were removed; **`inflection_map` is authoritative**.

## Definition `cefr` / `list`

Omitted on a sense when identical to the parent entry; kept when the sense differs (e.g. multi-level words).
