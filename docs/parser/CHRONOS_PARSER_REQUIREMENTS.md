# Chronos quick-add parser: requirements

You are building the natural-language parser for **Chronos** (github.com/16JoeTheCoder/chronos), Josef Yang's Windows 11 time-and-focus app (Electron + React + TypeScript). The parser turns one line of typed text into a fixed event, a task or a note, with every interpreted word shown as a chip the user can undo. This is the feature that makes or breaks the app: it must be fast, deterministic, and right about 95 % of the time on the way Josef actually types.

Read `src/core/model/types.ts`, `src/core/validation.ts` and `src/core/commands.ts` before designing anything. The data model (v2) is fixed; the parser produces values for it and adds nothing to it except what section 9 allows.

---

## 1. Where it lives and hard constraints

- Pure TypeScript in `src/core/parser/`. No Electron, Node-only or DOM APIs, so the same code runs in the desktop app, the future phone app (Capacitor) and the remote MCP Worker.
- **Deterministic:** same input + same context = same output, always. No AI or network anywhere in the parse path.
- **Fast:** under 5 ms per parse for a 120-character input on a mid-range laptop, because it re-parses on every keystroke for the live preview.
- **Offline**, never throws (returns a note-type result on anything it cannot read).
- Base date/time understanding on **chrono-node** (pin the version). Everything Chronos-specific (kind classification, durations, recurrence, projects, priority, rule packs) is our own layer on top. If chrono-node gets something wrong for our cases, override it in our layer and add a test; do not fork it.
- Lean code. No speculative features; skip anything costly that does not improve accuracy on the test corpus.

## 2. Input contract

```ts
parse(text: string, ctx: ParseContext): ParseResult

interface ParseContext {
  now: Date;                 // injected, never read from the clock inside the parser
  timeZone: string;          // 'Asia/Jakarta' for Josef; all output is local wall time
  dayStartMin: number;       // from settings, e.g. 07:00 = 420
  dayEndMin: number;         // e.g. 23:00 = 1380
  defaultBlockMin: number;   // 30 (the user's default; learning may adjust per kind)
  tags: { id: string; name: string }[];
  projects: { id: string; name: string; aliases?: string[] }[];
  rules: ParserRule[];       // merged: built-in pack + user pack + learned rules (section 7)
  weekStartsOn: 1;           // Monday
}
```

## 3. Output contract

```ts
type ParseResult = {
  kind: 'fixed' | 'task' | 'note';
  title: string;                       // input with all consumed tokens removed, trimmed, first letter kept as typed
  date?: string;                       // YYYY-MM-DD (fixed: occurrence date; task: due date)
  startMin?: number; endMin?: number;  // fixed events, minutes from local midnight; endMin may exceed 1440 only if it crosses midnight (flag it)
  dueTime?: number;                    // tasks with a time but no end
  estimateMin?: number;                // tasks: "for 2h", "~30m", "90 min"
  recurrence?: { freq: 'daily' | 'weekly'; interval: number; weekdays?: number[]; until?: string };
  projectId?: string; tagId?: string;
  priority?: 1 | 2 | 3;                // !1 highest
  spans: Span[];                       // one per interpreted piece, for chips
  confidence: 'high' | 'medium' | 'low';
  warnings: string[];                  // e.g. 'end before start; assumed next day', 'time already passed; moved to tomorrow'
  alternatives?: Partial<ParseResult>[]; // at most 2, e.g. the "as a task instead" reading
};

type Span = {
  start: number; end: number;          // character offsets in the original text
  text: string;
  role: 'date' | 'time' | 'timeRange' | 'duration' | 'recurrence' | 'kindKeyword' | 'project' | 'tag' | 'priority';
  value: unknown;                      // what it became, e.g. { startMin: 960, endMin: 1080 }
};
```

The title must never contain consumed tokens, and spans must never overlap.

## 4. Classification: fixed, task or note

Apply in this order; the first matching rule wins.

1. **Explicit override.** Prefix `task ` or `-` forces task; prefix `event ` or `@` forces fixed; prefix `note ` or `//` forces note.
2. **Has an end.** A time range (`4pm to 6pm`, `4-6`, `16:00–18:00`, `from 4 till 6`) or a start plus a length (`4pm for 2h`) makes it **fixed**.
3. **Fixed keyword.** A word from the fixed list (built-in pack: class, lesson, lecture, training, practice, session, match, game, meeting, call, appointment, exam, test, service, church, dinner, flight) with a time makes it **fixed**, length from the rule's `defaultDuration` or `defaultBlockMin`.
4. **Task keyword.** A word from the task list (homework, hw, assignment, revise, revision, study, read, write, finish, fix, build, practise paper, essay, project, email, reply) makes it a **task**, even with a time, which becomes `dueTime`.
5. **Time only, no end, no keyword.** It's a **task** with `dueTime`.
6. **Date only.** **Task** due that date.
7. **Nothing parsed.** **Task** with no date (goes to unscheduled), unless the text is long prose (over about 12 words with no verb-like start), in which case **note**.

User rules (section 7) are checked before the built-in lists, so Josef can reclassify any word.

## 5. Date and time grammar it must handle

- **Times:** `5`, `5pm`, `5 pm`, `5p`, `17`, `17:00`, `1700`, `5.30`, `5:30pm`, `noon`, `midday`, `midnight`, `half 5` (British: 5:30), `quarter past 4`.
- **Bare-hour rule:** a bare number 1–6 means PM (13:00–18:00); 7–11 means the next occurrence after `now` within the day window; 12 means noon. Tests must pin this.
- **Ranges:** `4-6`, `4–6pm` (pm applies to both), `10-1` (10:00–13:00), `11pm-1am` (crosses midnight: warn).
- **Relative dates:** today, tonight (start 18:00 if no time), tmr, tmrw, tomorrow, yesterday (reject for new items: warn), `mon`…`sun` and full names (next occurrence; today if that day and the time is still ahead), `next mon` (the Monday of next week), `this fri`, `in 3 days`, `in 2 weeks`, `end of week` (Friday), `weekend` (Saturday).
- **Absolute dates:** `12 nov`, `nov 12`, `12/11` (**day/month**, Josef is in Indonesia), `12/11/2026`, `2026-11-12`.
- **Durations:** `for 2h`, `2 hrs`, `90m`, `90 min`, `1h30`, `1.5h`, `~30m` (estimate marker), `30 mins`.
- **Recurrence:** `every day`, `daily`, `weekdays`, `every mon wed`, `every other fri`, `mon/wed/fri`, `weekly`, `until dec 5`.
- **Past times:** a time already passed today with no date moves to tomorrow for tasks, and is kept but warned for fixed events (the user may be logging).

## 6. Numbers that are NOT times (the most important negative rules)

A number is only a time or date when grammar supports it. These must parse with no time:

- quantities with units or nouns: `buy 4 tires`, `200 m sprint`, `12.4 GWh`, `3 pages`, `5 km`;
- codes and IDs: `AS 9702 paper 2`, `9709`, `room 204`, `ch 5`, `lesson 3`, `v0.3`, `PR #12`;
- scores and ranges that are not clock times: `beat 3-1`, `pages 10-20`;
- years alone: `2026 budget`.

Heuristic: a bare number is a time only when it is (a) after `at`/`@`/`by`/`from`/`till`/`until`, (b) has am/pm/a colon, (c) is part of a range next to a time word, or (d) is the last token(s) after a task or fixed keyword (`math hw 5`). Otherwise it stays in the title.

## 7. Rule packs (grow with the user)

```ts
interface ParserRule {
  id: string;
  match: string;                       // a word or phrase, case-insensitive, whole-word
  aliases?: string[];
  kind?: 'fixed' | 'task' | 'note';
  defaultDurationMin?: number;         // for fixed keywords
  tagId?: string; projectId?: string;  // e.g. "greenmech" sets the project
  source: 'builtin' | 'user' | 'learned';
}

interface ParserPack {                 // import/export file: *.chronos-parser.json
  $schema: 'chronos-parser-pack/1';
  name: string;
  rules: ParserRule[];
}
```

- **Precedence:** user rules beat learned rules, and both beat built-in rules.
- **Learning:** when Josef changes a chip's interpretation (for example "lab" from task to fixed) the same way **twice**, add a `learned` rule. Corrections are stored in synced settings (`parserRules`, which already exists) so every device learns at once. A learned rule that the user later overrides is removed.
- **Export and import:** a pack is a JSON file. Importing validates it (ids unique, kinds valid, no empty matches) and merges by `match`; conflicts ask once which to keep. An AI can write a pack by copying the format.
- Ship the built-in pack as data (`builtin.chronos-parser.json`), not code, so improvements need no code change.

## 8. Live preview and undo (UI contract the parser must support)

- The input re-parses on every keystroke; spans drive highlighted chips in the text and a summary row ("Fixed event · Thu 12 Nov, 16:00 to 18:00 · Coding club").
- **Backspace on a chip** (or clicking its ×) marks that span as literal: re-parse with `ctx.literalRanges` so the parser ignores those characters. Add `literalRanges?: {start,end}[]` to the context for this.
- `Enter` saves the main result; `Shift+Enter` saves the first alternative (usually the opposite kind). Show the alternative's label.
- `confidence: 'low'` shows the summary in a muted style and never auto-saves from a voice or MCP source without confirmation.

## 9. Notepad lines

The notepad uses the same parser line by line on close: a line starting `- `, `[] ` or `task ` becomes a task (the rest of the line is parsed for dates and times), `event ` or `@` becomes a fixed event, everything else stays as the note body. Created task ids go into the note's existing `parsedTaskIds`. No other schema changes.

## 10. Testing (the corpus is the definition of done)

- `tests/parser/corpus.txt`: one case per line, `input → expected`, written by Josef in his own typing style (target 150 to 250 lines), plus a fixed `now` in the file header (for example `2026-11-11T14:22 Asia/Jakarta, Wednesday`). Format:
  `teach coding class 4pm to 6pm → fixed | 2026-11-11 | 16:00-18:00 | title=teach coding class`
- Required categories, at least 10 cases each: fixed with ranges; fixed by keyword; tasks with only a time; tasks with no time; relative days; absolute dates (day/month); durations and estimates; recurrence; projects, tags and priority; overrides; **numbers that are not times**; typos and shorthand (tmrw, 2moro, hw, w/ Ms X); past times; crossing midnight; long prose that should be a note.
- **Every misparse found in real use becomes a new corpus line** before it is fixed.
- Property tests: never throws on random strings up to 500 chars; spans never overlap; title plus span texts reconstruct the input (ignoring whitespace); parsing is pure (same input, same output).
- Benchmark test: 1 000 parses of the corpus under a generous threshold (e.g. 5 s total on CI).
- Pass bar: **100 % of the corpus**. A failing case is either fixed or explicitly moved to `corpus.known-gaps.txt` with a reason, and that file must stay short.

## 11. Exposure to the rest of Chronos

- `src/core/parser/index.ts` exports `parse`, `applyCorrection(result, spanIndex, newValue) → learned rule or null`, `validatePack`, `mergePacks`.
- The Ctrl+K palette, the notepad, and the MCP `add_task` tool (new optional `text` argument) all call the same `parse`. MCP parses with `source: 'claude'` and returns the parse to Claude so it can confirm before saving when confidence is not high.

## 12. Out of scope

Languages other than English (Indonesian may come later as a pack plus grammar; design the keyword lists so a second language is data, not code), voice input, AI fallback parsing, time zones other than the context's, calendar import.

## 13. Living files

Keep `decision.md` (what was decided mid-build) and `log.md` (where the work stands) at the repo root updated as you go, as the repo already does. Tell Josef where to run any command (VS Code terminal, PowerShell, browser).
