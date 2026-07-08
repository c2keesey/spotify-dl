# Crate — spotify-dl UI v2 Redesign (shadcn + retro flair)

**Date:** 2026-07-07
**Status:** Approved (user: "I like the general design u had but add a little retro flair… and go" — full auto authorized for this branch)
**Branch:** `dj-ui-shadcn`

## Summary

Replace the single-file vanilla-JS frontend (`spotify_dl/static/index.html`) with a
**React + Vite + TypeScript + Tailwind + shadcn/ui** app named **Crate**, at strict
feature parity, with a distinctive **vintage-instrument-panel** aesthetic: modern
shadcn structure and ergonomics, styled like late-70s/80s hi-fi hardware. The
FastAPI backend and every `/api/*` endpoint are unchanged.

## Design language: "vintage instrument panel"

Dark-first. The reference is a Technics faceplate / vintage VFD deck, executed with
modern restraint — retro is in the *details*, not a costume.

- **Palette (CSS variables via shadcn tokens):** near-black warm charcoal surfaces
  (`#0c0d0b`-family, slightly warm — aged plastic, not blue-black), hairline borders,
  **phosphor green** `#1db954`→`#33e07a` as the single primary accent with a soft LED
  glow (`box-shadow` bloom on active elements), **VFD amber** `#ffb454` as the
  secondary accent (pending/warning states, meter peaks), signal red for
  failures/clashes. Light mode exists via tokens (cream paper + green ink) but dark
  is the designed-for mode.
- **Typography (self-hosted via @fontsource, no runtime CDN):**
  - **Chakra Petch** — display: page titles, section headers, the CRATE wordmark,
    big numerals. Uppercase + letterspacing for panel labels.
  - **IBM Plex Sans** — body/UI text.
  - **IBM Plex Mono** — ALL data: BPM, counts, paths, timestamps, keys. Tabular.
  - No Inter, Roboto, or system-font fallbacks as the visible face.
- **Signature element — the LED meter:** every progress indication (download jobs,
  pending-analysis count strip) renders as a **segmented VU-meter bar**: discrete
  LED blocks that fill green and tip into amber at the top of the range, with a
  brief peak-hold on change. This is the one thing a user remembers.
- **Atmosphere:** a barely-there film-grain noise overlay (CSS, ~3% opacity,
  `pointer-events:none`) and a faint horizontal scanline texture on panel headers
  only. Both must be subtle enough to never impair text contrast (WCAG AA held).
- **Hardware details:** status dots are LED lamps (radial gradient + glow);
  cards have a 1px inner bevel highlight (top edge lighter) like brushed panels;
  buttons press (translate-y 1px + glow dim) on :active; toggles look like power
  switches. Section headers are engraved panel labels (uppercase Chakra Petch,
  letterspaced, dim).
- **Motion:** one orchestrated load — panels power on with a staggered 40ms
  fade/rise and the LED lamps blink once (CSS only). Micro-interactions: meter
  segments animate stepwise, LED glow pulses on running jobs, wheel segments
  brighten on hover. No scroll-jacking, no parallax. `prefers-reduced-motion`
  respected (all decorative motion off).

## Architecture

- New top-level **`frontend/`** — Vite + React 18 + TypeScript + Tailwind +
  shadcn/ui components (generated into `frontend/src/components/ui/`).
  Package manager: **bun** (installed on machine); Node 22 present.
- **Build output → `spotify_dl/static/dist/`** (committed? No — built artifacts are
  gitignored; a `make ui` / `bun run build` step builds them. `web.py` falls back to
  the legacy page if `dist/` is missing, until the final task deletes the legacy
  page and makes dist required, with a clear "run bun run build" 500 message if
  absent).
- **`web.py` change (only backend change):** serve `dist/index.html` at `/` and
  mount `dist/assets`. Nothing under `/api/*` changes.
- **Dev mode:** `vite dev` on :5173 proxying `/api` → `127.0.0.1:8765`.
- **State:** TanStack Query for all server state (`refetchInterval` replaces the
  hand-rolled `setInterval`s: jobs 1.5s, dj status 5s while DJ page visible, crons
  30s). Plain React state for UI. No router library — a two-page shell with local
  state (Download | DJ Sets), matching current behavior.
- **Libraries beyond shadcn:** `@tanstack/react-query`, `dnd-kit` (set reorder),
  `sonner` (toasts), `@fontsource/*` (fonts). Nothing else.
- **File discipline:** `pages/Download/`, `pages/DjSets/`, shared `components/`,
  `lib/api.ts` (typed fetchers mirroring the API contract), `lib/types.ts`
  (TypeScript mirrors of the API records). No file over ~200 lines.

## Screens

### Shell
Left icon rail (Crate wordmark tile, Download, DJ Sets, spacer, theme toggle,
localhost LED badge). Content column per page. Sonner toasts bottom-right for
job/import/export outcomes.

### Download page (parity with current)
- **Paste deck:** textarea card + live link previews (cover art, name, count,
  error rows) via `/api/preview`; Download button shows resolved track total;
  cmd+Enter submits.
- **Output picker:** native picker via `/api/pick-folder`, in-browser fallback
  `Dialog` with `Command`-style filter over `/api/browse`, places + recents chips.
- **Schedule editor:** `Popover` with freq/day/time/every fields → `/api/crons`
  (create + edit-in-place flows preserved, including preserving disabled state).
- **Jobs:** cards with LED status lamp, **segmented VU-meter progress**, current
  track line, failed/unmatched track `Collapsible` (with "no YouTube match" tags),
  Retry button. Same parse semantics from `/api/jobs`.
- **Library:** folder cards (tape-label styling: name strip + mono track count),
  Sync (when source URL known) + Reveal actions.
- **Scheduled:** cron rows with power-switch toggles, edit/delete (armed-confirm)
  — parity with current behavior.

### DJ Sets page (parity + polish)
- **Status strip:** rekordbox LED (green=closed/writable, amber=open/analyzing),
  pending-analysis meter, "Import N new" primary button (disabled with tooltip
  while rekordbox runs; reports "imported X, skipped Y dups" toast).
- **Track browser (left, data-dense):** shadcn `Table` in `ScrollArea`, sticky
  header, search + BPM min/max + Camelot `Select`; Camelot codes as colored
  `Badge`s (same hue math as v1); pending rows ghosted with a soft amber pulse;
  "+ Set" per analyzed row.
- **Set rail (right):** `dnd-kit` sortable slots (numbered, key badge, title/artist,
  mono BPM, remove); **compatibility seams** between slots — a connector line
  colored green/amber/red from `/api/dj/compatibility` with a `Tooltip` naming the
  relation; summary chips (count, BPM range, key spread). Session-level track
  cache so browser filters never drop set members (v1 lesson, keep it).
- **Camelot wheel:** the v1 SVG geometry ported to a React component — same arcs,
  arrows, click-to-filter. Phosphor treatment: active segments glow slightly.
- **Energy curve → oscilloscope:** the v1 curve as a React component restyled as a
  scope: dark grid background, phosphor-green trace with glow, amber dashed BPM
  trace, mono axis labels. Same `/api/dj/energy` flow + session cache + null
  handling; a render-generation token fixes the v1 stale-paint follow-up (sdl-697)
  as part of the port.
- **Save set:** `Dialog` (name input, track recap list, note that name collisions
  uniquify) → `/api/dj/export`; 409 renders the "close rekordbox first" state
  inline in the dialog.

## Error handling

- DB unreachable → designed empty state (LED off, "can't read the rekordbox
  database" + retry), not a toast loop.
- rekordbox running → write actions disabled with tooltip + amber LED; never a
  silent failure. 409 detail strings surface verbatim.
- TanStack Query: retries reads (2, backoff), never retries writes (mutations).
- All fetchers in `lib/api.ts` narrow errors to typed results; no raw exceptions
  reach components.

## Testing

- **Vitest + Testing Library** in `frontend/`: camelot color math, meter
  segmentation, seam-rendering from ratings, set-state reducer (add/remove/reorder
  + cache), api-client parsing (mocked fetch). Target: the logic, not snapshots.
- **Existing pytest suite** guards the backend contract (unchanged).
- **Final live E2E** (same ritual as Phase 1): build, serve via FastAPI, Chrome
  eyes-on both pages, real import/export with rekordbox closed via the new UI.
- `bun run build` must succeed as a task gate from Task 1 onward.

## Out of scope

- No new features beyond parity + the sdl-697 render-token fix absorbed by the port.
- No router, no auth, no i18n, no SSR.
- Other Phase-1 follow-ups (sdl-dig, sdl-i1j, sdl-jzw) stay backend follow-ups —
  not part of this redesign.
- The legacy `index.html` is deleted in the final task (no long-term dual UI).
