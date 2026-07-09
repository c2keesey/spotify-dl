import { Minus, Pause, Play, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatClockCs } from "@/lib/format";
import { cn } from "@/lib/utils";

type Props = {
  playing: boolean;
  currentTime: number;
  duration: number;
  bpm: number | null;
  camelot: string;
  onTogglePlay: () => void;
  /** signed seconds; the screen just seeks — works while paused */
  onNudge: (deltaSec: number) => void;
};

/**
 * Pure transport chrome: play/pause, a centisecond clock (fine enough to see
 * a 10ms nudge land), ±10ms nudge buttons, BPM + key readouts. No audio logic
 * lives here — everything is props in, intents out.
 */
export default function Transport({ playing, currentTime, duration, bpm, camelot, onTogglePlay, onNudge }: Props) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Badge variant="secondary" className="min-w-14 justify-center font-mono text-[0.65rem] tabular-nums">
          {bpm != null ? `${Math.round(bpm)} BPM` : "— BPM"}
        </Badge>
        <p className="font-mono text-sm tabular-nums text-vfd" aria-live="off">
          {formatClockCs(currentTime)}
          <span className="text-muted-foreground"> / {formatClockCs(duration)}</span>
        </p>
        <Badge variant="secondary" className="min-w-14 justify-center font-mono text-[0.65rem]">
          {camelot || "—"}
        </Badge>
      </div>

      <div className="flex items-center justify-center gap-3">
        <Button
          type="button"
          variant="outline"
          className="press h-11 min-w-[4.25rem] font-mono text-xs tabular-nums"
          aria-label="Nudge back 10 milliseconds"
          onClick={() => onNudge(-0.01)}
        >
          <Minus className="size-3" /> 10ms
        </Button>
        <Button
          type="button"
          size="lg"
          aria-label={playing ? "Pause" : "Play"}
          className={cn("press size-14 rounded-full", playing && "led-glow")}
          onClick={onTogglePlay}
        >
          {playing ? <Pause className="size-6" /> : <Play className="size-6 translate-x-0.5" />}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="press h-11 min-w-[4.25rem] font-mono text-xs tabular-nums"
          aria-label="Nudge forward 10 milliseconds"
          onClick={() => onNudge(0.01)}
        >
          <Plus className="size-3" /> 10ms
        </Button>
      </div>
    </div>
  );
}
