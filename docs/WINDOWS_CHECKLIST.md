# Windows checklist

Everything here is `UNVERIFIED-ON-WINDOWS`: Chronos was built and tested on Linux. Each step says where to do it.

1. ~~Free the taskbar's left slot.~~ Removed in Phase 2+3: the taskbar widget is gone, replaced by the overlay (item 27). Number kept so references stay valid.
2. **Install.** Browser → GitHub → 16JoeTheCoder/chronos → Actions → latest "Build Windows" run → download the `Chronos-windows` artifact; run `Chronos-Setup-1.0.0.exe`. SmartScreen: **More info → Run anyway** (the build is unsigned).
3. **First run, in Chronos:** onboarding (time zone, day window), then **Add timetable** and enter your week in the schedule editor.
4. **Startup speed.** Sign out and in with your PIN. In Chronos → Settings → About → **Copy diagnostics**, read the startup marks (`app.ready`, `home.shown`, `renderer.launch.script`, `renderer.hydrated`). Optionally, in Windows PowerShell (normal): `powershell -ExecutionPolicy Bypass -File scripts\windows\fast-startup.ps1 -Mode Registry`, then sign out/in and compare. `-Mode Task` may need PowerShell **as Administrator**; `-Undo` reverts either.
5. ~~Widget.~~ Removed in Phase 2+3 (see 27).
6. **Home.** Covers the work area on launch (taskbar still visible); Enter reveals the runway; Esc hides; **Alt+Tab** and **Win+D** still work while it is showing.
7. **DPI.** Windows Settings → System → Display → Scale 125 % and 150 %: Home still fits the work area and the overlay pill (27) keeps its place and size.
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

## Checkpoint B (desktop layer, overlay, notepad, palette)

All `UNVERIFIED-ON-WINDOWS`. Install the new build first (as step 2 above).

24. **Desktop layer (shipped off).** In Chronos → Settings → Look and widgets → Desktop and layout, turn on **Live on the desktop (experimental, off by default)**. Press Esc on Home. Pass: Home stays visible *behind* the desktop icons; **Win+D** shows Chronos with your wallpaper gone; mouse move and clicks work on empty desktop; Ctrl+Alt+Space brings the normal window back (top-level, keyboard works) and Esc returns it to the desktop. Open `%APPDATA%\Chronos\logs\chronos.log`: `desktop layer on (classic)` or `(progman-child)`. Note which one, and your Windows build (`winver`); 24H2 should say `progman-child`.
25. **Desktop layer fallback.** Turn the same switch on and, in Task Manager, End task on **Windows Explorer** before pressing Esc on Home: Chronos must hide as before (no black screen, no crash) and the log shows `desktop layer off: ...`. Restart Explorer (Task Manager → Run new task → `explorer.exe`).
26. **Desktop layer, Explorer restart while attached.** With the layer on (Settings switch as in 24), restart Explorer: expect Chronos to vanish or crash (known, D-144); restart Chronos and confirm it comes back. Report what you see.
27. **Overlay.** Start a timer: a pill appears bottom-left with the mini timer, task title and time. Open Chrome or Canva and type: the overlay stays on top and your typing is never interrupted (no focus change, no flicker in the title bar). Hover the pill: it grows with Hold to finish; hold the mouse button 2 s on it: the task finishes; release at 1 s: nothing. Click the title: Chronos opens. Pause and finish the task: the pill disappears.
28. **Overlay and full-screen.** Play a YouTube video in Chrome full-screen (F11): the pill hides; leave full-screen: it returns within 5 s. In Chronos → Settings → Focus → Overlay turn **Hide the overlay in full-screen apps** off, repeat: it stays visible.
29. **Notepad.** In Chrome press **Ctrl+Alt+N**: a notepad opens top-right on the focused task's notes (or "Notes" with nothing in focus). Type two lines, one starting `- send the datasheet tomorrow 30m`. Esc: the window closes, Chrome has the keyboard back (type in a page field to check, the cursor is where you left it), and the overlay shows "Added 1 item from your notes" with **Undo**. Undo: the task disappears. Reopen the notepad: the line now starts `[x] `.
30. **Palette.** In Chronos press **Ctrl+K** . Anywhere press **Ctrl+Alt+K**: type `padel thu 4pm to 6pm`: chips show Fixed event, date, time; Enter adds it; Shift+Enter would add a task. Type `essay` to see search hits. Type `>`: Auto-plan today, Re-plan, Report misparse. Run Auto-plan: an Undo toast appears (overlay or Home); Undo restores the day. Tab on typed text: the text is on the clipboard and Claude Desktop opens (or claude.ai/new).
31. **Shortcuts conflict.** If Ctrl+Alt+K is taken by another app, Settings → Focus → Shortcuts shows the registration error. The Notepad shortcut (default Ctrl+Alt+N) is edited there too.
32. **Win+D then keyboard.** With the layer on, press Win+D, then Ctrl+Alt+K: the palette opens over the desktop and Esc closes it.

## Phase 2+3 (themes, Log, planning, windows)

All `UNVERIFIED-ON-WINDOWS`. Install the new build first (item 2). Where a step says "Chronos", it is the app; "PowerShell" is Windows PowerShell; "browser" is Chrome or Edge.

33. **Win+D shows Chronos.** Settings → Look and widgets → Desktop and layout: turn **Live on the desktop** on, Esc on Home, then press **Win+D** in any app: Chronos is visible behind the icons. Turn it off again and repeat: the normal window does not appear on Win+D (expected).
34. **Fallback when WorkerW fails.** With the switch on, Task Manager → End task on **Windows Explorer**, then Esc on Home: Chronos hides as before, no black screen, and `%APPDATA%\Chronos\logs\chronos.log` says `desktop layer off`. Restart Explorer (Task Manager → Run new task → `explorer.exe`). Open the log in VS Code.
35. **Overlay over Chrome and Canva without stealing focus.** Start a timer, open Chrome, then Canva in the browser, and type in a text field: the pill stays on top, the caret never leaves your field, and the title bar of the browser never turns inactive.
36. **Notepad returns focus on Esc.** In Chrome click into a page field, press **Ctrl+Alt+N**, type, press Esc: the caret is back in the same Chrome field and typing continues there.
37. **Space and hold-Enter on Focus without clicking.** Open Chronos, press **F**, then **Space** (starts), **Space** (pauses); hold **Enter** for 2 s (finishes, the ring fills), and release at 1 s on another task (drains, nothing happens). Do not click anything first.
38. **Theme switches at the scheduled minute.** Settings → Look and widgets → Theme schedule: set Tactile for the current time and Stark starting two minutes from now. Leave Chronos open: it changes at that minute, without a flash or restart. Windows quick settings → Night light does not affect it.
39. **Sound plays and mutes.** Settings → Look and widgets → Sound: turn it on, press **Block start** and **Block finish** (you hear both at the set volume). Turn **Mute while a task is in focus** on, start a task: no cue. Windows volume mixer shows Chronos and its slider mutes it.
40. **A post on PC A shows on PC B within about 2 s.** On both PCs, in Chronos, press **Ctrl+L**. On PC A write a post and press Enter; count to 2: it is on PC B. Edit it on PC B (Edit, change text, wait 1 s): PC A shows the new text and "edited".
41. **Experimental desktop switch label.** Settings → Look and widgets: the switch reads "(experimental, off by default)". Settings → Focus → Overlay has the full-screen switch (on by default).
42. **High DPI and two monitors for the new windows.** At 125 % and 150 %: the notepad and palette sit top-right and 20 % down, fully on screen; the overlay stays bottom-left. Drag Chronos to the second monitor with Win+Shift+Arrow and press Ctrl+Alt+K there: the palette opens on the display under the cursor.
