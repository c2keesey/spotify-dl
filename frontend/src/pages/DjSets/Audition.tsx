import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { DjTrack } from "@/lib/types";
import { auditionStartTime, canAudition } from "./auditionOffset";
import { AuditionBar } from "./AuditionBar";

type AuditionState = {
  current: DjTrack | null;
  isPlaying: boolean;
  error: string | null;
  toggle: (track: DjTrack) => void;
  stop: () => void;
};

const AuditionContext = createContext<AuditionState | null>(null);

/** Access the single shared player. Consumers (row buttons, transport) read
 *  from here so only one track ever sounds at a time. */
export function useAudition(): AuditionState {
  const ctx = useContext(AuditionContext);
  if (!ctx) throw new Error("useAudition must be used inside <AuditionProvider>");
  return ctx;
}

/**
 * The one audio engine for the page. Holds a single <audio> element, so starting
 * a track necessarily stops the previous one. Playback drops in a third of the
 * way through (see auditionStartTime). Spacebar toggles the current track. A
 * file that fails to load surfaces a visible error in the transport bar rather
 * than a silent no-op.
 */
export function AuditionProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const pendingOffset = useRef(0);
  const autoPlay = useRef(false);
  const [current, setCurrent] = useState<DjTrack | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = useCallback(
    (track: DjTrack) => {
      const audio = audioRef.current;
      if (!audio || !canAudition(track.file_state)) return;
      if (current?.id === track.id) {
        if (isPlaying) audio.pause();
        else void audio.play().catch(() => {});
        return;
      }
      setError(null);
      setCurrent(track);
      pendingOffset.current = auditionStartTime(track.duration);
      autoPlay.current = true;
      audio.src = api.djAudioUrl(track.id);
      audio.load();
    },
    [current, isPlaying],
  );

  const stop = useCallback(() => {
    audioRef.current?.pause();
    setCurrent(null);
    setIsPlaying(false);
  }, []);

  // Spacebar toggles the current track — unless focus is in a text field or on a
  // control that space-activates itself (a real button, or anything role="button"
  // such as a draggable set slot, whose Space picks it up for keyboard reorder).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.code !== "Space" || !current) return;
      const el = e.target as HTMLElement;
      if (
        ["INPUT", "TEXTAREA", "BUTTON"].includes(el.tagName) ||
        el.getAttribute("role") === "button" ||
        el.isContentEditable
      )
        return;
      e.preventDefault();
      toggle(current);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, toggle]);

  function onLoadedMetadata() {
    const audio = audioRef.current;
    if (!audio) return;
    const off = pendingOffset.current;
    if (off > 0 && Number.isFinite(audio.duration) && off < audio.duration) {
      audio.currentTime = off;
    }
    pendingOffset.current = 0;
    if (autoPlay.current) {
      autoPlay.current = false;
      void audio.play().catch(() => {});
    }
  }

  return (
    <AuditionContext.Provider value={{ current, isPlaying, error, toggle, stop }}>
      {children}
      <audio
        ref={audioRef}
        preload="none"
        onLoadedMetadata={onLoadedMetadata}
        onPlay={() => {
          setError(null);
          setIsPlaying(true);
        }}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        onError={() => {
          setIsPlaying(false);
          setError("This file couldn't be played — it may have moved or been deleted.");
        }}
      />
      <AuditionBar current={current} isPlaying={isPlaying} error={error} toggle={toggle} stop={stop} />
    </AuditionContext.Provider>
  );
}

/** A play/pause control for a track row. Visibly unavailable for any file that
 *  is not present on disk — the common case in this library. */
export function AuditionButton({ track }: { track: DjTrack }) {
  const { current, isPlaying, toggle } = useAudition();
  const playable = canAudition(track.file_state);
  const showPause = current?.id === track.id && isPlaying;
  const label = !playable
    ? `${track.title} — file not on disk, can't audition`
    : showPause
      ? `Pause ${track.title}`
      : `Audition ${track.title}`;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="press h-7 w-7 p-0 text-muted-foreground hover:text-led"
      disabled={!playable}
      aria-label={label}
      aria-pressed={showPause}
      title={label}
      onClick={() => toggle(track)}
    >
      {showPause ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
    </Button>
  );
}
