import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { qk } from "@/lib/queries";
import { camelotColor } from "@/lib/camelot";
import { cn } from "@/lib/utils";
import type { DjTrack, Rating } from "@/lib/types";
import { seamFor } from "./seams";
import { SaveSetDialog } from "./SaveSetDialog";

const SEAM_TEXT: Record<Rating, string> = {
  good: "harmonic + tempo match",
  ok: "workable — watch the blend",
  clash: "key or tempo clash",
};

const SEAM_COLOR: Record<Rating, string> = {
  good: "hsl(var(--led))",
  ok: "hsl(var(--vfd))",
  clash: "hsl(var(--signal-red))",
};

/** Horizontal signal light wedged between two channel strips. Dim (no color)
 * while the compatibility read is loading/stale, so a wrong color never shows. */
function Seam({ rating, dim }: { rating: Rating | null; dim: boolean }) {
  const color = rating && !dim ? SEAM_COLOR[rating] : undefined;
  const line = (
    <span
      className={cn("block h-[2px] w-[46px] rounded-full", (!rating || dim) && "bg-muted-foreground/25")}
      style={color ? { background: color, boxShadow: `0 0 5px 0 ${color}` } : undefined}
    />
  );
  return (
    <div className="flex items-center justify-center py-0.5">
      {rating && !dim ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0}>{line}</span>
            </TooltipTrigger>
            <TooltipContent>{SEAM_TEXT[rating]}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        line
      )}
    </div>
  );
}

/** One draggable channel strip. The whole slot is the drag handle (grip dots on
 * the left signal the affordance); the remove × sits outside the drag gesture. */
function Slot({ track, index, onRemove }: { track: DjTrack; index: number; onRemove: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: track.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined, transition }}
      className={cn(
        "bevel flex cursor-grab items-center gap-3 rounded-md border border-border/60 bg-card px-3 py-2 active:cursor-grabbing",
        isDragging && "z-10 opacity-80 shadow-lg",
      )}
      {...attributes}
      {...listeners}
    >
      <span className="grid grid-cols-2 gap-[3px] text-muted-foreground/50" aria-hidden>
        {Array.from({ length: 6 }).map((_, i) => (
          <span key={i} className="h-[3px] w-[3px] rounded-full bg-current" />
        ))}
      </span>
      <span className="w-5 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
        {index + 1}
      </span>
      {track.camelot ? (
        <Badge className="shrink-0 border-transparent font-mono text-white" style={{ background: camelotColor(track.camelot) }}>
          {track.camelot}
        </Badge>
      ) : (
        <span className="w-9 shrink-0 text-center text-muted-foreground">—</span>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-foreground" title={track.title}>{track.title}</div>
        <div className="truncate text-xs text-muted-foreground" title={track.artist}>{track.artist}</div>
      </div>
      <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
        {track.bpm != null ? track.bpm.toFixed(1) : "—"}
      </span>
      <button
        type="button"
        aria-label={`Remove ${track.title}`}
        onClick={() => onRemove(track.id)}
        className="shrink-0 rounded p-1 text-muted-foreground/60 transition-colors hover:bg-destructive/15 hover:text-destructive"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/** A stat pill in the summary row. */
function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-border/60 bg-card px-2.5 py-1 font-mono text-xs tabular-nums text-muted-foreground">
      {children}
    </span>
  );
}

/**
 * The DJ set rail — her workspace. Tracks stack as physical channel strips in
 * the *manual* order she dragged them into; there is NO auto-ordering. Between
 * strips, thin seam lights annotate harmonic/tempo compatibility (green/amber/
 * red), sourced from a `djCompat` read that refetches on every order change and
 * renders dim while in flight. A Save dialog exports the order to rekordbox.
 */
export function SetRail({
  setIds,
  tracks,
  onRemove,
  onReorder,
}: {
  setIds: string[];
  tracks: DjTrack[];
  onRemove: (id: string) => void;
  onReorder: (from: number, to: number) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const compatQ = useQuery({
    queryKey: qk.djCompat(setIds),
    queryFn: () => api.djCompatibility(setIds),
    enabled: setIds.length > 1,
  });
  const ratings = compatQ.data?.ratings ?? [];
  // Dim while a fresh order's ratings are still loading, so no stale color shows.
  const dim = compatQ.isFetching || !compatQ.data;

  const summary = useMemo(() => {
    const bpms = tracks.map((t) => t.bpm).filter((b): b is number => b != null);
    const keys = new Set(tracks.map((t) => t.camelot).filter(Boolean));
    return {
      min: bpms.length ? Math.min(...bpms) : null,
      max: bpms.length ? Math.max(...bpms) : null,
      keys: keys.size,
    };
  }, [tracks]);

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = setIds.indexOf(String(active.id));
    const to = setIds.indexOf(String(over.id));
    if (from !== -1 && to !== -1) onReorder(from, to);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Chip>{tracks.length} {tracks.length === 1 ? "track" : "tracks"}</Chip>
        {summary.min != null && (
          <Chip>{summary.min.toFixed(1)}–{summary.max!.toFixed(1)} BPM</Chip>
        )}
        {summary.keys > 0 && <Chip>{summary.keys} {summary.keys === 1 ? "key" : "keys"}</Chip>}
        <div className="flex-1" />
        <SaveSetDialog tracks={tracks} setIds={setIds} />
      </div>

      {tracks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 bg-card/40 px-4 py-12 text-center text-sm text-muted-foreground">
          Add analyzed tracks from the browser, then drag to order.
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={setIds} strategy={verticalListSortingStrategy}>
            <div>
              {tracks.map((t, i) => (
                <div key={t.id}>
                  <Slot track={t} index={i} onRemove={onRemove} />
                  {i < tracks.length - 1 && <Seam rating={seamFor(ratings, i)} dim={dim} />}
                </div>
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
