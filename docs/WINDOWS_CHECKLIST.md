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
