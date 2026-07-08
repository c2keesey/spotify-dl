/**
 * Camelot wheel color math — ported from the v1 UI. Hue circles the wheel by
 * number (1..12 → 0..330°); the A ring sits darker than the B ring. Returned as
 * an exact `hsl(...)` string so callers can drop it straight into `background`.
 */
export function camelotColor(code: string | null): string {
  if (!code) return "hsl(var(--muted))";
  const n = parseInt(code, 10);
  const lightness = code.endsWith("A") ? 38 : 52;
  return `hsl(${(n - 1) * 30} 65% ${lightness}% / 0.85)`;
}

/** All 24 Camelot codes, interleaved 1A,1B,2A,2B,…,12A,12B — drives the key filter. */
export const CAMELOT_CODES: string[] = Array.from({ length: 12 }, (_, i) => [
  `${i + 1}A`,
  `${i + 1}B`,
]).flat();
