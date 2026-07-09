export type View = { start: number; end: number };

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function timeAtX(x: number, width: number, view: View): number {
  const t = view.start + (x / width) * (view.end - view.start);
  return clamp(t, view.start, view.end);
}

export function xAtTime(t: number, width: number, view: View): number {
  return ((t - view.start) / (view.end - view.start)) * width;
}

/** peak byte indices covering one canvas pixel column; returns the max */
export function peakAtColumn(
  peaks: Uint8Array,
  rate: number,
  col: number,
  width: number,
  view: View,
): number {
  const len = peaks.length;
  if (len === 0) return 0;

  const span = view.end - view.start;
  const t0 = view.start + (col / width) * span;
  const t1 = view.start + ((col + 1) / width) * span;

  let lo = Math.floor(t0 * rate);
  let hi = Math.ceil(t1 * rate);
  if (hi <= lo) hi = lo + 1; // empty span → sample the floor index

  lo = clamp(lo, 0, len - 1);
  hi = clamp(hi, 1, len); // exclusive upper bound

  let max = 0;
  for (let i = lo; i < hi; i++) {
    if (peaks[i] > max) max = peaks[i];
  }
  return max;
}

export function clampView(view: View, duration: number, minSpan = 2): View {
  let { start, end } = view;

  // cap span at duration (shrink around center)
  if (end - start > duration) {
    const center = (start + end) / 2;
    start = center - duration / 2;
    end = center + duration / 2;
  }

  // enforce minimum span (grow around center)
  if (end - start < minSpan) {
    const center = (start + end) / 2;
    start = center - minSpan / 2;
    end = center + minSpan / 2;
  }

  // pin into [0, duration], preserving span
  if (start < 0) {
    end -= start;
    start = 0;
  }
  if (end > duration) {
    start -= end - duration;
    end = duration;
  }
  if (start < 0) start = 0; // re-pin when span exceeds duration (duration < minSpan)

  return { start, end };
}

/**
 * Two-finger pinch arithmetic: given each pointer's x before (p1a, p2a) and
 * after (p1b, p2b) the move, return the view under which the track times that
 * were under the fingers at pinch-start are now under the fingers' new
 * positions. Degenerate inputs (fingers at the same x) return the clamped
 * current view.
 */
export function pinchView(
  view: View,
  p1a: number,
  p1b: number,
  p2a: number,
  p2b: number,
  width: number,
  duration: number,
  minSpan = 2,
): View {
  const t1 = timeAtX(p1a, width, view);
  const t2 = timeAtX(p2a, width, view);
  if (p2b === p1b || t2 === t1 || width <= 0) return clampView(view, duration, minSpan);

  // Solve for {start, span} such that xAtTime(t1) === p1b and xAtTime(t2) === p2b.
  const span = ((t2 - t1) * width) / (p2b - p1b);
  if (!Number.isFinite(span) || span <= 0) return clampView(view, duration, minSpan);
  const start = t1 - (p1b / width) * span;
  return clampView({ start, end: start + span }, duration, minSpan);
}

/** One-finger pan: shift the view left/right by a pixel delta, span preserved. */
export function panView(view: View, dxPx: number, width: number, duration: number): View {
  if (width <= 0) return clampView(view, duration);
  const dt = (dxPx / width) * (view.end - view.start);
  // dragging content right (dx > 0) moves the window earlier in the track
  return clampView({ start: view.start - dt, end: view.end - dt }, duration);
}
