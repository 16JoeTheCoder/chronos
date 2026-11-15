# decision.md (parser)

What was decided mid-design. Each item overrides the matching line in CHRONOS_PARSER_REQUIREMENTS.md. Josef confirmed D1-D12 in chat on 2026-11-14; D13-D15 are proposals that need his OK.

## Confirmed by Josef

**D1. No default length for fixed events.** A fixed event with a start and no end is saved start-only; the UI asks for the end. Exceptions live in the pack as `defaultDurationMin`: `call` = 30, `class` = 60 (fallback only). Josef can add more per word.

**D2. Class length comes from the schedule.** Order: (1) an entry in `ctx.timetable` for that weekday starting at that time, so double periods fall out for free (Mon P1-2 Math = 07:45-09:05); (2) a bell start in `ctx.bells` = one period (40 min); (3) the pack default (60). Typing "double" extends to two periods. Two new ParseContext fields: `bells`, `timetable`. The one-day edit or skip of a timetable entry is a Chronos feature; the parser just receives that day's version.

**D3. "by" and "due" beat fixed keywords.** `Call mom by 8pm` is a task due 20:00. `by <name>` is not a deadline (`finish design request by ko dieky`).

**D4. Start + length = fixed**, with or without "for": `Gym workout 90 mins 4pm`, `call oma 4pm for 1h`, `2hrs sleep nap 2pm`. A range also makes it fixed and beats a task keyword (`Study with Mr. Tjong at 10to1pm`).

**D5. Passed times.** Tasks keep their date (today); the end-of-day review asks "done?". Fixed events are kept and get a warning. Replaces "move to tomorrow".

**D6. A bare number is never a time.** It is a time only with am/pm or a colon (`4pm`, `4:30`, `16:00`), after `at`, `@`, `by`, `due`, `from`, `till`, `until`, or as a valid clock range next to a time word or fixed keyword (`10-1`, `4-6`). `math hw 5` keeps the 5 in the title. `pages 10-20` is not a range of times. Removes spec rule 6(d).

**D7. "tonight" = today, no time.** It queues the item for today. Replaces "start 18:00". So `dinner tonight` is a task today (a fixed word with a date only is a task).

**D8. Event words.** Added to the pack: workout, gym, meet, padel, birthday, restaurant. `test` and `exam` are date-only event words: `Math test tomorrow!` is a fixed all-day reminder, not a task. A task keyword wins over them: `Study for magnets test on this fri` stays a task. ASSUMPTION TO CHECK: the v2 data model must allow a fixed event with no time. Read `types.ts` first; if it does not, ask Josef.

**D9. Fixed word + date only = task** (`go to church tmr`, `gym next mon`).

**D10. Notes vs tasks.** Prefix `note ` or `//` always wins. In quick-add, bias to task. A line is a task if it starts with a verb from the lexicon, has a task keyword, or carries a time, duration, priority or project. A line is a note when it has none of those and starts with a hedge, first-person or function word, or is sentence-like (>= 6 words with >= 2 function words). Notes keep the raw text: nothing is consumed (`tdy` stays). Uncertain cases get `confidence: low` and the other kind as `alternatives[0]`. Replaces ">12 words". Thresholds live in `lexicon.en.json` and are tuned on the corpus.

**D11. Fuzzy matching is conservative.** Only inside a number+unit or a date/time slot. Collapse repeated letters first, same first letter, max edit distance 1 (targets up to 5 letters) or 2 (6+), keyboard-neighbour or one stray punctuation character counts as 1. Never correct a real word: generate `neverCorrect` at build time by checking every target against a common-word list. The chip shows the corrected meaning; the user's typed text is never rewritten.

**D12. Cleanup of the title.** Consumed spans also remove adjacent `at/on/by/due/for`, the day parts `morning/afternoon/evening`, and `in the morning of`. A leading `in` is dropped after a removed duration (`2hrzz in mechanical engineering prep`). Only `for <duration>` is consumed (`for shorts` stays). `in Kopi Kenangan` is never `in N days`. Letter/digit glue is split (`10to1pm`, `mom4pm`, `3pages`); letters-only glue is not (`keyboardthis`).

## Proposed, needs Josef's OK

**D13. Project words.** Consume a project word only at the start of the line, or right before a priority marker at the end, or with a `#` prefix. Mid-line it stays plain text and sets no project. This is the rule that makes all confirmed corpus lines consistent (`Finish Chronos Build`, `Meeting with SC`, `work on sc draft proposal` keep the word; `sc budget draft !2 tmr`, `greenmech build robot arm`, `fix parser bug chronos !1` consume it). If consuming would leave the title empty, keep the word (`greenmech 3pm to 4:30pm friday`).

**D14. Corpus size.** Josef cannot hand-write 150 lines. Shipped 117: crucial categories are his own words, the grammar categories (4-6 each) are Claude drafts he confirmed. This is below the spec's 10 per category. Make up the difference through the misparse loop (D15).

**D15. Misparse loop.** The quick-add has a "Report misparse" action: it stores the input, what Josef expected, and what the parser produced in synced settings. Claude reads these, adds the line to `corpus.txt`, and ships a pack or lexicon update. Most fixes are data, not code. A fix may not break any older corpus line.

## Decided 2026-11-14 (Phase 2+3 planning chat)

**D13 revised (replaces the proposal).** Any project word anywhere in the line sets the project; the word stays in the title. Only `#name` is removed from the title.

**D16. Tests and exams use the timetable.** `<subject> test|exam <date>`: if that day's timetable has a period whose title matches the subject (case-insensitive, prefix/alias match, e.g. "math" = "Math"), the event takes that period's start and end (first match). If not, it is a fixed event on that date with no time yet and a 60 min duration ("to place"), which the user drags onto the timeline. Replaces "all day" in D8. Needs the CalEvent schema change in the build prompt.

**D17. 1 h default for every fixed event typed with a start and no end** (replaces D1). Exceptions: `call` = 30 min (pack), classes and timetable matches take the period length. The user adjusts by dragging.

## Not decided / out of scope here
- The schedule importer (PDF or image to LLM to JSON). Separate feature, built after the parser. The AI runs once at import time; the parser only reads the resulting JSON, so "no AI in the parse path" still holds.
- "yesterday" handling, bare-hour rules (1-6 = pm, 7-11 next occurrence, 12 = noon), `half 5`, `quarter past 4`, `noon/midnight`, `1700`, `5.30`: no corpus lines yet. See `tests/parser/corpus.known-gaps.txt`.
