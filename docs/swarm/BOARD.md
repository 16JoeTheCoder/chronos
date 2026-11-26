# Phase 4 board

One card per line. Statuses: Todo · Doing · Review · Done · Blocked.
Format: `- [Status] #id role: title — owner files — notes/link`

Integration branch: `claude/gallant-euler-xrzpkf` (the session's branch rule; the prompt said `phase-4-web`). Role branches `p4/<role>` merge into it.

## Requests between roles
Format: `- [Open|Answered] #id from→to: request — answer`
- [Answered] #r1 bridge-web→lead: parseCommand without Electron — split into src/main/parseCommand.ts (D-189)
- [Answered] #r2 all→lead: api.ts comment mentions window.chronos — reworded
- [Answered] #r3 mobile,renderer→lead: CSS budget — 36 KB gz (D-191)
- [Answered] #r4 renderer→mobile/lead: use lazy screens in Home.tsx — wired (Settings, Schedule, Planning cards; Runway stays eager: it is Home's first paint)
- [Answered] #r5 renderer→lead: top bar copy without Ask on web — done; ⌘K on Apple
- [Answered] #r6 log→lead: Help keys for Write — done
- [Answered] #r7 renderer→bridge-web: no sign-in flash while auth restores — already: known uid reports 'syncing' until auth is ready
- [Answered] #r8 web-infra→lead: ignore dist-web/.wrangler — done
- [Answered] #r9 lead: hidden tab paused the timer — Controller.tick(now, alive) (D-190)

## Decisions (mirrored in decision.md D-184..)
- Bridge = `ChronosApi` (preload) + `platform`, `can`, `web`, `links`, `openLink` (`src/platform/types.ts`, frozen).
- The web bridge runs the existing platform-neutral `Controller` (`src/main/controller.ts`, now `ControllerStore`-based, no `fs`) over an IndexedDB-hydrated memory store. Same commands, same sync engine, same Firestore provider.
- Desktop bundle never imports web code: `src/web/entry.ts` installs the web bridge, then imports the renderer.
- Drafts: `Idea.draft?`/`publishedAt?` (absent = published), no schema bump (D-184). `rambles` reserved in types/validation/rules, not in COLLS (D-185).
- Electron release + updater already existed (Josef, after 3.7): release on every push to `main`, updater 30 s after start and every 4 h. Kept (repo is the truth); release workflow also runs on `v*` tags.

## Cards
- [Done] #1 lead: freeze ChronosBridge interface — src/platform/types.ts, index.ts, electron.ts
- [Done] #2 bridge-web: IndexedDB outbox + cache — src/platform/web/**
- [Done] #3 bridge-web: Firestore delta listeners + leader tab — src/platform/web/**
- [Done] #4 lead (was bridge-electron): adapter over preload — src/platform/electron.ts
- [Done] #5 lead (was bridge-electron): release workflow on tags — .github/workflows/build-windows.yml
- [Done] #6 web-infra: wrangler static assets + /api/health + token verify helper — worker/**, wrangler.jsonc
- [Done] #7 web-infra: PWA manifest + service worker — public/manifest.webmanifest, src/sw.ts
- [Done] #8 renderer-port: capability gating, sign-in screen — src/renderer/**
- [Done] #9 renderer-port: install-desktop button — src/renderer/settings/**
- [Done] #10 mobile-layout: phone shell (top bar, tab bar, running pill, sheets) — src/renderer/shell/**
- [Done] #11 log: Read view — src/renderer/log/**
- [Done] #12 log: Write view + drafts — src/renderer/log/**
- [Doing] #13 qa: viewport screenshots + overflow/touch-target script — tests/e2e/**
- [Doing] #14 qa: two-context sync tests — tests/web/**
- [Doing] #15 qa: critique (desktop + 390 px) — docs/BUILD_REPORT.md
- [Done] #16 web-infra: SETUP.md for Firebase + Cloudflare agent — SETUP.md
- [Todo] #17 lead: final review + deployment handoff message
