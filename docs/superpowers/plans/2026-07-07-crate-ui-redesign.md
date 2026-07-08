# Crate UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-file vanilla-JS frontend with **Crate** — a React + Vite + TS + Tailwind + shadcn/ui app at strict feature parity, styled as a vintage instrument panel (phosphor-green LEDs, VU meters, VFD amber, Chakra Petch / IBM Plex type).

**Architecture:** New `frontend/` app builds to `spotify_dl/static/dist/`, served by FastAPI (only backend change: static mounting). TanStack Query owns all server state against the UNCHANGED `/api/*` contract. Two-page shell (Download | DJ Sets), no router. The v1 Camelot-wheel and energy-curve math ports into React components.

**Tech Stack:** bun, Vite 6, React 18, TypeScript, Tailwind 3, shadcn/ui, @tanstack/react-query, @dnd-kit/core+sortable, sonner, @fontsource (chakra-petch, ibm-plex-sans, ibm-plex-mono), Vitest + Testing Library.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-07-crate-ui-redesign-design.md`. Read it before starting any task.
- **Zero `/api/*` changes.** The backend contract is fixed; `spotify_dl/web.py` may only gain static-serving code.
- **Strict feature parity** with `spotify_dl/static/index.html` (the legacy page — read it when implementing a page; it is the behavioral reference).
- **Aesthetic is binding:** dark-first vintage-instrument-panel per spec. Fonts: Chakra Petch (display), IBM Plex Sans (body), IBM Plex Mono (all data). NO Inter/Roboto/system-font as the visible face. Accents: phosphor green `--led` (primary/success), VFD amber (pending/warning), signal red (failure/clash). Segmented VU meters for all progress. Subtle grain+scanline atmosphere; WCAG AA contrast held; `prefers-reduced-motion` respected.
- Package manager: **bun** (`bun install`, `bun run build`, `bun run test`). Frontend commands run from `frontend/`.
- `bun run build` must output to `spotify_dl/static/dist/` and succeed at the end of every frontend task ("build gate").
- Frontend tests: Vitest (`bun run test`). Backend: `uv run pytest` (known pre-existing failures: `test_progress_names_failed_track` + live-API 403s/genre drift — not ours; add no new failures).
- TanStack Query: reads may retry (default), **mutations never retry**. Poll intervals: jobs 1.5s, dj status 5s (only while DJ page mounted), crons 30s.
- No new libraries beyond: @tanstack/react-query, @dnd-kit/core, @dnd-kit/sortable, sonner, @fontsource packages, and shadcn's own deps (radix, cva, clsx, tailwind-merge, lucide-react).
- Files ≤ ~200 lines; split by responsibility.
- Commit after every task (`feat:`/`fix:`/`chore:`). Branch: `dj-ui-shadcn`.
- Implementers have creative latitude on visual polish WITHIN the aesthetic tokens/spec; behavior and contracts in this plan are exact.

---

### Task 1: Scaffold `frontend/` + theme tokens + fonts + build wiring

**Files:**
- Create: `frontend/` (Vite React-TS scaffold), `frontend/package.json`, `frontend/vite.config.ts`, `frontend/tailwind.config.ts`, `frontend/tsconfig.json` (+app/node variants from scaffold), `frontend/components.json`, `frontend/src/index.css`, `frontend/src/main.tsx`, `frontend/src/App.tsx` (placeholder), `frontend/src/lib/utils.ts`, `frontend/vitest.config.ts`, `frontend/src/test/setup.ts`
- Modify: `.gitignore` (add `spotify_dl/static/dist/`, `frontend/node_modules/`)
- Test: build gate + a trivial vitest smoke test

**Interfaces:**
- Produces: the app skeleton every later task builds in; CSS custom properties (design tokens) all components use; `cn()` util; `bun run build|dev|test` scripts.

- [ ] **Step 1: Scaffold**

```bash
cd /Users/c2k/Projects/spotify-dl
bun x create-vite@latest frontend --template react-ts
cd frontend
bun install
bun add @tanstack/react-query @dnd-kit/core @dnd-kit/sortable sonner
bun add @fontsource/chakra-petch @fontsource/ibm-plex-sans @fontsource/ibm-plex-mono
bun add -d tailwindcss@^3 postcss autoprefixer vitest @testing-library/react @testing-library/jest-dom jsdom @types/node
bun x tailwindcss init -p --ts
```

- [ ] **Step 2: shadcn init**

```bash
bun x shadcn@latest init -d   # defaults; base color will be overridden by our tokens
bun x shadcn@latest add button card input textarea select dialog popover table badge tooltip collapsible scroll-area switch separator command
```

If `shadcn init` prompts interactively despite `-d`, create `frontend/components.json` manually:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": false,
  "tsx": true,
  "tailwind": { "config": "tailwind.config.ts", "css": "src/index.css", "baseColor": "zinc", "cssVariables": true, "prefix": "" },
  "aliases": { "components": "@/components", "utils": "@/lib/utils" }
}
```

and re-run the `add` command. Path alias `@` must resolve: add to `tsconfig.json` `compilerOptions`: `"baseUrl": ".", "paths": {"@/*": ["./src/*"]}` and to vite config (Step 3).

- [ ] **Step 3: Vite config — build into the backend's static dir**

```ts
// frontend/vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  build: {
    outDir: path.resolve(__dirname, "../spotify_dl/static/dist"),
    emptyOutDir: true,
  },
  server: { proxy: { "/api": "http://127.0.0.1:8765" } },
});
```

- [ ] **Step 4: Theme tokens + atmosphere (`src/index.css`)** — replace the scaffold CSS entirely:

```css
@import "@fontsource/chakra-petch/500.css";
@import "@fontsource/chakra-petch/600.css";
@import "@fontsource/ibm-plex-sans/400.css";
@import "@fontsource/ibm-plex-sans/500.css";
@import "@fontsource/ibm-plex-mono/400.css";
@import "@fontsource/ibm-plex-mono/500.css";
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    /* vintage instrument panel — dark is the designed-for mode */
    --background: 80 6% 5%;          /* warm near-black, aged plastic */
    --foreground: 75 8% 90%;
    --card: 75 5% 8%;
    --card-foreground: 75 8% 90%;
    --popover: 75 5% 7%;
    --popover-foreground: 75 8% 90%;
    --primary: 145 70% 45%;          /* phosphor green */
    --primary-foreground: 150 60% 6%;
    --secondary: 75 5% 13%;
    --secondary-foreground: 75 8% 85%;
    --muted: 75 5% 12%;
    --muted-foreground: 70 6% 55%;
    --accent: 75 5% 14%;
    --accent-foreground: 75 8% 90%;
    --destructive: 0 72% 55%;
    --destructive-foreground: 0 0% 98%;
    --border: 75 6% 16%;
    --input: 75 6% 16%;
    --ring: 145 70% 45%;
    --radius: 0.625rem;
    /* crate-specific */
    --led: 145 85% 55%;              /* lit phosphor */
    --vfd: 35 100% 66%;              /* VFD amber */
    --signal-red: 0 85% 62%;
    --panel-bevel: 75 10% 22%;
  }
  .light {
    --background: 48 25% 94%;        /* cream paper */
    --foreground: 80 10% 12%;
    --card: 48 20% 98%;
    --card-foreground: 80 10% 12%;
    --popover: 48 20% 98%;
    --popover-foreground: 80 10% 12%;
    --primary: 150 65% 32%;          /* green ink */
    --primary-foreground: 48 25% 96%;
    --secondary: 48 15% 88%;
    --secondary-foreground: 80 10% 18%;
    --muted: 48 15% 88%;
    --muted-foreground: 75 8% 40%;
    --accent: 48 15% 86%;
    --accent-foreground: 80 10% 12%;
    --destructive: 0 65% 45%;
    --destructive-foreground: 0 0% 98%;
    --border: 60 10% 78%;
    --input: 60 10% 78%;
    --ring: 150 65% 32%;
    --led: 150 70% 38%;
    --vfd: 30 90% 45%;
    --signal-red: 0 70% 48%;
    --panel-bevel: 48 20% 99%;
  }
  * { @apply border-border; }
  body {
    @apply bg-background text-foreground font-sans antialiased;
    background-image: radial-gradient(1100px 500px at 50% -180px, hsl(var(--led) / 0.06), transparent 70%);
  }
}

@layer components {
  /* film grain — subtle, never impairs contrast */
  .grain::before {
    content: ""; position: fixed; inset: 0; pointer-events: none; z-index: 60;
    opacity: 0.035;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)'/%3E%3C/svg%3E");
  }
  /* engraved panel label */
  .panel-label {
    @apply font-display uppercase tracking-[0.18em] text-xs text-muted-foreground;
  }
  /* scanlines for panel headers only */
  .scanlines {
    background-image: repeating-linear-gradient(0deg, transparent 0 2px, hsl(0 0% 0% / 0.12) 2px 3px);
  }
  /* 1px inner bevel like brushed panels */
  .bevel { box-shadow: inset 0 1px 0 hsl(var(--panel-bevel) / 0.55); }
  .led-glow { box-shadow: 0 0 6px 1px hsl(var(--led) / 0.55); }
  .press:active { transform: translateY(1px); }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
```

- [ ] **Step 5: Tailwind config** — extend with fonts + shadcn colors:

```ts
// frontend/tailwind.config.ts
import type { Config } from "tailwindcss";

export default {
  darkMode: ["class", ".light &"] as unknown as Config["darkMode"], // dark default; .light opts out
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Chakra Petch"', "sans-serif"],
        sans: ['"IBM Plex Sans"', "sans-serif"],
        mono: ['"IBM Plex Mono"', "monospace"],
      },
      colors: {
        border: "hsl(var(--border))", input: "hsl(var(--input))", ring: "hsl(var(--ring))",
        background: "hsl(var(--background))", foreground: "hsl(var(--foreground))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        led: "hsl(var(--led))", vfd: "hsl(var(--vfd))", signal: "hsl(var(--signal-red))",
      },
      borderRadius: { lg: "var(--radius)", md: "calc(var(--radius) - 2px)", sm: "calc(var(--radius) - 4px)" },
    },
  },
  plugins: [],
} satisfies Config;
```

NOTE on dark mode: simplest correct approach — dark tokens live on `:root` (default) and light mode is applied by adding class `light` to `<html>`. If the `darkMode` cast above fights shadcn components, use `darkMode: ["class"]` and add `class="dark"` default on `<html>` with inverted token blocks; either is acceptable as long as dark is the default and a `.light`/toggle works.

- [ ] **Step 6: Vitest config + smoke test**

```ts
// frontend/vitest.config.ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { environment: "jsdom", setupFiles: ["./src/test/setup.ts"], globals: true },
});
```

```ts
// frontend/src/test/setup.ts
import "@testing-library/jest-dom";
```

```ts
// frontend/src/lib/smoke.test.ts
import { cn } from "@/lib/utils";
test("cn merges classes", () => { expect(cn("a", false && "b", "c")).toBe("a c"); });
```

package.json scripts must include: `"dev": "vite", "build": "tsc -b && vite build", "test": "vitest run", "preview": "vite preview"`.

- [ ] **Step 7: Placeholder App + main** (proves fonts/tokens render; replaced in Task 4)

```tsx
// frontend/src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><App /></React.StrictMode>,
);
```

```tsx
// frontend/src/App.tsx
export default function App() {
  return (
    <div className="grain min-h-screen p-10">
      <h1 className="font-display text-3xl tracking-widest text-led led-glow inline-block px-2">CRATE</h1>
      <p className="font-mono text-muted-foreground mt-2">scaffold ok</p>
    </div>
  );
}
```

Set `<title>Crate — spotify-dl</title>` in `frontend/index.html`.

- [ ] **Step 8: gitignore + build gate + test + commit**

Add to repo-root `.gitignore`: `spotify_dl/static/dist/` and `frontend/node_modules/`.

Run: `cd frontend && bun run test && bun run build`
Expected: vitest 1 passed; build succeeds; `ls ../spotify_dl/static/dist/index.html` exists.

```bash
git add frontend .gitignore
git commit -m "feat: scaffold Crate frontend (vite+react+ts+tailwind+shadcn, panel tokens)"
```

---

### Task 2: Serve the built app from FastAPI (legacy fallback until Task 12)

**Files:**
- Modify: `spotify_dl/web.py` (the `@app.get("/")` route + a static mount)
- Test: `tests/test_web.py` (append)

**Interfaces:**
- Consumes: `spotify_dl/static/dist/` from Task 1.
- Produces: `/` serves `dist/index.html` when present, else the legacy `static/index.html`; `/assets/*` serves `dist/assets/*`.

- [ ] **Step 1: Write the failing tests** (append to `tests/test_web.py`)

```python
# ---- static serving (dist preferred, legacy fallback) ----

def test_index_serves_dist_when_present(client, monkeypatch, tmp_path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>CRATE</html>")
    (dist / "assets" / "app.js").write_text("console.log(1)")
    monkeypatch.setattr(web, "DIST_DIR", dist)
    r = client.get("/")
    assert r.status_code == 200 and "CRATE" in r.text
    r = client.get("/assets/app.js")
    assert r.status_code == 200 and "console.log" in r.text


def test_index_falls_back_to_legacy(client, monkeypatch, tmp_path):
    monkeypatch.setattr(web, "DIST_DIR", tmp_path / "nope")
    r = client.get("/")
    assert r.status_code == 200 and "spotify-dl" in r.text
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run pytest tests/test_web.py -k static -v` — FAIL (`web.DIST_DIR` missing).

- [ ] **Step 3: Implement** in `web.py` (replace the current `@app.get("/")` block):

```python
DIST_DIR = STATIC_DIR / "dist"


@app.get("/assets/{path:path}")
def dist_assets(path: str):
    f = (DIST_DIR / "assets" / path).resolve()
    if not str(f).startswith(str(DIST_DIR.resolve())) or not f.is_file():
        raise HTTPException(404, "no such asset")
    return FileResponse(f)


@app.get("/")
def index():
    dist_index = DIST_DIR / "index.html"
    if dist_index.is_file():
        return FileResponse(dist_index)
    return FileResponse(STATIC_DIR / "index.html")
```

- [ ] **Step 4: Verify** — `uv run pytest tests/test_web.py -v`: new tests pass, no new failures.

- [ ] **Step 5: Commit** — `git add spotify_dl/web.py tests/test_web.py && git commit -m "feat: serve built Crate frontend with legacy fallback"`

---

### Task 3: API layer — types + typed fetchers + query client

**Files:**
- Create: `frontend/src/lib/types.ts`, `frontend/src/lib/api.ts`, `frontend/src/lib/queries.ts`
- Test: `frontend/src/lib/api.test.ts`

**Interfaces:**
- Consumes: the live `/api/*` contract (reference: `spotify_dl/web.py`).
- Produces (every later task imports these):

```ts
// types.ts — exact shapes
export type Progress = { total: number; done: number; failed: number; current: string; pct: number; failed_tracks: string[]; unmatched: string[] };
export type LinkMeta = { url: string; kind: string | null; name: string | null; image: string | null; count: number | null; error: string | null };
export type Job = { id: number; urls: string[]; output: string; status: "running" | "done" | "failed"; meta: LinkMeta[]; progress: Progress; error: string | null };
export type LibraryFolder = { name: string; path: string; tracks: number; url: string | null };
export type Library = { path: string; folders: LibraryFolder[]; loose: number };
export type CronFields = { freq: "daily" | "weekly" | "hourly"; hour?: number; minute?: number; dow?: number; every?: number };
export type Cron = { id: string; schedule: string; friendly: string; enabled: boolean; managed: boolean; command: string; output?: string; label?: string; urls?: string[]; fields?: CronFields | null };
export type AppConfig = { default_output: string; places: { label: string; path: string }[] };
export type BrowseResult = { path: string; parent: string | null; dirs: string[] };
export type DjTrack = { id: string; title: string; artist: string; bpm: number | null; key_name: string | null; camelot: string | null; file_path: string; duration: number | null; status: "analyzed" | "pending"; playlists: string[] };
export type DjStatus = { running: boolean; can_write: boolean; analyzed: number; pending: number; not_imported: number };
export type Rating = "good" | "ok" | "clash";
export type ImportResult = { imported: string[]; skipped_duplicates: { path: string; reason: string }[] };
```

```ts
// api.ts — exact exports (all throw ApiError on !ok)
export class ApiError extends Error { constructor(public status: number, public detail: string) { super(detail); } }
export const api: {
  config(): Promise<AppConfig>;
  preview(url: string): Promise<LinkMeta>;
  jobs(): Promise<Job[]>;
  download(urls: string[], output: string): Promise<{ id: number }>;
  retry(jobId: number): Promise<{ id: number }>;
  library(path: string): Promise<Library>;
  reveal(path: string): Promise<void>;
  browse(path: string): Promise<BrowseResult>;
  pickFolder(start: string): Promise<{ cancelled: boolean; path?: string }>;
  crons(): Promise<Cron[]>;
  cronCreate(body: object): Promise<{ id: string }>;
  cronUpdate(id: string, body: object): Promise<{ id: string }>;
  cronToggle(id: string): Promise<{ enabled: boolean }>;
  cronDelete(id: string): Promise<void>;
  djStatus(path: string): Promise<DjStatus>;
  djTracks(f: { q?: string; bpm_min?: number; bpm_max?: number; camelot?: string }): Promise<{ tracks: DjTrack[] }>;
  djImport(path: string): Promise<ImportResult>;
  djCompatibility(ids: string[]): Promise<{ ratings: Rating[] }>;
  djEnergy(ids: string[]): Promise<{ energy: Record<string, number | null> }>;
  djExport(name: string, ids: string[]): Promise<{ playlist: string }>;
};
```

- `queries.ts`: a `QueryClient` (mutations `retry: 0`; queries default retry 2) and query-key constants `qk = { jobs, library, crons, config, djStatus, djTracks }`.

- [ ] **Step 1: Write failing tests** (`frontend/src/lib/api.test.ts`) — mock `global.fetch`; cover: (a) `api.jobs()` returns parsed JSON on 200; (b) `api.djImport()` throws `ApiError` with `detail` text from a 409 `{"detail":"close rekordbox first"}` body; (c) `api.djExport` sends `{name, ids}` as JSON body with POST + content-type header; (d) `api.preview` URL-encodes the url param. Write the four tests with `vi.stubGlobal("fetch", vi.fn(...))` asserting call args and results.

- [ ] **Step 2: Run to verify failure** — `cd frontend && bun run test` → api.test fails (module missing).

- [ ] **Step 3: Implement** `types.ts` (verbatim above), `api.ts`:

```ts
// frontend/src/lib/api.ts
import type { AppConfig, BrowseResult, Cron, DjStatus, DjTrack, ImportResult, Job, Library, LinkMeta, Rating } from "./types";

export class ApiError extends Error {
  constructor(public status: number, public detail: string) { super(detail); }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, init);
  if (!r.ok) {
    let detail = r.statusText;
    try { detail = (await r.json()).detail ?? detail; } catch { /* keep statusText */ }
    throw new ApiError(r.status, detail);
  }
  return (await r.json()) as T;
}

const post = (body: unknown): RequestInit => ({
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

export const api = {
  config: () => req<AppConfig>("/api/config"),
  preview: (url: string) => req<LinkMeta>(`/api/preview?url=${encodeURIComponent(url)}`),
  jobs: () => req<Job[]>("/api/jobs"),
  download: (urls: string[], output: string) => req<{ id: number }>("/api/download", post({ urls, output })),
  retry: (jobId: number) => req<{ id: number }>(`/api/jobs/${jobId}/retry`, { method: "POST" }),
  library: (path: string) => req<Library>(`/api/library?path=${encodeURIComponent(path)}`),
  reveal: (path: string) => req<unknown>("/api/reveal", post({ path })).then(() => undefined),
  browse: (path: string) => req<BrowseResult>(`/api/browse?path=${encodeURIComponent(path)}`),
  pickFolder: (start: string) => req<{ cancelled: boolean; path?: string }>("/api/pick-folder", post({ start })),
  crons: () => req<Cron[]>("/api/crons"),
  cronCreate: (body: object) => req<{ id: string }>("/api/crons", post(body)),
  cronUpdate: (id: string, body: object) => req<{ id: string }>(`/api/crons/${id}`, { ...post(body), method: "PUT" }),
  cronToggle: (id: string) => req<{ enabled: boolean }>(`/api/crons/${id}/toggle`, { method: "POST" }),
  cronDelete: (id: string) => req<unknown>(`/api/crons/${id}`, { method: "DELETE" }).then(() => undefined),
  djStatus: (path: string) => req<DjStatus>(`/api/dj/status?path=${encodeURIComponent(path)}`),
  djTracks: (f: { q?: string; bpm_min?: number; bpm_max?: number; camelot?: string }) => {
    const p = new URLSearchParams();
    if (f.q) p.set("q", f.q);
    if (f.bpm_min) p.set("bpm_min", String(f.bpm_min));
    if (f.bpm_max) p.set("bpm_max", String(f.bpm_max));
    if (f.camelot) p.set("camelot", f.camelot);
    return req<{ tracks: DjTrack[] }>(`/api/dj/tracks?${p}`);
  },
  djImport: (path: string) => req<ImportResult>("/api/dj/import", post({ path })),
  djCompatibility: (ids: string[]) => req<{ ratings: Rating[] }>("/api/dj/compatibility", post({ ids })),
  djEnergy: (ids: string[]) => req<{ energy: Record<string, number | null> }>("/api/dj/energy", post({ ids })),
  djExport: (name: string, ids: string[]) => req<{ playlist: string }>("/api/dj/export", post({ name, ids })),
};
```

```ts
// frontend/src/lib/queries.ts
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 2, refetchOnWindowFocus: false }, mutations: { retry: 0 } },
});

export const qk = {
  config: ["config"] as const,
  jobs: ["jobs"] as const,
  library: (path: string) => ["library", path] as const,
  crons: ["crons"] as const,
  djStatus: (path: string) => ["djStatus", path] as const,
  djTracks: (f: object) => ["djTracks", f] as const,
};
```

- [ ] **Step 4: Verify** — `bun run test` all pass; `bun run build` succeeds.
- [ ] **Step 5: Commit** — `git add frontend/src/lib && git commit -m "feat: typed api layer and query client for Crate"`

---

### Task 4: Shell — icon rail, page state, theme toggle, toaster, power-on

**Files:**
- Create: `frontend/src/components/Shell.tsx`, `frontend/src/components/LedLamp.tsx`
- Modify: `frontend/src/App.tsx`, `frontend/src/main.tsx` (QueryClientProvider + Toaster)

**Interfaces:**
- Consumes: tokens (T1), `queryClient` (T3).
- Produces: `<Shell page onPageChange>` layout wrapper; `<LedLamp state>` with `state: "on" | "warn" | "err" | "off"` (green glow / amber / red / dim) used everywhere; `App` holds `page: "download" | "dj"` state and an `outdir` state (string, localStorage-persisted, default from `/api/config`) passed to both pages. Pages receive `{ outdir, setOutdir }`.

- [ ] **Step 1: LedLamp** — small round div: `on` = led bg + `.led-glow`, `warn` = vfd bg + amber glow, `err` = signal bg, `off` = muted. Accepts `className`. Include a `title` prop for tooltips.

```tsx
// frontend/src/components/LedLamp.tsx
import { cn } from "@/lib/utils";

const styles = {
  on: "bg-led shadow-[0_0_6px_1px_hsl(var(--led)/0.6)]",
  warn: "bg-vfd shadow-[0_0_6px_1px_hsl(var(--vfd)/0.55)]",
  err: "bg-signal shadow-[0_0_6px_1px_hsl(var(--signal-red)/0.5)]",
  off: "bg-muted-foreground/30",
} as const;

export function LedLamp({ state, className, title }: { state: keyof typeof styles; className?: string; title?: string }) {
  return <span title={title} className={cn("inline-block h-2 w-2 rounded-full", styles[state], className)} />;
}
```

- [ ] **Step 2: Shell** — left rail (56px): CRATE tile (Chakra Petch "CR" mark), two icon buttons (lucide `Download`, `Disc3`) with active state (led text + glow), spacer, theme toggle (lucide `Sun`/`Moon`, toggles `light` class on `document.documentElement`, persists to localStorage `theme`), bottom `LedLamp state="on"` + "localhost" mono microcopy. Content area: `max-w-[720px]` for download, `max-w-[1080px]` for dj (Shell takes `wide` prop). Power-on: wrap children in a div with staggered `animate-[fadeUp_.4s_ease_both]` keyframes (define `fadeUp` in index.css: from opacity 0 / translateY(6px)); stagger via `style={{ animationDelay }}` on section wrappers inside pages (40ms steps) — pages own their stagger; Shell animates the rail once on mount.
- [ ] **Step 3: App + main wiring**

```tsx
// frontend/src/App.tsx (structure — implementer fills pages in later tasks with placeholders for now)
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Shell } from "@/components/Shell";
import { api } from "@/lib/api";
import { qk } from "@/lib/queries";

export default function App() {
  const [page, setPage] = useState<"download" | "dj">("download");
  const [outdir, setOutdir] = useState(() => localStorage.getItem("outdir") ?? "");
  const config = useQuery({ queryKey: qk.config, queryFn: api.config });
  useEffect(() => {
    if (config.data && localStorage.getItem("outdir") === null) setOutdir(config.data.default_output);
  }, [config.data]);
  useEffect(() => { localStorage.setItem("outdir", outdir); }, [outdir]);
  return (
    <Shell page={page} onPageChange={setPage} wide={page === "dj"}>
      {page === "download" ? <div className="panel-label">download page — task 6</div> : <div className="panel-label">dj page — task 9</div>}
    </Shell>
  );
}
```

`main.tsx`: wrap in `<QueryClientProvider client={queryClient}>` and render `<Toaster richColors position="bottom-right" />` (from `sonner`).

- [ ] **Step 4: Verify** — `bun run test && bun run build`; run `SPOTIFY_DL_NO_BROWSER=1 uv run spotify-dl-ui` + `curl -s localhost:8765 | grep -i crate` (dist served). Kill server.
- [ ] **Step 5: Commit** — `git add frontend/src && git commit -m "feat: Crate shell with icon rail, theme toggle, power-on"`

---

### Task 5: Retro primitives — VuMeter, PanelHeader, meter math

**Files:**
- Create: `frontend/src/components/VuMeter.tsx`, `frontend/src/components/PanelHeader.tsx`, `frontend/src/lib/meter.ts`
- Test: `frontend/src/lib/meter.test.ts`

**Interfaces:**
- Produces:
  - `meterSegments(pct: number, count?: number): ("off" | "green" | "amber")[]` — pure. `count` default 24. `lit = Math.round(clamp(pct,0,100)/100*count)`; segments `< lit`: index below `0.72*count` → "green", else "amber"; rest "off".
  - `<VuMeter pct indeterminate={false} className>` — renders the segment row (1.5px gaps, 3px-wide blocks, green blocks with slight glow, amber for peaks). `indeterminate` renders a scanning 4-block chase animation (CSS keyframes translate).
  - `<PanelHeader>label</PanelHeader>` — engraved `.panel-label` + hairline rule + optional right-side action slot (`action?: ReactNode`).

- [ ] **Step 1: Failing tests** (`meter.test.ts`):

```ts
import { meterSegments } from "@/lib/meter";
test("0% all off", () => expect(meterSegments(0, 10).every(s => s === "off")).toBe(true));
test("100% fills with amber tip", () => {
  const s = meterSegments(100, 10);
  expect(s.filter(x => x === "green").length).toBe(7);   // floor? -> spec below
  expect(s.filter(x => x === "amber").length).toBe(3);
  expect(s.includes("off")).toBe(false);
});
test("50% of 10 lights 5, all green (below 72% threshold)", () => {
  const s = meterSegments(50, 10);
  expect(s.filter(x => x !== "off").length).toBe(5);
  expect(s.includes("amber")).toBe(false);
});
test("clamps out-of-range", () => {
  expect(meterSegments(-5, 10).every(s => s === "off")).toBe(true);
  expect(meterSegments(250, 10).filter(s => s !== "off").length).toBe(10);
});
```

Green/amber boundary spec: a lit segment at index `i` (0-based) is "amber" iff `i >= Math.floor(0.72 * count)` — for count 10 that's indices 7,8,9 → 7 green + 3 amber at 100%.

- [ ] **Step 2: Run to fail** → module missing.
- [ ] **Step 3: Implement** `meter.ts` exactly per spec above; `VuMeter.tsx` + `PanelHeader.tsx` per Interfaces.
- [ ] **Step 4: Verify** — `bun run test && bun run build`.
- [ ] **Step 5: Commit** — `git commit -m "feat: retro primitives (vu meter, panel header, led math)"`

---

### Task 6: Download page — paste deck, previews, download action

**Files:**
- Create: `frontend/src/pages/Download/index.tsx`, `frontend/src/pages/Download/PasteDeck.tsx`, `frontend/src/pages/Download/usePreviews.ts`
- Modify: `frontend/src/App.tsx` (render the page)

**Interfaces:**
- Consumes: `api.preview/download`, `qk`, shadcn `Card/Textarea/Button`, `LedLamp`, toasts.
- Produces: `<DownloadPage outdir setOutdir/>` (index.tsx composes PasteDeck + later tasks' sections; export it now with PasteDeck only). `usePreviews(urls: string[])` → `{ previews: Record<string, LinkMeta | "loading">, validUrls: string[], trackTotal: number }` with 350ms debounce and per-URL cache (behavioral parity with legacy `schedulePreviews`/`validUrls`/`renderGoButton`).
- Behavior parity (reference legacy index.html lines ~391-495): one URL per line; invalid/error rows shown with amber text + reason; Download disabled unless ≥1 valid; label "Download N tracks" (sum of counts) or "Download N"; "Checking links…" while any loading; cmd/ctrl+Enter submits; on success clear textarea + toast + jobs refetch (`queryClient.invalidateQueries({queryKey: qk.jobs})`).

- [ ] **Step 1: Implement `usePreviews`** — state map keyed by url; effect debounces 350ms, fetches only unseen urls via `api.preview`, errors become `{...url, error: "Couldn't check this link."}`.
- [ ] **Step 2: PasteDeck UI** — Card with `Textarea` (mono, transparent), preview rows beneath (40px cover `img` or ♪/☁ glyph, name, meta "N tracks", kind badge, spinner ring while loading — style the spinner as a rotating LED arc), bottom bar: outdir input (mono, flex-1; editing updates `outdir` — full picker arrives Task 7 with a Browse button slot prop `pickerSlot?: ReactNode`), primary Button (press effect + glow) with dynamic label.
- [ ] **Step 3: Wire into `DownloadPage`** with section stagger delays; App renders `<DownloadPage/>` for page==="download".
- [ ] **Step 4: Verify** — `bun run test && bun run build`; manual: `cd frontend && bun run dev` with backend running; paste a spotify URL, see preview + enabled button (implementer notes what was verified; controller does final eyes-on later).
- [ ] **Step 5: Commit** — `git commit -m "feat: download paste deck with live previews"`

---

### Task 7: Download page — folder picker + schedule editor + crons list

**Files:**
- Create: `frontend/src/pages/Download/FolderPicker.tsx`, `frontend/src/pages/Download/SchedulePanel.tsx`, `frontend/src/pages/Download/CronList.tsx`
- Modify: `frontend/src/pages/Download/index.tsx`, `PasteDeck.tsx` (mount picker in the slot)

**Interfaces:**
- Consumes: `api.pickFolder/browse/config/crons/cronCreate/cronUpdate/cronToggle/cronDelete`, shadcn `Dialog/Command/Popover/Select/Switch`.
- Produces: `<FolderPicker value onChange/>` (Browse button → native `api.pickFolder`; on 501/failure → in-browser Dialog: places+recents chips (localStorage `recentDirs`, max 5), `Command` input filtering `api.browse` dirs, ↑/↓/Enter navigation, Use-this-folder); `<SchedulePanel urls validUrls outdir editing onDone/>` (Popover: freq daily/weekly/hourly, dow select, time input, every-N-hours; Add schedule / Save changes; parity with legacy `_build_schedule` fields); `<CronList onEdit/>` (rows: power-switch `Switch` toggle, title/sub per legacy `cronTitle/cronSub` logic, Edit + armed-confirm Delete for managed crons).
- Edit flow parity: editing a cron loads its urls into the paste deck, its output into outdir, fields into the panel — lift `editingCron: Cron | null` state to `DownloadPage` and pass down.

- [ ] **Step 1: FolderPicker** (native-first, dialog fallback — port legacy `pickFolderNative`/`openPicker`/`browseTo` behaviors).
- [ ] **Step 2: SchedulePanel** (fields + POST/PUT switch on `editing`; success → toast + invalidate `qk.crons` + `onDone()`).
- [ ] **Step 3: CronList** (30s `refetchInterval`; toggle → `api.cronToggle` + invalidate; delete: first click arms ("Remove?" in signal red, 2.5s reset), second click deletes).
- [ ] **Step 4: Verify** — `bun run test && bun run build`; dev-mode manual pass on picker + schedule create/edit/toggle/delete against the real backend.
- [ ] **Step 5: Commit** — `git commit -m "feat: folder picker, schedule editor, cron list"`

---

### Task 8: Download page — jobs (VU meters) + library (tape labels)

**Files:**
- Create: `frontend/src/pages/Download/JobsPanel.tsx`, `frontend/src/pages/Download/LibraryPanel.tsx`
- Modify: `frontend/src/pages/Download/index.tsx`

**Interfaces:**
- Consumes: `api.jobs/retry/library/reveal/download`, `VuMeter`, `LedLamp`, `Collapsible`.
- Produces: complete Download page at parity.
- Jobs parity (legacy `refreshJobs/renderStatus/jobLabel`): 1.5s poll; card per job (newest first): cover art or ♪, LED lamp by status (running=warn pulsing, done=on, failed=err), title from meta names, running → `VuMeter pct={(done + pct/100)/total*100}` (or `indeterminate` when total===0 with "Fetching tracks…"), mono counter `done / total`; finished → "N of M tracks" + "K didn't make it · J unmatched" amber line, expandable `Collapsible` listing failed tracks (signal ×) and unmatched (amber ? + "no YouTube match" tag + note line when missing > known); Retry button (failed or missing>0) → `api.retry` → invalidate jobs.
- Library parity: folder cards styled as tape labels (name strip on card top edge, mono "N tracks"), Sync button when `url` (POST download with that url + current outdir → toast + jobs invalidate), Reveal → `api.reveal`; "This folder" row for loose tracks; refresh on any job reaching a settled state (effect watching jobs data) + manual Refresh action in `PanelHeader`.

- [ ] **Step 1: JobsPanel** (with the VU meter as the hero element).
- [ ] **Step 2: LibraryPanel.**
- [ ] **Step 3: Compose** into `DownloadPage` (order: paste deck, Downloads, Library, Scheduled) with stagger.
- [ ] **Step 4: Verify** — `bun run test && bun run build`; dev-mode manual: run a real 1-track download end-to-end, watch the meter, confirm library refresh.
- [ ] **Step 5: Commit** — `git commit -m "feat: jobs with vu meters and tape-label library"`

---

### Task 9: DJ page — status strip + track browser

**Files:**
- Create: `frontend/src/pages/DjSets/index.tsx`, `frontend/src/pages/DjSets/StatusStrip.tsx`, `frontend/src/pages/DjSets/TrackBrowser.tsx`, `frontend/src/pages/DjSets/useSetState.ts`, `frontend/src/lib/camelot.ts`
- Test: `frontend/src/lib/camelot.test.ts`, `frontend/src/pages/DjSets/useSetState.test.ts`

**Interfaces:**
- Consumes: `api.djStatus/djTracks/djImport`, shadcn `Table/ScrollArea/Input/Select/Badge/Tooltip`.
- Produces:
  - `camelotColor(code: string | null): string` — port of v1 hue math: null → `"hsl(var(--muted))"`, else `hsl((n-1)*30 65% L / 0.85)` with `L = code.endsWith("A") ? 38 : 52`. Also `CAMELOT_CODES: string[]` (1A..12B interleaved) for the filter Select.
  - `useSetState()` → `{ setIds: string[], cache: Record<string, DjTrack>, add(t: DjTrack), remove(id), reorder(from: number, to: number), tracks: DjTrack[] }` — reducer-based; `add` stores the record in `cache` (the v1 lesson: set survives browser filters); `tracks` maps setIds→cache. Pure logic in the hook's reducer, unit-tested without DOM.
  - `<DjSetsPage outdir/>` composing strip + browser + (Task 10) rail + (Task 11) viz. Browser exposes `onAdd(track: DjTrack)`.
- StatusStrip parity+: 5s poll (only while mounted — component unmounts on page switch, so `refetchInterval` suffices); LED: rekordbox open → warn amber "REKORDBOX OPEN — analyzing", closed → on green "REKORDBOX CLOSED — writable"; pending count as a mini VuMeter (`pct = analyzed/(analyzed+pending)*100`) + mono "N pending analysis"; Import button when `not_imported > 0` (disabled + tooltip "Close rekordbox first" while running; on click → `api.djImport(outdir)` → toast "Imported X · Y dups skipped" listing up to 3 reasons + invalidate status+tracks). DB-unreachable (ApiError) → designed empty state (LED off, "can't read the rekordbox database", Retry button), not a toast loop.
- TrackBrowser parity: filters (debounced 300ms q, bpm min/max number inputs, camelot Select "Any key") drive `qk.djTracks(filters)` query; `Table` in `ScrollArea` (~420px), sticky header, columns: status(⏳/·), Title, Artist, BPM (mono, `toFixed(1)`), Key (`Badge` bg=camelotColor, white text) or amber-pulse "analyzing…", "+ Set" outline button (analyzed only; "Added" disabled state when in set).

- [ ] **Step 1: Failing tests** — camelot: `("8A")→"hsl(210 65% 38% / 0.85)"`, `("8B")` lightness 52, null → muted var; codes array has 24 entries starting "1A","1B". useSetState (renderHook): add stores + dedupes, remove, reorder(0,2) moves first to third, cache survives a simulated filter change (tracks still resolvable after cache-only membership).
- [ ] **Step 2: Run to fail.**
- [ ] **Step 3: Implement** camelot.ts, useSetState.ts, StatusStrip, TrackBrowser, page skeleton; App renders `<DjSetsPage/>`.
- [ ] **Step 4: Verify** — `bun run test && bun run build`; dev-mode manual against live rekordbox DB (~1.4k tracks render, filters work).
- [ ] **Step 5: Commit** — `git commit -m "feat: dj status strip and track browser"`

---

### Task 10: DJ page — set rail (dnd-kit), compatibility seams, save dialog

**Files:**
- Create: `frontend/src/pages/DjSets/SetRail.tsx`, `frontend/src/pages/DjSets/SaveSetDialog.tsx`
- Modify: `frontend/src/pages/DjSets/index.tsx`
- Test: `frontend/src/pages/DjSets/seams.test.ts` (pure seam mapping)

**Interfaces:**
- Consumes: `useSetState` (T9), `api.djCompatibility/djExport`, `@dnd-kit/core` + `@dnd-kit/sortable`, `Dialog/Tooltip`.
- Produces: complete manual-ordering UX. **NO auto-ordering** — the rail only annotates the user's order.
- Seams: `seamFor(ratings: Rating[], i: number): Rating | null` (null when i out of range) — trivial but tested so the alignment contract (ratings[i] sits between tracks[i] and tracks[i+1]) is pinned. Compatibility query refetches whenever `setIds` changes (`queryKey: ["djCompat", setIds]`, enabled when length>1); while stale/loading, seams render dim (no wrong colors).
- SetRail: numbered slots (mono index), key Badge, title/artist, mono BPM, remove ×; `DndContext` + `SortableContext` vertical list; drag handle = whole slot; on `dragEnd` → `reorder(oldIndex, newIndex)`. Between slots: seam line (2px, 46px wide) green/amber/red + `Tooltip` text: good → "harmonic + tempo match", ok → "workable — watch the blend", clash → "key or tempo clash". Summary chips above (count, `minBPM–maxBPM`, unique keys). Empty state: "Add analyzed tracks from the browser, then drag to order."
- SaveSetDialog: trigger Button "Save to rekordbox" (disabled when empty); Dialog: name Input, mono track recap list (n. key title), microcopy "Existing playlists are never touched — name collisions get (2)."; submit → `api.djExport` mutation → success toast `Saved as "X"` + close; ApiError 409 renders inline in the dialog (amber LED + "close rekordbox first"), not a toast; empty name disables submit.

- [ ] **Step 1: Failing seam test** (3 ratings → seamFor 0..3 = ratings[0..2], 3→null).
- [ ] **Step 2: Implement SetRail + dialog + compose** (browser left ~60%, rail right ~40%, `items-start`).
- [ ] **Step 3: Verify** — `bun run test && bun run build`; dev-mode manual: add 4 analyzed tracks, drag, seams recolor; save with rekordbox open shows inline 409.
- [ ] **Step 4: Commit** — `git commit -m "feat: set rail with drag ordering, seams, save dialog"`

---

### Task 11: DJ page — Camelot wheel + oscilloscope energy (React ports)

**Files:**
- Create: `frontend/src/pages/DjSets/CamelotWheel.tsx`, `frontend/src/pages/DjSets/EnergyScope.tsx`, `frontend/src/lib/wheel.ts`
- Modify: `frontend/src/pages/DjSets/index.tsx`
- Test: `frontend/src/lib/wheel.test.ts`

**Interfaces:**
- Consumes: `camelotColor` (T9), `api.djEnergy`, set `tracks` (T9/10). Reference implementation: the v1 SVG math in `spotify_dl/static/index.html` (`wheelArc`, `renderWheel`, `renderEnergy`) — port faithfully.
- Produces:
  - `wheel.ts`: `wheelArc(cx,cy,r0,r1,a0,a1): string` (exact v1 path math) and `segmentGeometry(n: 1..12, ring: "A"|"B")` → `{ path, labelX, labelY, chordX, chordY }` using v1 constants (size 260, A ring 52-88, B ring 90-126, seg=2π/12, seg/2 centering offset, chord radii 70/108). Unit-test: path string for (130,130,52,88,-π/12,π/12) contains "A52,52" and "A88,88"; chord pos for "1A" is (130, 130-70).
  - `<CamelotWheel tracks onSegmentClick(code)/>` — 24 segments, present-in-set segments full opacity with slight glow + `code·count` labels, absent 0.16; arrows (marker-end) between consecutive different keys; click → `onSegmentClick(code)` (page wires it to toggling the browser's camelot filter).
  - `<EnergyScope tracks/>` — oscilloscope styling: dark grid background (CSS `repeating-linear-gradient` 24px cells), phosphor-green trace `<polyline>` with an SVG `feGaussianBlur` glow filter, amber dashed BPM trace, mono labels ("ENERGY (LOUDNESS)" / "- - BPM"). Data flow ports v1: session `energyCache` (module-level `Map<string, number|null>`), POST only missing ids, cache nulls on failure (both !ok and thrown), "MEASURING…" interim, <2 tracks / <2 known → designed empty states. **Render-generation token** (closes sdl-697): a `useRef` counter incremented per render-effect; async writes bail unless their token is current — the effect sets state only from the latest invocation.
- Compose: two cards under browser+rail (`.dj-viz` equivalent: flex row, equal cards).

- [ ] **Step 1: Failing wheel tests.**
- [ ] **Step 2: Implement wheel.ts + both components + wire** (`onSegmentClick` toggles the TrackBrowser camelot filter via lifted state in the page).
- [ ] **Step 3: Verify** — `bun run test && bun run build`; dev-mode manual with a 4-track set: wheel highlights + arrows, scope draws after measuring, reorder redraws, rapid add/remove causes no stale chart (token works).
- [ ] **Step 4: Commit** — `git commit -m "feat: camelot wheel and oscilloscope energy scope"`

---

### Task 12: Cutover — delete legacy page, require dist, full gates

**Files:**
- Delete: `spotify_dl/static/index.html`
- Modify: `spotify_dl/web.py` (fallback → clear 500), `tests/test_web.py` (fallback test), `CLAUDE.md` (Build & Test section gets real commands), `README` untouched
- Test: full suites

**Interfaces:** none new — this closes the dual-UI window.

- [ ] **Step 1: Update the fallback** in `web.py`:

```python
@app.get("/")
def index():
    dist_index = DIST_DIR / "index.html"
    if not dist_index.is_file():
        raise HTTPException(500, "frontend not built — run: cd frontend && bun install && bun run build")
    return FileResponse(dist_index)
```

Replace `test_index_falls_back_to_legacy` with:

```python
def test_index_500_when_not_built(client, monkeypatch, tmp_path):
    monkeypatch.setattr(web, "DIST_DIR", tmp_path / "nope")
    r = client.get("/")
    assert r.status_code == 500 and "bun run build" in r.json()["detail"]
```

- [ ] **Step 2: Delete** `spotify_dl/static/index.html` (`git rm`).
- [ ] **Step 3: Docs** — in `CLAUDE.md` "Build & Test" placeholder section, add: `cd frontend && bun install && bun run build` (UI), `bun run test` (frontend tests), `uv run pytest tests/` (backend).
- [ ] **Step 4: Full gates** — `cd frontend && bun run test && bun run build`; `uv run pytest tests/ -q` (no new failures); `SPOTIFY_DL_NO_BROWSER=1 uv run spotify-dl-ui` + curl `/` serves Crate. Kill server.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat!: cut over to Crate frontend, remove legacy page"`

---

### Task 13: Live E2E + design QA (main session, NOT a subagent)

- [ ] **Step 1:** Build fresh; serve via FastAPI; Chrome eyes-on BOTH pages in dark + light: fonts actually Chakra Petch/Plex (inspect), grain/scanlines subtle, LED lamps glow, stagger plays once, reduced-motion honored.
- [ ] **Step 2:** Download flow: paste real link → previews → download → VU meter animates → library updates → schedule create/edit/toggle/delete.
- [ ] **Step 3:** DJ flow with rekordbox OPEN: strip amber, browser data-dense, filters, add 4 tracks, drag, seams, wheel, scope; save → inline 409.
- [ ] **Step 4:** Quit rekordbox (computer-use/osascript): strip flips green ≤5s; import small folder (dedup toast); save set → success + verify in DB (pyrekordbox read: playlist exists, order right); reopen rekordbox.
- [ ] **Step 5:** Design-PM pass: screenshot both pages, judge against the spec's aesthetic bar; fix nits (spacing, contrast, glow intensity) directly; commit.

---

## Self-Review Notes

- Spec coverage: tokens/fonts/atmosphere (T1), serving (T2, T12), api+state (T3), shell/toggle/toasts/power-on (T4), VU meter signature (T5, used T8/T9), download parity (T6-T8), dj parity+polish (T9-T11), oscilloscope + sdl-697 token (T11), cutover+docs (T12), E2E+design QA (T13). Poll intervals: jobs 1.5s (T8), status 5s (T9), crons 30s (T7). Mutations no-retry (T3). Parity behaviors cite the legacy file as reference — implementers must read it for the page they build.
- Type consistency: `DjTrack.playlists` present (backend sends it; UI may ignore). `Rating` shared T3→T10. `camelotColor` defined T9, consumed T10/T11. `meterSegments` T5 consumed T8/T9.
- Deliberate scope note: shadcn `add` may pull extra small deps (radix per component) — allowed under "shadcn's own deps".
