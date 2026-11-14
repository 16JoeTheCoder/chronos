# Chronos parser: how it works and how to fix a misparse

Code: `src/core/parser/` (pure TypeScript, public API in `index.ts`). Spec: `CHRONOS_PARSER_REQUIREMENTS.md`, overridden by `decision.md`.

## Where things live

| What | File | Change by |
|---|---|---|
| Fixed / task words, default lengths, `allowDateOnly`, `usesSchedule` | `src/core/parser/builtin.chronos-parser.json` | edit JSON |
| Shorthand (`tmr`), weekdays, months, units, note signals, verb starters, fuzzy targets, never-correct words | `src/core/parser/lexicon.en.json` | edit JSON |
| Bell grid, weekly timetable | `ParseContext.bells` / `.timetable` (from Settings) | user data |
| User and learned rules | `ParseContext.rules` (`settings.parserRules`) | UI, `applyCorrection` |
| Grammar (what a time, range, duration, date looks like) | `parse.ts` | code, last resort |

## Fixing a misparse

1. **Add the corpus line first.** Append `input → kind | date | time | extras | title=...` to `tests/parser/corpus.txt` (format in its header; `now` and context come from `fixture.json`). Run `npx vitest run tests/parser/corpus.test.ts` and watch that one line fail.
2. **Fix it with data if you can.** Missing keyword or wrong kind: edit the built-in pack. Missing shorthand, unit or weekday spelling: edit the lexicon. A real word being "corrected" by fuzzy matching: add it to `fuzzy.neverCorrect`. A quantity noun being read as a time (`pages 10-20`): add it to `quantityNouns`. A note read as a task or the reverse: tune `noteSignals` / `verbStarters`.
3. **Only then touch `parse.ts`.** Each phase (prefix, recurrence, ranges, durations, single times, dates, rule words, cleanup, classification) is a small function; change the one that owns the behaviour.
4. **Run the whole suite**: `npx vitest run tests/parser`. A fix must not break any older corpus line. A line you truly cannot pass goes to `corpus.known-gaps.txt` with a one-line reason.
5. Grammar with no corpus line yet is covered in `tests/parser/grammar.test.ts`; add a case there for behaviour that depends on context (timetable, bells, rules) rather than a single line.

## Rules and learning

- Precedence: **user > learned > built-in.** A user rule can reclassify any word, including a built-in one.
- `applyCorrection(result, spanIndex, newValue, state)` counts identical corrections; the second one returns a `learned` rule. Store `state.rules` in `settings.parserRules` and pass them back in `ctx.rules`. A learned rule the user later corrects to something else is removed. User rules are never changed by learning.
- Packs are `*.chronos-parser.json` (`$schema: "chronos-parser-pack/1"`, `version`). `importPack` migrates older versions (`migratePack`) and validates (unique ids, valid kinds, no empty matches); `mergePacks` merges by `match` and reports conflicts. When the format changes, bump `PACK_VERSION` and add a step to `migratePack` plus a test.

## Behaviour worth knowing

- **Bare numbers** are times only with am/pm, a colon, a time preposition (`at 5`) or a clock range next to a date/fixed word (`lab 10-1 tomorrow`). Bare hours: 1-6 pm, 7-11 am, 12 noon.
- **Project words** anywhere set the project and stay in the title; only `#name` is removed.
- **Notes** keep the raw text and consume nothing; uncertain lines get `confidence: 'low'` and the other reading in `alternatives[0]`.
- A timetable period overrides the default length only for classes, or when the period title appears in the event title (`Football match 3pm` on a day with a Football period).
- `parseUnsafe` (in `parse.ts`) is the same as `parse` without the safety net; the property tests use it to catch hidden exceptions.
