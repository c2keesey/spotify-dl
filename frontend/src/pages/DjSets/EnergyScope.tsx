import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { DjTrack } from "@/lib/types";

/**
 * Session-level energy cache (track id → LUFS | null). Module-scoped so it
 * survives remounts and set edits within a session: measured loudness is only
 * fetched once per track, and a `null` marks a file we already tried and failed
 * to measure (so we don't hammer the backend re-asking for it). Faithful port
 * of the v1 `energyCache`.
 */
const energyCache = new Map<string, number | null>();

const W = 420;
const H = 150;
const PAD = 26;

type ScopeState =
  | { kind: "empty"; message: string }
  | { kind: "measuring" }
  | {
      kind: "chart";
      areaPoints: string;
      energyPoints: string;
      bpmPoints: string;
      dots: { cx: number; cy: number; title: string }[];
    };

function buildChart(tracks: DjTrack[]): ScopeState {
  const es = tracks.map((t) => (energyCache.has(t.id) ? energyCache.get(t.id)! : null));
  const known = es.filter((e): e is number => e != null);
  if (known.length < 2) {
    return { kind: "empty", message: "Not enough energy data for these files." };
  }

  const lo = Math.min(...known) - 1;
  const hi = Math.max(...known) + 1;
  const bpms = tracks.map((t) => t.bpm).filter((b): b is number => !!b);
  const blo = Math.min(...bpms) - 2;
  const bhi = Math.max(...bpms) + 2;

  const x = (i: number) => PAD + (i / (tracks.length - 1)) * (W - 2 * PAD);
  const yE = (e: number) => H - PAD - ((e - lo) / (hi - lo)) * (H - 2 * PAD);
  const yB = (b: number) => H - PAD - ((b - blo) / (bhi - blo)) * (H - 2 * PAD);

  const energyPoints = es
    .map((e, i) => (e != null ? `${x(i)},${yE(e)}` : null))
    .filter(Boolean)
    .join(" ");
  const bpmPoints = tracks
    .map((t, i) => (t.bpm ? `${x(i)},${yB(t.bpm)}` : null))
    .filter(Boolean)
    .join(" ");
  const areaPoints = `${PAD},${H - PAD} ${energyPoints} ${x(tracks.length - 1)},${H - PAD}`;
  const dots = es
    .map((e, i) =>
      e != null
        ? { cx: x(i), cy: yE(e), title: `${tracks[i].title}: ${e.toFixed(1)} LUFS` }
        : null,
    )
    .filter((d): d is { cx: number; cy: number; title: string } => d != null);

  return { kind: "chart", areaPoints, energyPoints, bpmPoints, dots };
}

/**
 * The energy oscilloscope — the set's loudness curve drawn as a phosphor-green
 * trace glowing over a faint grid, an amber dashed BPM trace behind it. Loudness
 * is measured server-side on demand (`api.djEnergy`) and cached per session.
 *
 * A render-generation token guards the async measure: each effect run captures
 * the incremented counter, and a completing fetch only writes state if its token
 * is still current. Rapid set edits therefore can't let a stale chart overwrite
 * a newer one — the last render always wins (closes sdl-697).
 */
export function EnergyScope({ tracks }: { tracks: DjTrack[] }) {
  const [state, setState] = useState<ScopeState>({
    kind: "empty",
    message: "Energy curve appears with 2+ tracks.",
  });
  const renderToken = useRef(0);
  const ids = tracks.map((t) => t.id).join(",");

  useEffect(() => {
    const token = ++renderToken.current;

    if (tracks.length < 2) {
      setState({ kind: "empty", message: "Energy curve appears with 2+ tracks." });
      return;
    }

    const missing = tracks.filter((t) => !energyCache.has(t.id)).map((t) => t.id);
    if (missing.length === 0) {
      setState(buildChart(tracks));
      return;
    }

    setState({ kind: "measuring" });
    (async () => {
      try {
        const { energy } = await api.djEnergy(missing);
        // Cache only ids the server reported; omitted ids stay uncached and get
        // re-measured next render — matches the v1 Object.assign flow.
        for (const [id, value] of Object.entries(energy)) energyCache.set(id, value);
      } catch {
        // Both !ok (ApiError) and network throws land here: mark every requested
        // id as unmeasurable so we don't re-ask this session.
        for (const id of missing) energyCache.set(id, null);
      }
      if (renderToken.current !== token) return; // a newer render superseded us
      setState(buildChart(tracks));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  return (
    <div
      className="rounded-lg border border-border/60 p-2"
      style={{
        backgroundColor: "hsl(var(--background))",
        backgroundImage:
          "repeating-linear-gradient(0deg, hsl(var(--led) / 0.08) 0 1px, transparent 1px 24px)," +
          "repeating-linear-gradient(90deg, hsl(var(--led) / 0.08) 0 1px, transparent 1px 24px)",
      }}
    >
      {state.kind === "empty" || state.kind === "measuring" ? (
        <div className="flex h-[150px] items-center justify-center px-4 text-center font-mono text-xs uppercase tracking-wider text-muted-foreground">
          {state.kind === "measuring" ? "MEASURING…" : state.message}
        </div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Set energy curve">
          <defs>
            <filter id="scope-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <polyline
            points={state.bpmPoints}
            fill="none"
            stroke="hsl(var(--vfd))"
            strokeWidth={1.2}
            strokeDasharray="4 3"
            opacity={0.75}
          />
          <polygon points={state.areaPoints} fill="hsl(var(--led))" opacity={0.1} />
          <polyline
            points={state.energyPoints}
            fill="none"
            stroke="hsl(var(--led))"
            strokeWidth={2}
            filter="url(#scope-glow)"
          />
          {state.dots.map((d, i) => (
            <circle key={i} cx={d.cx} cy={d.cy} r={3.5} fill="hsl(var(--led))">
              <title>{d.title}</title>
            </circle>
          ))}

          <text x={PAD} y={12} fontSize={10} fontFamily="'IBM Plex Mono', monospace" fill="hsl(var(--muted-foreground))">
            ENERGY (LOUDNESS)
          </text>
          <text
            x={W - PAD}
            y={12}
            fontSize={10}
            fontFamily="'IBM Plex Mono', monospace"
            textAnchor="end"
            fill="hsl(var(--vfd))"
          >
            - - BPM
          </text>
        </svg>
      )}
    </div>
  );
}
