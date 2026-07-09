import { memo, useEffect, useRef } from "react";
import { Repeat } from "lucide-react";
import { classifyPadGesture, cancelsLongPress, LONG_PRESS_MS } from "@/lib/padGesture";
import { formatClockCs } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Cue } from "@/lib/types";

type Props = {
  cues: Cue[];
  armedLoop: number | null;
  onPlaceCue: (num: number) => void;
  onJumpToCue: (num: number) => void;
  onClearCue: (num: number) => void;
  onOpenPadMenu: (num: number) => void;
};

/**
 * The 8 hot-cue pads, A–H. 2×4 on a phone, one row of 8 on a wide screen.
 * Filled pad: tap jumps (loops also arm), horizontal swipe clears, long-press
 * opens the pad menu. Empty pad: tap places a cue at the playhead.
 */
// memo: the parent re-renders every playback frame; with referentially stable
// props (no currentTime here) the pads skip those renders entirely.
export default memo(function CuePads({ cues, armedLoop, onPlaceCue, onJumpToCue, onClearCue, onOpenPadMenu }: Props) {
  const byNum = new Map<number, Cue>(cues.map((c) => [c.num, c]));
  return (
    <div className="grid grid-cols-4 gap-2 md:grid-cols-8">
      {Array.from({ length: 8 }, (_, num) => (
        <Pad
          key={num}
          num={num}
          cue={byNum.get(num)}
          armed={armedLoop === num}
          onPlaceCue={onPlaceCue}
          onJumpToCue={onJumpToCue}
          onClearCue={onClearCue}
          onOpenPadMenu={onOpenPadMenu}
        />
      ))}
    </div>
  );
});

function Pad({
  num,
  cue,
  armed,
  onPlaceCue,
  onJumpToCue,
  onClearCue,
  onOpenPadMenu,
}: {
  num: number;
  cue: Cue | undefined;
  armed: boolean;
  onPlaceCue: (num: number) => void;
  onJumpToCue: (num: number) => void;
  onClearCue: (num: number) => void;
  onOpenPadMenu: (num: number) => void;
}) {
  const filled = cue !== undefined;
  const isLoop = cue?.end != null;
  const letter = String.fromCharCode(65 + num);

  // one active press per pad; pointer events + a timer implement
  // tap / swipe-to-clear / long-press without any touch-event fallbacks
  const press = useRef<{ id: number; x: number; y: number; t: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);

  const clearTimer = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };
  useEffect(() => clearTimer, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (press.current) return; // second finger on the same pad — ignore
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    press.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
    longPressFired.current = false;
    if (filled) {
      clearTimer();
      timer.current = setTimeout(() => {
        longPressFired.current = true;
        onOpenPadMenu(num);
      }, LONG_PRESS_MS);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    if (cancelsLongPress(e.clientX - p.x, e.clientY - p.y)) clearTimer();
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    press.current = null;
    clearTimer();
    if (longPressFired.current) return; // the menu already opened; suppress the tap
    const gesture = classifyPadGesture(performance.now() - p.t, e.clientX - p.x, e.clientY - p.y);
    if (gesture === "swipe") {
      if (filled) onClearCue(num);
    } else if (gesture === "tap") {
      if (filled) onJumpToCue(num);
      else onPlaceCue(num);
    }
  };

  const onPointerCancel = (e: React.PointerEvent) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    press.current = null;
    clearTimer();
  };

  return (
    <button
      type="button"
      aria-label={filled ? `Cue ${letter}${isLoop ? " (loop)" : ""}` : `Place cue ${letter}`}
      className={cn(
        "bevel press relative flex h-16 min-h-11 touch-none select-none flex-col items-center justify-center gap-0.5 rounded-md border sm:h-[4.5rem]",
        filled ? "border-led/45 bg-led/10" : "border-border bg-secondary/50",
        armed && "ring-2 ring-vfd",
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onContextMenu={(e) => e.preventDefault()} // long-press must open our menu, not the OS one
    >
      {/* status LED */}
      <span
        className={cn(
          "absolute right-1.5 top-1.5 size-1.5 rounded-full",
          filled ? "bg-led led-glow" : "bg-muted-foreground/40",
        )}
      />
      {isLoop && (
        <Repeat className={cn("absolute left-1.5 top-1.5 size-3", armed ? "text-vfd" : "text-led/80")} />
      )}
      <span
        className={cn(
          "font-display text-xl leading-none tracking-wide",
          filled ? "text-led" : "text-muted-foreground",
        )}
        style={{ textShadow: "0 1px 0 hsl(0 0% 0% / 0.45)" }}
      >
        {letter}
      </span>
      <span className="h-3 max-w-full truncate px-1 font-mono text-[0.6rem] leading-3 text-muted-foreground">
        {filled ? (cue.name || formatClockCs(cue.start)) : ""}
      </span>
    </button>
  );
}
