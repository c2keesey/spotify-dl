import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Loader2, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import Waveform, { isZoomed } from "@/components/Waveform";
import CuePads from "@/components/CuePads";
import Transport from "@/components/Transport";
import { db } from "@/lib/idb";
import { readAudioBlob } from "@/lib/opfs";
import { baseName } from "@/lib/importBundle";
import { cueReducer, type CueAction } from "@/lib/cueStore";
import { shouldWrap } from "@/lib/loop";
import { clampView, type View } from "@/lib/waveMath";
import { cn } from "@/lib/utils";
import type { Cue, TrackCues, TrackMeta } from "@/lib/types";

type Props = {
  stem: string;
  trackId: string;
  onBack: () => void;
};

const letter = (num: number) => String.fromCharCode(65 + num);

export default function TrackScreen({ stem, trackId, onBack }: Props) {
  const [track, setTrack] = useState<TrackMeta | null>(null);
  const [peaks, setPeaks] = useState<Uint8Array>(new Uint8Array());
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [cues, setCuesState] = useState<Cue[]>([]);
  const [duration, setDuration] = useState(0);
  const [view, setView] = useState<View | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [armedLoop, setArmedLoop] = useState<number | null>(null);
  const [menuPad, setMenuPad] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentTimeRef = useRef(0); // playhead as a ref, so callbacks reading it stay frame-stable
  const cuesRef = useRef<Cue[]>([]);
  const allCuesRef = useRef<TrackCues>({});
  const armedRef = useRef<number | null>(null);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);

  // ---- load: set → track meta, cues, peaks, audio blob ------------------
  useEffect(() => {
    let alive = true;
    let url: string | null = null;
    void (async () => {
      try {
        const [stored, storedCues] = await Promise.all([db.getSet(stem), db.getCues(stem)]);
        const meta = stored?.manifest.tracks.find((t) => t.id === trackId);
        if (!meta) throw new Error("track not in set");
        const [pk, blob] = await Promise.all([
          db.getPeaks(stem, trackId),
          readAudioBlob(stem, baseName(meta.audio)),
        ]);
        if (!alive) return;
        url = URL.createObjectURL(blob);
        allCuesRef.current = storedCues;
        cuesRef.current = storedCues[trackId] ?? [];
        setCuesState(cuesRef.current);
        setTrack(meta);
        setPeaks(pk ?? new Uint8Array());
        const d = meta.duration ?? 0;
        setDuration(d);
        // Only seed a view once we know a positive span; a {0,0} view makes the
        // waveform's xAtTime produce NaN. If duration is unknown here,
        // onLoadedMetadata seeds it from the audio element instead.
        if (d > 0) setView({ start: 0, end: d });
        setAudioUrl(url);
        setLoading(false);
      } catch {
        if (alive) {
          setMissing(true);
          setLoading(false);
        }
      }
    })();
    return () => {
      alive = false;
      audioRef.current?.pause();
      if (url) URL.revokeObjectURL(url);
    };
  }, [stem, trackId]);

  // ---- cue persistence: write-through, debounced ≤250ms, flushed on hide/unmount
  const flush = useCallback(() => {
    if (persistTimer.current) {
      clearTimeout(persistTimer.current);
      persistTimer.current = null;
    }
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    // allCuesRef is a mount-time snapshot of every track's cues; we merge this
    // track's edits over it as {...allCues, [trackId]: current}. If a future
    // feature edits a SIBLING track's cues while this screen is mounted, that
    // snapshot goes stale and this write-through would clobber it — re-read
    // db.getCues here before merging in that case.
    allCuesRef.current = { ...allCuesRef.current, [trackId]: cuesRef.current };
    // Cues are the only irreplaceable data — a failed write must not be silent.
    db.putCues(stem, allCuesRef.current).catch(() => {
      dirtyRef.current = true;
      toast.error("Couldn't save cues — storage write failed. Retrying on next edit.");
    });
  }, [stem, trackId]);

  const schedulePersist = useCallback(() => {
    dirtyRef.current = true;
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(flush, 250);
  }, [flush]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "hidden") flush();
    };
    // iOS Safari doesn't always fire visibilitychange when the app switcher
    // kills the tab, but pagehide is reliable — flush on both.
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", flush);
      flush(); // never drop a pending write on unmount
    };
  }, [flush]);

  const arm = useCallback((num: number | null) => {
    armedRef.current = num;
    setArmedLoop(num);
  }, []);

  /** Every cue edit goes through here: reducer → state → debounced persist. */
  const dispatch = useCallback(
    (action: CueAction): boolean => {
      const prev = cuesRef.current;
      const next = cueReducer(prev, action);
      if (next === prev) return false; // reducer rejected (e.g. loop end ≤ start)
      cuesRef.current = next;
      setCuesState(next);
      schedulePersist();
      // clearing the armed loop, or converting it back to a point cue, disarms
      if (
        armedRef.current === action.num &&
        (action.type === "clear" || (action.type === "setLoopEnd" && action.end === null))
      ) {
        arm(null);
      }
      return true;
    },
    [schedulePersist, arm],
  );

  // ---- audio engine ------------------------------------------------------
  /** authoritative playhead — the element, else the ref (never per-frame state,
   * so callbacks that read it stay referentially stable across playback). */
  const now = useCallback(() => audioRef.current?.currentTime ?? currentTimeRef.current, []);

  const seek = useCallback(
    (t: number) => {
      const a = audioRef.current;
      const clamped = Math.max(0, Math.min(t, duration || t));
      if (a) a.currentTime = clamped;
      currentTimeRef.current = clamped;
      setCurrentTime(clamped);
    },
    [duration],
  );

  const togglePlay = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      void a.play().catch(() => toast.error("Playback failed"));
    } else {
      a.pause();
    }
  }, []);

  const onNudge = useCallback((d: number) => seek(now() + d), [seek, now]);

  // rAF loop while playing: playhead tracking + the loop-wrap watcher.
  // (Never `timeupdate` — it fires ~4Hz, far too coarse for a tight loop.)
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const a = audioRef.current;
      if (a) {
        const armed = armedRef.current;
        const loop = armed !== null ? cuesRef.current.find((c) => c.num === armed) : undefined;
        if (shouldWrap(a.currentTime, loop)) a.currentTime = loop!.start;
        currentTimeRef.current = a.currentTime;
        setCurrentTime(a.currentTime);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const onLoadedMetadata = () => {
    const a = audioRef.current;
    if (!a || !Number.isFinite(a.duration) || a.duration <= 0) return;
    // the element's duration is authoritative over the manifest's
    setDuration(a.duration);
    setView((v) =>
      v == null || v.end === 0 || Math.abs(v.end - duration) < 0.001
        ? { start: 0, end: a.duration }
        : clampView(v, a.duration),
    );
  };

  // ---- pad + menu intents ------------------------------------------------
  // These are useCallback-stable so React.memo can keep CuePads from re-rendering
  // on every playhead frame. They read live values from refs, never per-frame state.
  const cueAt = useCallback((num: number) => cuesRef.current.find((c) => c.num === num), []);

  const onPlaceCue = useCallback((num: number) => {
    dispatch({ type: "place", num, start: now() });
  }, [dispatch, now]);

  const onJumpToCue = useCallback((num: number) => {
    const cue = cueAt(num);
    if (!cue) return;
    seek(cue.start);
    if (cue.end !== null) arm(armedRef.current === num ? null : num); // loop pads toggle arm
  }, [cueAt, seek, arm]);

  const onClearCue = useCallback((num: number) => {
    if (dispatch({ type: "clear", num })) toast(`Pad ${letter(num)} cleared`);
  }, [dispatch]);

  const onOpenPadMenu = useCallback((num: number) => {
    setRenameValue(cueAt(num)?.name ?? "");
    setMenuPad(num);
  }, [cueAt]);

  const onSetLoopEnd = useCallback((num: number) => {
    if (!dispatch({ type: "setLoopEnd", num, end: now() })) {
      toast.error("Loop end must be after the cue point — move the playhead past it first");
      return;
    }
    setMenuPad(null);
  }, [dispatch, now]);

  const onSaveRename = useCallback((num: number) => {
    dispatch({ type: "rename", num, name: renameValue.trim() });
    setMenuPad(null);
  }, [dispatch, renameValue]);

  // The pad menu is memoized so it stops re-rendering on every playhead frame:
  // menuCue and renameValue don't change during playback, and the callbacks are
  // all useCallback-stable.
  const menuCue = menuPad !== null ? cues.find((c) => c.num === menuPad) : undefined;
  const padMenu = useMemo(
    () => (
      <Dialog open={menuCue != null} onOpenChange={(open) => !open && setMenuPad(null)}>
        <DialogContent className="max-w-sm">
          {menuCue && (
            <>
              <DialogHeader>
                <p className="panel-label">Pad {letter(menuCue.num)}</p>
                <DialogTitle className="font-display tracking-tight">
                  {menuCue.name || `Cue ${letter(menuCue.num)}`}
                </DialogTitle>
                <DialogDescription className="font-mono text-xs">
                  {menuCue.end !== null ? "Loop" : "Hot cue"} · starts {menuCue.start.toFixed(2)}s
                  {menuCue.end !== null && ` · ends ${menuCue.end.toFixed(2)}s`}
                </DialogDescription>
              </DialogHeader>

              <div className="flex gap-2">
                <Input
                  value={renameValue}
                  placeholder="Cue name"
                  maxLength={40}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && onSaveRename(menuCue.num)}
                />
                <Button variant="secondary" size="lg" className="press shrink-0" onClick={() => onSaveRename(menuCue.num)}>
                  Save
                </Button>
              </div>

              <div className="grid gap-2">
                <Button
                  variant="outline"
                  className="press h-11 justify-start"
                  onClick={() => {
                    onJumpToCue(menuCue.num);
                    setMenuPad(null);
                  }}
                >
                  Jump to cue
                </Button>
                <Button
                  variant="outline"
                  className="press h-11 justify-start"
                  onClick={() => onSetLoopEnd(menuCue.num)}
                >
                  Set loop end at playhead
                </Button>
                {menuCue.end !== null && (
                  <Button
                    variant="outline"
                    className="press h-11 justify-start"
                    onClick={() => {
                      dispatch({ type: "setLoopEnd", num: menuCue.num, end: null });
                      setMenuPad(null);
                    }}
                  >
                    Remove loop end
                  </Button>
                )}
                <Button
                  variant="destructive"
                  className="press h-11 justify-start"
                  onClick={() => {
                    dispatch({ type: "clear", num: menuCue.num });
                    setMenuPad(null);
                  }}
                >
                  Clear pad
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    ),
    [menuCue, renameValue, dispatch, onJumpToCue, onSetLoopEnd, onSaveRename],
  );

  // ---- render --------------------------------------------------------------
  if (loading) {
    return (
      <main className="grain flex min-h-dvh items-center justify-center p-6">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (missing || !track) {
    return (
      <main className="grain flex min-h-dvh flex-col items-center justify-center gap-4 p-6">
        <p className="text-sm text-muted-foreground">This track is no longer on this device.</p>
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="size-4" /> Back to Set
        </Button>
      </main>
    );
  }

  const zoomed = view ? isZoomed(view, duration) : false;

  return (
    <main className="grain flex h-dvh flex-col">
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          preload="auto"
          className="hidden"
          onLoadedMetadata={onLoadedMetadata}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        />
      )}

      <header className="flex items-center gap-1 border-b border-border px-2 py-2">
        <Button
          variant="ghost"
          size="sm"
          className="press h-11 shrink-0 px-2 text-muted-foreground"
          onClick={onBack}
        >
          <ArrowLeft className="size-4" /> Set
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium leading-tight">{track.title}</p>
          <p className="truncate text-xs text-muted-foreground">{track.artist}</p>
        </div>
        <span
          className={cn(
            "mr-1 inline-flex min-w-6 shrink-0 items-center justify-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-[0.65rem]",
            cues.length > 0
              ? "border-led/50 bg-led/10 text-led led-glow"
              : "border-border bg-secondary text-muted-foreground",
          )}
        >
          <span className={cn("size-1.5 rounded-full", cues.length > 0 ? "bg-led" : "bg-muted-foreground/50")} />
          {cues.length}
        </span>
      </header>

      <section className="relative min-h-[160px] flex-1 bg-card/40">
        {view && (
          <Waveform
            peaks={peaks}
            rate={track.peaks_rate}
            duration={duration}
            currentTime={currentTime}
            cues={cues}
            view={view}
            onSeek={seek}
            onMoveCue={(num, start) => dispatch({ type: "move", num, start })}
            onViewChange={setView}
          />
        )}
        {zoomed && (
          <Button
            variant="outline"
            size="sm"
            aria-label="Zoom out to full track"
            className="press absolute right-2 top-2 h-11 bg-background/80"
            onClick={() => setView({ start: 0, end: duration })}
          >
            <ZoomOut className="size-4" /> Full
          </Button>
        )}
      </section>

      <section className="border-t border-border px-3 py-2">
        <Transport
          playing={playing}
          currentTime={currentTime}
          duration={duration}
          bpm={track.bpm}
          camelot={track.camelot || track.key_name}
          onTogglePlay={togglePlay}
          onNudge={onNudge}
        />
      </section>

      <section
        className="border-t border-border px-3 pt-2"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <CuePads
          cues={cues}
          armedLoop={armedLoop}
          onPlaceCue={onPlaceCue}
          onJumpToCue={onJumpToCue}
          onClearCue={onClearCue}
          onOpenPadMenu={onOpenPadMenu}
        />
      </section>

      {padMenu}
    </main>
  );
}
