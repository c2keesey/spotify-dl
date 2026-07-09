import { useEffect, useRef, useState } from "react";
import { clampView, panView, peakAtColumn, pinchView, timeAtX, xAtTime, type View } from "@/lib/waveMath";
import type { Cue } from "@/lib/types";

/** ±px around a cue flag's x that grabs the flag instead of seeking */
const CUE_HIT_PX = 22;
/** movement below this is a tap (seek); above it commits to a drag gesture */
const TAP_SLOP_PX = 8;

type Props = {
  peaks: Uint8Array;
  rate: number;
  duration: number;
  currentTime: number;
  cues: Cue[];
  view: View;
  onSeek: (t: number) => void;
  onMoveCue: (num: number, start: number) => void;
  onViewChange: (v: View) => void;
};

/**
 * Controlled canvas waveform. All state (playhead, cues, view window) comes in
 * as props; gestures report intent out through callbacks. Redraw cadence: the
 * draw effect runs whenever a prop changes — while playing the parent's rAF
 * loop advances `currentTime` every frame, so drawing rides that rAF; paused,
 * it only redraws on demand. There is no playhead smoothing/tweening, so
 * prefers-reduced-motion needs no special casing here (the CSS kill-switch in
 * index.css handles decorative motion; the playhead just draws at the true
 * time every frame either way).
 */
type Gesture =
  | { mode: "idle" }
  | { mode: "pending"; id: number; x0: number; y0: number; cueNum: number | null }
  | { mode: "dragCue"; id: number; cueNum: number }
  | { mode: "pan"; id: number; lastX: number }
  | { mode: "pinch"; id1: number; id2: number; x1: number; x2: number; startView: View }
  // gesture consumed or aborted; ignore everything until all pointers lift
  | { mode: "dead" };

export default function Waveform({
  peaks,
  rate,
  duration,
  currentTime,
  cues,
  view,
  onSeek,
  onMoveCue,
  onViewChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const gestureRef = useRef<Gesture>({ mode: "idle" });
  const pointersRef = useRef<Map<number, number>>(new Map()); // pointerId -> x

  // devicePixelRatio-aware sizing driven by the container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // draw — on demand, whenever anything visible changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w === 0 || size.h === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const w = size.w;
    const h = size.h;
    if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
    if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // theme colors from the CSS custom properties (raw HSL triples)
    const styles = getComputedStyle(canvas);
    const led = styles.getPropertyValue("--led").trim() || "145 85% 55%";
    const vfd = styles.getPropertyValue("--vfd").trim() || "35 100% 66%";
    const bg = styles.getPropertyValue("--background").trim() || "80 6% 5%";

    const mid = h / 2;
    const flagH = 18;
    const maxBar = mid - flagH - 2; // leave headroom for the cue flags
    const playX = xAtTime(currentTime, w, view);

    // loop spans first, under everything
    for (const cue of cues) {
      if (cue.end === null) continue;
      const x0 = Math.max(0, xAtTime(cue.start, w, view));
      const x1 = Math.min(w, xAtTime(cue.end, w, view));
      if (x1 <= 0 || x0 >= w) continue;
      ctx.fillStyle = `hsl(${led} / 0.13)`;
      ctx.fillRect(x0, 0, x1 - x0, h);
    }

    // centerline
    ctx.fillStyle = `hsl(${led} / 0.25)`;
    ctx.fillRect(0, mid - 0.5, w, 1);

    // mirrored bars, one per pixel column: played bright, upcoming dim
    const drawBars = (from: number, to: number, style: string) => {
      if (to <= from) return;
      ctx.fillStyle = style;
      for (let col = from; col < to; col++) {
        const v = peakAtColumn(peaks, rate, col, w, view) / 255;
        const bh = Math.max(1, v * maxBar);
        ctx.fillRect(col, mid - bh, 1, bh * 2);
      }
    };
    const split = Math.max(0, Math.min(w, Math.ceil(playX)));
    drawBars(0, split, `hsl(${led} / 0.92)`);
    drawBars(split, w, `hsl(${led} / 0.32)`);

    // cue flags: labeled A–H at the cue start
    ctx.font = "600 11px 'IBM Plex Mono', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const cue of cues) {
      const x = xAtTime(cue.start, w, view);
      if (x < -CUE_HIT_PX || x > w + CUE_HIT_PX) continue;
      ctx.fillStyle = `hsl(${led} / 0.85)`;
      ctx.fillRect(x - 0.75, 0, 1.5, h);
      const fw = 16;
      ctx.fillStyle = `hsl(${led})`;
      ctx.fillRect(x - 0.75, 0, fw, flagH);
      ctx.fillStyle = `hsl(${bg})`;
      ctx.fillText(String.fromCharCode(65 + cue.num), x - 0.75 + fw / 2, flagH / 2 + 0.5);
    }

    // playhead — 2px VFD amber with a soft glow
    if (playX >= -1 && playX <= w + 1) {
      ctx.save();
      ctx.shadowColor = `hsl(${vfd} / 0.9)`;
      ctx.shadowBlur = 6;
      ctx.fillStyle = `hsl(${vfd})`;
      ctx.fillRect(playX - 1, 0, 2, h);
      ctx.restore();
    }
  }, [peaks, rate, duration, currentTime, cues, view, size]);

  // ---- pointer gestures ------------------------------------------------
  const localX = (e: React.PointerEvent): number => {
    const rect = containerRef.current?.getBoundingClientRect();
    return rect ? e.clientX - rect.left : e.clientX;
  };
  const localY = (e: React.PointerEvent): number => {
    const rect = containerRef.current?.getBoundingClientRect();
    return rect ? e.clientY - rect.top : e.clientY;
  };

  const cueNear = (x: number): number | null => {
    let best: number | null = null;
    let bestDist = CUE_HIT_PX;
    for (const cue of cues) {
      const d = Math.abs(xAtTime(cue.start, size.w, view) - x);
      if (d <= bestDist) {
        bestDist = d;
        best = cue.num;
      }
    }
    return best;
  };

  const endGesture = (id: number) => {
    pointersRef.current.delete(id);
    const g = gestureRef.current;
    const involved =
      g.mode === "pinch"
        ? g.id1 === id || g.id2 === id
        : g.mode === "pending" || g.mode === "dragCue" || g.mode === "pan"
          ? g.id === id
          : true;
    if (pointersRef.current.size === 0) gestureRef.current = { mode: "idle" };
    // a stray extra finger lifting must not kill an unrelated in-flight gesture
    else if (involved) gestureRef.current = { mode: "dead" };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const x = localX(e);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const g = gestureRef.current;
    const priorCount = pointersRef.current.size;
    pointersRef.current.set(e.pointerId, x);

    if (priorCount === 0) {
      gestureRef.current = { mode: "pending", id: e.pointerId, x0: x, y0: localY(e), cueNum: cueNear(x) };
      return;
    }
    // a second finger during pending/pan starts a pinch; anything else goes dead
    if (priorCount === 1 && (g.mode === "pending" || g.mode === "pan")) {
      const otherId = [...pointersRef.current.keys()].find((id) => id !== e.pointerId);
      const otherX = otherId !== undefined ? pointersRef.current.get(otherId) : undefined;
      if (otherId !== undefined && otherX !== undefined) {
        gestureRef.current = { mode: "pinch", id1: otherId, id2: e.pointerId, x1: otherX, x2: x, startView: view };
        return;
      }
    }
    if (g.mode !== "dragCue") gestureRef.current = { mode: "dead" };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    const x = localX(e);
    pointersRef.current.set(e.pointerId, x);
    const g = gestureRef.current;

    switch (g.mode) {
      case "pending": {
        if (g.id !== e.pointerId) return;
        const dx = x - g.x0;
        const dy = localY(e) - g.y0;
        if (Math.hypot(dx, dy) <= TAP_SLOP_PX) return;
        if (g.cueNum !== null) {
          // grabbing a flag drags the cue — never seeks
          gestureRef.current = { mode: "dragCue", id: e.pointerId, cueNum: g.cueNum };
          onMoveCue(g.cueNum, timeAtX(x, size.w, view));
          return;
        }
        const zoomed = view.end - view.start < duration - 0.001;
        if (zoomed && Math.abs(dx) > Math.abs(dy)) {
          gestureRef.current = { mode: "pan", id: e.pointerId, lastX: x };
          onViewChange(panView(view, dx, size.w, duration));
          return;
        }
        // moved too far to be a tap, but no drag target → swallow the gesture
        gestureRef.current = { mode: "dead" };
        return;
      }
      case "dragCue": {
        if (g.id !== e.pointerId) return;
        onMoveCue(g.cueNum, timeAtX(x, size.w, view));
        return;
      }
      case "pan": {
        if (g.id !== e.pointerId) return;
        onViewChange(panView(view, x - g.lastX, size.w, duration));
        gestureRef.current = { ...g, lastX: x };
        return;
      }
      case "pinch": {
        const x1 = pointersRef.current.get(g.id1);
        const x2 = pointersRef.current.get(g.id2);
        if (x1 === undefined || x2 === undefined) return;
        onViewChange(pinchView(g.startView, g.x1, x1, g.x2, x2, size.w, duration));
        return;
      }
      default:
        return;
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const g = gestureRef.current;
    if (g.mode === "pending" && g.id === e.pointerId) {
      // stayed under the slop → a tap → seek
      onSeek(timeAtX(localX(e), size.w, view));
    }
    endGesture(e.pointerId);
  };

  const onPointerCancel = (e: React.PointerEvent) => {
    endGesture(e.pointerId);
  };

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full touch-none select-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-label="Waveform" role="img" />
    </div>
  );
}

/** exported for the screen's zoom-out affordance */
export function isZoomed(view: View, duration: number): boolean {
  const full = clampView({ start: 0, end: duration }, duration);
  return view.start > full.start + 0.001 || view.end < full.end - 0.001;
}
