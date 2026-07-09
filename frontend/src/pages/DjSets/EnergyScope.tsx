import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { DjTrack } from "@/lib/types";
import { buildChart, CHART, type Chart, type EnergyDatum } from "@/lib/chart";

/**
 * Session-level energy cache (track id → {LUFS｜null, why}). Module-scoped so it
 * survives remounts and set edits within a session: loudness is fetched once per
 * track, and the `state` records *why* a file has no value (moved/deleted vs
 * analysis failure) so the scope can explain an absent overlay instead of going
 * blank. Faithful evolution of the v1 `energyCache`.
 */
const energyCache = new Map<string, EnergyDatum>();

const { W, H, PAD } = CHART;

/**
 * The scope. BPM is the star and renders from BPM alone (every rekordbox track
 * has one) — a solid phosphor trace with per-transition deltas and a real-BPM
 * axis, breaking cleanly across any track with no BPM. Loudness, when measured,
 * rides behind as a faint amber overlay; when it can't be measured the scope
 * says why rather than disappearing.
 *
 * A render-generation token guards the async measure: each effect run captures
 * the incremented counter, and a completing fetch only writes state if its token
 * is still current, so rapid set edits can't let a stale paint win (sdl-697).
 */
export function EnergyScope({ tracks }: { tracks: DjTrack[] }) {
  const [chart, setChart] = useState<Chart>(() => buildChart(tracks, energyCache));
  const [measuring, setMeasuring] = useState(false);
  const renderToken = useRef(0);
  const ids = tracks.map((t) => t.id).join(",");

  useEffect(() => {
    const token = ++renderToken.current;
    setChart(buildChart(tracks, energyCache));

    const missing = tracks.filter((t) => !energyCache.has(t.id)).map((t) => t.id);
    if (missing.length === 0) {
      setMeasuring(false);
      return;
    }

    setMeasuring(true);
    (async () => {
      try {
        const { energy, state } = await api.djEnergy(missing);
        for (const id of missing) {
          energyCache.set(id, {
            value: energy[id] ?? null,
            state: state[id] ?? "failed",
          });
        }
      } catch {
        // ApiError and network throws both land here: mark every requested id
        // as a failed measure so we don't re-ask this session.
        for (const id of missing) energyCache.set(id, { value: null, state: "failed" });
      }
      if (renderToken.current !== token) return; // a newer render superseded us
      setMeasuring(false);
      setChart(buildChart(tracks, energyCache));
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
      {chart.kind === "empty" ? (
        <div className="flex h-[150px] items-center justify-center px-4 text-center font-mono text-xs uppercase tracking-wider text-muted-foreground">
          {chart.message}
        </div>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Set BPM curve">
            <defs>
              <filter id="scope-glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="2.5" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* BPM axis: labeled with the true tempo range. */}
            <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="hsl(var(--border))" strokeWidth={1} />
            {[chart.axis.hi, chart.axis.lo].map((v, i) => (
              <text
                key={i}
                x={PAD - 4}
                y={(i === 0 ? chart.axis.hiY : chart.axis.loY) + 3}
                fontSize={9}
                fontFamily="'IBM Plex Mono', monospace"
                textAnchor="end"
                fill="hsl(var(--muted-foreground))"
              >
                {v.toFixed(0)}
              </text>
            ))}

            {/* Energy overlay, only when 2+ files measured. */}
            {chart.energy.shown && (
              <>
                <polygon points={chart.energy.area} fill="hsl(var(--vfd))" opacity={0.08} />
                <polyline
                  points={chart.energy.points}
                  fill="none"
                  stroke="hsl(var(--vfd))"
                  strokeWidth={1.2}
                  strokeDasharray="4 3"
                  opacity={0.7}
                />
                {chart.energy.dots.map((d, i) => (
                  <circle key={i} cx={d.cx} cy={d.cy} r={2.5} fill="hsl(var(--vfd))" opacity={0.8}>
                    <title>{d.title}</title>
                  </circle>
                ))}
              </>
            )}

            {/* BPM trace — one polyline per unbroken run, so nulls break the line. */}
            {chart.segments.map((pts, i) => (
              <polyline
                key={i}
                points={pts}
                fill="none"
                stroke="hsl(var(--led))"
                strokeWidth={2}
                filter="url(#scope-glow)"
              />
            ))}
            {chart.dots.map((d, i) => (
              <circle key={i} cx={d.cx} cy={d.cy} r={3.5} fill="hsl(var(--led))">
                <title>{d.title}</title>
              </circle>
            ))}
            {chart.deltas.map((d, i) => (
              <text
                key={i}
                x={d.x}
                y={d.y}
                fontSize={9}
                fontFamily="'IBM Plex Mono', monospace"
                textAnchor="middle"
                fill={d.sign === 0 ? "hsl(var(--muted-foreground))" : "hsl(var(--led))"}
              >
                {d.label}
              </text>
            ))}

            <text x={PAD} y={12} fontSize={10} fontFamily="'IBM Plex Mono', monospace" fill="hsl(var(--led))">
              BPM
            </text>
            {chart.energy.shown && (
              <text
                x={W - PAD}
                y={12}
                fontSize={10}
                fontFamily="'IBM Plex Mono', monospace"
                textAnchor="end"
                fill="hsl(var(--vfd))"
              >
                - - ENERGY
              </text>
            )}
          </svg>

          {!chart.energy.shown && chart.energy.reason && (
            <div className="px-2 pb-1 pt-0.5 text-center font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              {measuring ? "MEASURING ENERGY…" : chart.energy.reason}
            </div>
          )}
        </>
      )}
    </div>
  );
}
