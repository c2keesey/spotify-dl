import type { DjTrack, EnergyState } from "@/lib/types";
import { signedDelta } from "@/lib/format";

/** Fixed SVG viewBox for the scope. */
export const CHART = { W: 420, H: 150, PAD: 26 } as const;

/** A per-track energy reading pulled from the session cache. */
export type EnergyDatum = { value: number | null; state: EnergyState };

export type ChartDot = { cx: number; cy: number; title: string };
export type ChartDelta = { x: number; y: number; label: string; sign: 1 | -1 | 0 };
export type ChartEnergy =
  | { shown: true; points: string; area: string; dots: ChartDot[] }
  | { shown: false; reason: string };

export type Chart =
  | { kind: "empty"; message: string }
  | {
      kind: "chart";
      /** One polyline point-string per unbroken run of BPMs; a null BPM ends a run. */
      segments: string[];
      dots: ChartDot[];
      deltas: ChartDelta[];
      /** Real BPM values + their y so the axis labels the true tempo range. */
      axis: { hi: number; lo: number; hiY: number; loY: number };
      energy: ChartEnergy;
    };

/**
 * The scope model is driven by **BPM alone** — every rekordbox track carries a
 * BPM, so the graph draws even when energy is entirely absent (the common case:
 * most files have moved off disk). Energy is a strictly optional overlay.
 *
 * A `null` BPM breaks the trace into separate segments rather than letting the
 * line interpolate straight through a gap.
 */
export function buildChart(tracks: DjTrack[], energy: Map<string, EnergyDatum>): Chart {
  const { W, H, PAD } = CHART;
  const bpms = tracks.map((t) => t.bpm);
  const known = bpms.filter((b): b is number => b != null);
  if (known.length < 2) {
    return { kind: "empty", message: "BPM graph needs 2+ tracks with a BPM." };
  }

  const bhi = Math.max(...known);
  const blo = Math.min(...known);
  const pad = (bhi - blo) * 0.15 || 1;
  const top = bhi + pad;
  const bot = blo - pad;

  const n = tracks.length;
  const x = (i: number) => (n === 1 ? W / 2 : PAD + (i / (n - 1)) * (W - 2 * PAD));
  const yB = (b: number) => H - PAD - ((b - bot) / (top - bot)) * (H - 2 * PAD);

  // Break the polyline at every null BPM instead of interpolating across it.
  const segments: string[] = [];
  const dots: ChartDot[] = [];
  let run: string[] = [];
  bpms.forEach((b, i) => {
    if (b == null) {
      if (run.length) segments.push(run.join(" "));
      run = [];
      return;
    }
    run.push(`${x(i)},${yB(b)}`);
    dots.push({ cx: x(i), cy: yB(b), title: `${tracks[i].title}: ${b.toFixed(1)} BPM` });
  });
  if (run.length) segments.push(run.join(" "));

  // Per-transition delta, only where both endpoints have a BPM.
  const deltas: ChartDelta[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = bpms[i];
    const c = bpms[i + 1];
    if (a == null || c == null) continue;
    const d = c - a;
    deltas.push({
      x: (x(i) + x(i + 1)) / 2,
      y: (yB(a) + yB(c)) / 2 - 5,
      label: signedDelta(d),
      sign: d > 0 ? 1 : d < 0 ? -1 : 0,
    });
  }

  return {
    kind: "chart",
    segments,
    dots,
    deltas,
    axis: { hi: bhi, lo: blo, hiY: yB(bhi), loY: yB(blo) },
    energy: buildEnergy(tracks, energy, x),
  };
}

function buildEnergy(
  tracks: DjTrack[],
  energy: Map<string, EnergyDatum>,
  x: (i: number) => number,
): ChartEnergy {
  const { H, PAD } = CHART;
  const vals = tracks.map((t) => energy.get(t.id)?.value ?? null);
  const known = vals.filter((v): v is number => v != null);
  if (known.length < 2) {
    return { shown: false, reason: energyAbsenceReason(tracks, energy) };
  }
  const hi = Math.max(...known);
  const lo = Math.min(...known);
  const m = (hi - lo) * 0.1 || 1;
  const yE = (e: number) => H - PAD - ((e - (lo - m)) / (hi + m - (lo - m))) * (H - 2 * PAD);

  const present = vals
    .map((v, i) => (v != null ? { i, v } : null))
    .filter((p): p is { i: number; v: number } => p != null);
  const points = present.map((p) => `${x(p.i)},${yE(p.v)}`).join(" ");
  const first = present[0];
  const last = present[present.length - 1];
  const area = `${x(first.i)},${H - PAD} ${points} ${x(last.i)},${H - PAD}`;
  const dots = present.map((p) => ({
    cx: x(p.i),
    cy: yE(p.v),
    title: `${tracks[p.i].title}: ${p.v.toFixed(1)} LUFS`,
  }));
  return { shown: true, points, area, dots };
}

/**
 * Say **why** energy is missing rather than going blank — the per-track state
 * from the API distinguishes a moved/deleted file from an analysis failure.
 */
export function energyAbsenceReason(tracks: DjTrack[], energy: Map<string, EnergyDatum>): string {
  const M = tracks.length;
  let missing = 0;
  let failed = 0;
  let pending = 0;
  for (const t of tracks) {
    const d = energy.get(t.id);
    if (!d) pending++;
    else if (d.state === "missing") missing++;
    else if (d.state === "failed") failed++;
  }
  if (pending === M) return ""; // still measuring — no note yet
  const parts: string[] = [];
  if (missing) parts.push(`${missing} of ${M} files not found on disk`);
  if (failed) parts.push(`${failed} could not be analyzed`);
  if (parts.length) return `Energy overlay hidden — ${parts.join(", ")}.`;
  return "Energy overlay appears once 2+ files are measured.";
}
