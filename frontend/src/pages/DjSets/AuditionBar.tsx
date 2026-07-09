import { AlertTriangle, Pause, Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DjTrack } from "@/lib/types";

/** The fixed transport panel — a little instrument readout that appears while a
 *  track is loaded. An LED lamp plus an engraved status word (never color alone)
 *  reports PLAYING / PAUSED / ERROR. */
export function AuditionBar({
  current,
  isPlaying,
  error,
  toggle,
  stop,
}: {
  current: DjTrack | null;
  isPlaying: boolean;
  error: string | null;
  toggle: (track: DjTrack) => void;
  stop: () => void;
}) {
  if (!current) return null;
  const status = error ? "ERROR" : isPlaying ? "PLAYING" : "PAUSED";
  const lamp = error ? "--signal-red" : isPlaying ? "--led" : "--vfd";
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <div className="bevel pointer-events-auto flex max-w-xl items-center gap-3 rounded-lg border border-border/60 bg-card/95 px-3 py-2 shadow-lg backdrop-blur">
        <span
          className={cn("h-2.5 w-2.5 shrink-0 rounded-full", isPlaying && !error && "motion-safe:animate-pulse")}
          style={{ background: `hsl(var(${lamp}))`, boxShadow: `0 0 6px 1px hsl(var(${lamp}) / 0.6)` }}
          aria-hidden
        />
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="panel-label flex items-center gap-1.5">
            audition
            <span className="text-[10px] tracking-[0.14em] text-foreground/70">· {status}</span>
          </span>
          {error ? (
            <span className="flex items-center gap-1 truncate font-mono text-xs text-[hsl(var(--signal-red))]">
              <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
              {error}
            </span>
          ) : (
            <span className="truncate font-mono text-xs text-foreground" title={`${current.title} — ${current.artist}`}>
              {current.title} <span className="text-muted-foreground">— {current.artist}</span>
            </span>
          )}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {!error && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="press h-7 w-7 p-0"
              aria-label={isPlaying ? "Pause" : "Play"}
              onClick={() => toggle(current)}
            >
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="press h-7 w-7 p-0 text-muted-foreground"
            aria-label="Stop audition"
            onClick={stop}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
