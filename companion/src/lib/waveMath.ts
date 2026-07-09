type View = { start: number; end: number };

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
