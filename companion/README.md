# Flightcase

The offline companion PWA for [Crate](../). A DJ AirDrops a `.crate` bundle
(byte-identical audio + precomputed waveform peaks + a manifest) onto an iPad or
iPhone, places hot cues and loops on the plane, and exports a tiny `cues.json`.
Back on the ground, Crate's backend turns that JSON into a rekordbox XML the DJ
imports by hand as a **new** playlist.

This is a **standalone** Vite + React app with its own `package.json`. It shares
nothing with `frontend/` at build time — the shadcn components, the Crate theme,
and `cn()` are copied in so the app deploys on its own to any static host.

## Build

Uses [bun](https://bun.sh).

```bash
cd companion
bun install
bun run build      # tsc -b && vite build → dist/
bun run test       # vitest run
bun run dev        # local dev server
bun run preview    # serve the production build locally
```

## Deploy

The build produces a fully static `dist/` — drop it on any HTTPS host.

**Cloudflare Pages:** build command `bun run build`, output directory
`companion/dist`.

HTTPS is required **only at install time** so the service worker can register.
Once the shell (JS, CSS, fonts, icons) is precached, the app makes **no network
requests** — audio arrives only over AirDrop, and cues live in IndexedDB. It
runs fully offline in airplane mode after the first visit.
