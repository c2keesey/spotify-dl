/**
 * Small numeric/time formatters for the set rail. All pure — the display layer
 * (chips, cumulative slot clocks, BPM deltas) reads through these so the logic
 * is testable without a DOM.
 */

/** `h:mm:ss`, dropping a leading zero hour → `m:ss` under one hour. Seconds in. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** Signed BPM delta for a transition label: `+6`, `-1.5`, `±0`. */
export function signedDelta(n: number): string {
  const r = Math.round(n * 10) / 10;
  const body = Number.isInteger(r) ? String(Math.abs(r)) : Math.abs(r).toFixed(1);
  const sign = r > 0 ? "+" : r < 0 ? "-" : "±";
  return `${sign}${body}`;
}

/** Running start time of every slot: slot i begins after slots 0..i-1 play. */
export function cumulativeStarts(durations: (number | null)[]): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const d of durations) {
    out.push(acc);
    acc += d ?? 0;
  }
  return out;
}

/** Total playtime of the set; unknown (null) durations count as zero. */
export function totalRuntime(durations: (number | null)[]): number {
  return durations.reduce((a: number, d) => a + (d ?? 0), 0);
}
