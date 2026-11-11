# Windows checklist

Everything here is `UNVERIFIED-ON-WINDOWS`: Chronos was built and tested on Linux. Each step says where to do it.

1. **Free the taskbar's left slot.** Windows Settings app → Personalization → Taskbar: turn **Widgets** off.
2. **Install.** Browser → GitHub → 16JoeTheCoder/chronos → Actions → latest "Build Windows" run → download the `Chronos-windows` artifact; run `Chronos-Setup-1.0.0.exe`. SmartScreen: **More info → Run anyway** (the build is unsigned).
3. **First run, in Chronos:** onboarding (time zone, day window), then **Add timetable** and enter your week in the schedule editor.
4. **Startup speed.** Sign out and in with your PIN. In Chronos → Settings → About → **Copy diagnostics**, read the startup marks (`app.ready`, `home.shown`, `renderer.launch.script`, `renderer.hydrated`). Optionally, in Windows PowerShell (normal): `powershell -ExecutionPolicy Bypass -File scripts\windows\fast-startup.ps1 -Mode Registry`, then sign out/in and compare. `-Mode Task` may need PowerShell **as Administrator**; `-Undo` reverts either.
5. **Widget.** It sits in the taskbar's left slot and stays above the taskbar after opening the Start menu and other apps. Left click toggles Home (Focus if a task is active); right-click shows Start/Pause, Show Chronos, Quit. Settings → Appearance → Taskbar widget → Free: drag it, restart, it stays put.
6. **Home.** Covers the work area on launch (taskbar still visible); Enter reveals the runway; Esc hides; **Alt+Tab** and **Win+D** still work while it is showing.
7. **DPI.** Windows Settings → System → Display → Scale 125 % and 150 %: Home still fits the work area, the widget does not drift or grow while dragged.
8. **Drag and drop**, in Chronos: card → Plan lane (blue ghost = fits, red = overlap); drag a block to move; drag its edges to resize; drag a block, an event and a card onto Trash (Undo toast). Then every keyboard path: S on a card, arrows / Shift / Alt+arrows on a block, Delete, F, N, Esc.
9. **Shelf.** With a OneDrive-redirected Desktop: the Desktop button lists your real Desktop; double-check nothing moved. Drag a scratch file onto Trash → confirm → it is in the Windows **Recycle Bin**.
10. **Sleep and crashes.** Start a timer, sleep the PC for a minute, wake: the gap prompt appears (try both answers). Start a timer, kill Chronos in **Task Manager**, wait 30 s, relaunch: the gap prompt.
11. **Notifications, sound and shortcuts.** Block end, Pomodoro boundary, sprint checkpoint and a prep nudge show Windows notifications (and a short beep with Sound on). Try **Ctrl+Alt+Space**, **Ctrl+Alt+P**, **Ctrl+Alt+N**; then set one to a combination another app owns and check Settings → General shows the error.
12. **Second monitor.** Settings → General → Display: enter the other display's id (from Copy diagnostics); Home covers only that display.

## Phase 1 (sync, Claude, visible fixes)

Do `docs/SETUP_FIREBASE.md` first. "Desktop" and "laptop" are your two PCs, both on the new build and signed in with the same Google account.

13. **Two-PC sync.** On the desktop, in Chronos: add a task. On the laptop it appears in **3 s or less** (count it). Edit its title on the laptop; it changes on the desktop. Recycle it on the desktop; it disappears on the laptop.
14. **Sleep and catch-up.** Put the laptop to sleep (Start → Power → Sleep). On the desktop add two tasks and move a block. Wake the laptop and unlock: both tasks and the moved block appear within a few seconds, with no prompt.
15. **Wi-Fi pulled mid-edit.** On the laptop, turn Wi-Fi off (Windows quick settings). Edit three tasks. After ~10 s the sync dot turns amber; click it: one line + Retry. Turn Wi-Fi back on: the dot disappears and the desktop shows the edits. Then edit the **same** task title on both PCs while the laptop is offline, reconnect: both show the later flush's title, and (Settings → Advanced → Experimental on) Diagnostics → Conflict log shows one entry.
16. **Crash safety.** On the laptop, edit a task and within a second kill Chronos in **Task Manager**. Relaunch: the edit is there and reaches the desktop.
17. **Sign out / in.** Settings → Sync → Sign out: data stays, the dot disappears. Sign in again: no duplicates, edits made while signed out sync. Restart Chronos: it signs in silently (no browser).
18. **Read-only gate** (only when a newer Chronos exists): an older install shows a red dot "Update Chronos on this device." and pushes nothing.
19. **Claude Desktop (MCP).** Settings → Integrations: turn on Claude, **Copy Claude Desktop config**, paste into `%APPDATA%\Claude\claude_desktop_config.json` (VS Code), restart Claude Desktop. In Claude Desktop ask: "What's on my day in Chronos?" (answer matches the runway, times in your zone); "Add a task 'Buy printer ink' due tomorrow" (it appears in Chronos with an Undo toast); press **Undo** in Chronos (it goes away). Quit Chronos and ask again: Claude reports "Chronos is not running. Open Chronos and try again." Check that `ELECTRON_RUN_AS_NODE` works with the installed build (if Claude reports the server failed to start, note the error from Claude Desktop → Settings → Developer → logs).
20. **Hold to complete.** In Focus, hold **Enter** on the Finish button: the ring fills over 2 s and the task completes with a short pulse; release early at ~1 s: the ring drains and nothing happens. Press-and-hold with the mouse: same. **Space** starts/pauses and never completes. With Windows Settings → Accessibility → Visual effects → Animation effects off: a 2, 1 countdown instead of the ring.
21. **Now-line.** Watch the runway across a minute boundary: the label (e.g. "12:22") flips to "12:23" within a second of the Windows clock, in Full day and Next 6 h.
22. **Buffer and per-day edits.** The end of the day shows a hatched "Buffer 30m" block; hovering (or focusing) time-left shows the breakdown. Right-click a repeating event (or focus it and press the Menu key / Shift+F10): **Skip today** removes it at once with Undo; **Edit just today…** changes title/time for today only (next week unchanged); **Edit every week…** opens the schedule editor.
23. **Snapshots.** After a day of use, `%APPDATA%\Chronos\snapshots\` has `chronos-<date>.json`; Diagnostics → Restore one (confirm), and the restore reaches the other PC.
