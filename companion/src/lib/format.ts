/**
 * Small numeric/time formatters for the set screen. All pure — the display
 * layer (row clocks, header runtime) reads through these so the logic is
 * testable without a DOM. Copied from the main Crate app's format.ts; the
 * companion is standalone and never imports across apps.
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

/** A track's length for a row cell. Blank when unknown. */
export function formatDuration(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec)) return "";
  return formatClock(sec);
}

/** Total playtime of the set; unknown (null) durations count as zero. */
export function totalRuntime(durations: (number | null)[]): number {
  return durations.reduce((a: number, d) => a + (d ?? 0), 0);
}
