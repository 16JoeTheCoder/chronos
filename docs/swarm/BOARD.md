# Phase 4 board

One card per line. Statuses: Todo · Doing · Review · Done · Blocked.
Format: `- [Status] #id role: title — owner files — notes/link`

Integration branch: `claude/gallant-euler-xrzpkf` (the session's branch rule; the prompt said `phase-4-web`). Role branches `p4/<role>` merge into it.

## Requests between roles
Format: `- [Open|Answered] #id from→to: request — answer`

## Decisions (mirrored in decision.md D-184..)
- Bridge = `ChronosApi` (preload) + `platform`, `can`, `web`, `links`, `openLink` (`src/platform/types.ts`, frozen).
- The web bridge runs the existing platform-neutral `Controller` (`src/main/controller.ts`, now `ControllerStore`-based, no `fs`) over an IndexedDB-hydrated memory store. Same commands, same sync engine, same Firestore provider.
- Desktop bundle never imports web code: `src/web/entry.ts` installs the web bridge, then imports the renderer.
- Drafts: `Idea.draft?`/`publishedAt?` (absent = published), no schema bump (D-184). `rambles` reserved in types/validation/rules, not in COLLS (D-185).
- Electron release + updater already existed (Josef, after 3.7): release on every push to `main`, updater 30 s after start and every 4 h. Kept (repo is the truth); release workflow also runs on `v*` tags.

## Cards
- [Done] #1 lead: freeze ChronosBridge interface — src/platform/types.ts, index.ts, electron.ts
- [Doing] #2 bridge-web: IndexedDB outbox + cache — src/platform/web/**
- [Doing] #3 bridge-web: Firestore delta listeners + leader tab — src/platform/web/**
- [Done] #4 lead (was bridge-electron): adapter over preload — src/platform/electron.ts
- [Doing] #5 lead (was bridge-electron): release workflow on tags — .github/workflows/build-windows.yml
- [Doing] #6 web-infra: wrangler static assets + /api/health + token verify helper — worker/**, wrangler.jsonc
- [Doing] #7 web-infra: PWA manifest + service worker — public/manifest.webmanifest, src/sw.ts
- [Doing] #8 renderer-port: capability gating, sign-in screen — src/renderer/**
- [Doing] #9 renderer-port: install-desktop button — src/renderer/settings/**
- [Doing] #10 mobile-layout: phone shell (top bar, tab bar, running pill, sheets) — src/renderer/shell/**
- [Doing] #11 log: Read view — src/renderer/log/**
- [Doing] #12 log: Write view + drafts — src/renderer/log/**
- [Todo] #13 qa: viewport screenshots + overflow/touch-target script — tests/e2e/**
- [Todo] #14 qa: two-context sync tests — tests/web/**
- [Todo] #15 qa: critique (desktop + 390 px) — docs/BUILD_REPORT.md
- [Doing] #16 web-infra: SETUP.md for Firebase + Cloudflare agent — SETUP.md
- [Todo] #17 lead: final review + deployment handoff message
