# Claude (MCP) integration

Ask Claude Desktop about your day and let it change Chronos data, safely. Claude talks to the running app on your own PC only; nothing leaves the machine except what sync already sends.

```
Claude Desktop --stdio--> chronos-mcp.js (bridge) --HTTP 127.0.0.1:<port>, Bearer token--> Chronos main
                                                                                          |
                                                              core/mcp handlers --> controller.command() --> store + outbox --> sync
```

- **Handlers** (`src/core/mcp/`): tool schemas (`tools.ts`) and handlers (`handlers.ts`) over a narrow `StorePort` (read data, run a command). No Node or Electron APIs (the audit checks), so a Phase 4 remote server can reuse them with a Firestore-backed port.
- **Local endpoint** (`src/main/mcp/server.ts`): HTTP on `127.0.0.1` only, a random free port and a random bearer token, both stored in `%APPDATA%\Chronos\device.json` (`mcp.port`, `mcp.token`). Non-loopback connections and wrong tokens are refused.
- **Bridge** (`src/bridge/`, built to `dist/chronos-mcp.js`, shipped as `resources\chronos-mcp.js` next to the app): the stdio MCP server Claude Desktop launches (`@modelcontextprotocol/sdk`). It always lists the tools; each call reads port and token from `device.json` and forwards it. If Chronos is not running every tool answers "Chronos is not running. Open Chronos and try again."

## Turn it on

1. **Chronos** → Settings → **Integrations** → turn on **Claude (MCP)**.
2. Click **Copy Claude Desktop config**. It copies a snippet like this, with the real paths of your install:

```json
{
  "mcpServers": {
    "chronos": {
      "command": "C:\\Users\\you\\AppData\\Local\\Programs\\Chronos\\Chronos.exe",
      "args": ["C:\\Users\\you\\AppData\\Local\\Programs\\Chronos\\resources\\chronos-mcp.js"],
      "env": { "ELECTRON_RUN_AS_NODE": "1" }
    }
  }
}
```

It runs the bridge with Chronos's own Electron as Node (`ELECTRON_RUN_AS_NODE=1`), so Node does not need to be installed.

3. **Claude Desktop config file** — open it in **VS Code** (or Notepad): `%APPDATA%\Claude\claude_desktop_config.json` (in Claude Desktop: Settings → Developer → **Edit Config** opens it). Merge the `chronos` entry into its `mcpServers` object (create the object if the file is empty: `{ "mcpServers": { … } }`). Save.
4. **Restart Claude Desktop** (quit from the tray, open again). The tools appear under the tools/plug icon.

Regenerating the token (Diagnostics → MCP) takes effect at once; the bridge reads the token on every call, so the config does not change. If Chronos moves (reinstall to another folder), copy the config again.

## Tools

Times are local wall time; every read states the time zone. Writes return the changed record and an `undoToken`.

| Read | What it returns |
| --- | --- |
| `get_day(date?)` | fixed events after skips/edits, blocks, free gaps, the buffer, time left, prep nudges, the task in focus |
| `get_week(startDate?)` | seven compact days |
| `list_tasks({status?, projectId?, tag?, dueBefore?, dueAfter?, overdue?, unscheduled?, limit?})` | matching tasks, most urgent first |
| `get_task(id)` | the task with its blocks, tracked time and recurrence |
| `search(query, {types?, limit?})` | fuzzy/prefix hits over tasks, notes, projects, events |
| `list_projects()`, `get_project(id)` | projects; columns with ordered cards |
| `list_events({from?, to?})` | the schedule (max 31 days) |
| `get_stats({from, to})` | focus hours per tag/project, estimate vs actual, finished/dropped counts |
| `get_review(date)`, `list_notes({limit?})` | the day's review; notes |
| `search_log({query})` | fuzzy/prefix search over Log posts (notes) only, with their project |
| `list_unplaced({date?})` | fixed events that have a date and a length but no time yet ("to place"). With `date`: that day; without: every unplaced event from today on. `get_day` also lists the day's under `unplaced` |

| Write | What it does |
| --- | --- |
| `add_task({title, kind?, projectId?, tag?, estimateMin?, dueDate?, dueTime?, priority?, recurrence?, finishCondition?})` | a new inbox task, `source: 'claude'` (structured fields only for now; a parser-backed `text` argument is planned, D-130) |
| `update_task(id, patch)`, `complete_task(id)`, `drop_task(id, reason)` | edit; complete (a recurring task spawns its next instance); close as dropped |
| `place_block({taskId, date, startMin, endMin})`, `move_block(id, {…})`, `remove_block(id)` | plan time; refused with the reason ("overlaps the fixed event Physics 13:00-14:30") on overlap |
| `skip_event_on(eventId, date)`, `edit_event_on(eventId, date, patch)` | change one date of a repeating event |
| `post_log({body, projectId?})` | post to the Log feed (a note), optionally under a project |
| `place_event({eventId, startMin})` | give an unplaced event its time; it keeps its length. Refused, with the reason, if it overlaps a fixed event or a planned block, runs past midnight, or the event already has a time |
| `add_note(body)`, `add_project({name, color?, columns?})`, `move_card(taskId, columnId, beforeTaskId?)` | notes, projects, board order |
| `undo(undoToken)` | reverts exactly the fields that write changed (a created record is recycled) |

## Safety

- Every write goes through the same core commands as the UI: validation, the outbox, sync. Each one is logged in activity as `claude`, and Chronos shows a toast with **Undo**.
- Planning (auto-plan, re-plan, review) is not exposed to Claude: it changes many records at once and is the user's call.
- No hard deletes (removals are recycles, restorable from Recently deleted), no settings changes, no file access outside Chronos data.
- At most 30 writes per minute (a runaway loop is refused with a clear message).
- Inputs are checked strictly against each tool's schema (unknown fields, wrong types and missing fields are refused).
- The token in `device.json` is readable by programs running as you, like the data file itself; the endpoint only listens on loopback.
