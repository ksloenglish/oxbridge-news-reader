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


## Stem heuristics and false participles

`inflection_map` is authoritative. Client `heuristicStems` (strip `-ing`/`-ed`/`-s`) is a **fallback only** when the surface is missing from imap and from `words`.

### Never strip onto adj/adv-only lemmas

Adjectives and adverbs do **not** form participles with `-ing`/`-ed` in this pack. A stem is a valid verb-morphology target only if that lemma’s `pos` includes **`v`** or **`modal v`**.

- Reject heuristic stems whose lemma is adj/adv-only (or otherwise has no verb sense).
- When imap returns a **multi-target array** and the surface ends in `-ing` / `-ed` / `-ied`, **drop** alternate targets that lack `v`/`modal v`. Keep the surface’s own lemma key when present.
- Comparative/superlative multi-targets stay valid (`better`/`best`→`good`, `worse`/`worst`→`bad`, `later`→`late`) — those are not `-ing`/`-ed` strips.

### Pack fixes (data)

False multi-targets removed:

- `evening` → `evening` only (was `["evening","even"]`; `even` is adv/adj)
- `longing` → `longing` only (was `["longing","long"]`)
- `outing` → `outing` only (was `["outing","out"]`)
- `evened` removed (`even` has no verb sense)

### Worked example

- Token `evening` → imap `evening` → **A1 noun only**. Do not also load B2 adj `even`.
- Token `longing` → `longing` only, not `long`.

## Definition `cefr` / `list`

Omitted on a sense when identical to the parent entry; kept when the sense differs (e.g. multi-level words).

## Zero-AI POS disambiguation (highlight + card)

Many lemmas are multi-POS / multi-CEFR (e.g. `say`: A1 verb + C1 noun; `part`: A1 noun + C2 verb). The pack keeps **all** senses. The reader must **not** mark a token multi-level solely because unused senses exist.

Pass local context from `annotate` into `lookupSurface` (prev token, next token / next raw span, `sentenceStart`, capitalization). After resolving reading entries, **filter senses before** `levels` / `ambiguous` / `highlightStyle`. Apply filters in order; stop when one prefers a single POS family (`n` vs `v`/`modal v`).

### A. Verb morphology (surface ≠ lemma)

Prefer **verb** senses only when the surface is a **clear verb inflection**, not a bare plural:

- Irregular past/participle via imap where surface ≠ lemma and surface does **not** look like a regular noun plural only (`…s` / `…es` / `…ies` with no other cue): e.g. `said`→`say`, `went`→`go`, `told`→`tell`, `left`→`leave`.
- Regular endings **`-ed`** or **`-ing`** (after the existing stem heuristics).
- Do **not** force verb for surface≠lemma that is only a regular plural (`parts`, `books`, `lines`) — those usually stay noun-capable; use section B/C.

**Multi-target imap exception:** e.g. `saying`→`["saying","say"]`, `being`→`["being","be"]` — do not strip noun senses from a target that is itself a noun lemma; apply morphology per lemma only when surface ≠ that lemma key.

### B. Verb context (bare or inflected)

Prefer **verb** when:

- Previous token is infinitival **`to`**, or a modal (`will`/`would`/`can`/`could`/`may`/`might`/`must`/`should`/`shall`), or aux (`do`/`does`/`did`/`don't`/…).
- Previous token is a subject pronoun + present form that could be 3sg (`he`/`she`/`it` + token).

### C. Noun context (fixes “Part 2”)

When the entry has a **noun** sense, prefer **noun** (drop verb/adj/adv for highlight + primary card) if any of:

1. **Section + numeral/ordinal (strong).** Next raw token matches a number or roman numeral: `Part 2`, `Part II`, `Chapter 3`, `Act 1`, `Section 1.2`, `Volume IV`, `Episode 5`, `Unit 4`, `Page 12`, `Grade 3`, `Level 2`, `Step 1`, `Stage 2`, `Round 3`, `Scene 4`. Optional closed set of section-ish lemmas makes this even safer, but the pattern alone is enough for news/UI titles.
2. **`of` after (strong).** Next token is `of` — `part of`, `parts of`, `end of`.
3. **Determiner / possessive / quantifier before.** Prev ∈ {`a`,`an`,`the`,`this`,`that`,`these`,`those`,`my`,`your`,`his`,`her`,`its`,`our`,`their`,`each`,`every`,`any`,`some`,`many`,`much`,`more`,`most`,`few`,`several`,`no`,`one`…`ten`, and other simple cardinals}. Example: `the part`, `a part`.
4. **Capitalized title use + (1).** Title Case `Part` even at sentence start when followed by a numeral still prefers noun.

If a verb cue (B) and a noun cue (C) both fire, **stronger cue wins**: numeral/`of` > `to`/modal > determiner. If still tied, keep both senses (multi).

### D. Bare lemma with no cue

When surface equals the lemma and A–C do not fire (`say`, `book`, `run` in free prose), keep every sense; multi-level / dotted highlight is allowed.

### E. Card ranking when still multi

If more than one CEFR remains after filters, **primary card sense = lowest CEFR among remaining** (A1 before C2), then original definition order. Never let a rare high-CEFR verb outrank a common low-CEFR noun for the default card face. Other senses stay secondary/collapsed — they must **not** drive highlight colour.

### F. Month preference

`March` / `May` month preference stays as already implemented; run it, then A–E.

### G. Data

**Do not edit `vocab.json`** for this class of bug.

### Worked examples

- `said` → `say` → clear verb inflection → **A1 verb only** (not C1 noun).
- `Chan said he…` → same.
- `Part 2` → bare `part` but numeral after → **A1 noun only** (not dotted with C2 verb).
- `part of the plan` → `of` after → **A1 noun**.
- `to part` / `will part` → verb cues → **C2 verb** (or whatever verb CEFR remains).
- Bare `say` / bare `part` with no local cue → both senses OK; if both levels active, dotted; card face shows **lowest CEFR** first.
