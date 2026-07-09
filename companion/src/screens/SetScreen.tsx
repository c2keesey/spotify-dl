import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, GripVertical, Loader2, Share2 } from "lucide-react";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { db } from "@/lib/idb";
import { buildCuesJson } from "@/lib/cuesExport";
import { pickExportMethod } from "@/lib/exportShare";
import { formatClock, formatDuration, totalRuntime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { StoredSet, TrackCues, TrackMeta } from "@/lib/types";

type Props = {
  stem: string;
  onOpenTrack: (trackId: string) => void;
  onBack: () => void;
};

/** Object-URL download fallback for when the share sheet isn't available. */
function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function SetScreen({ stem, onOpenTrack, onBack }: Props) {
  const [set, setSet] = useState<StoredSet | null>(null);
  const [order, setOrder] = useState<string[]>([]);
  const [cues, setCues] = useState<TrackCues>({});
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [stored, storedCues] = await Promise.all([db.getSet(stem), db.getCues(stem)]);
      if (!alive) return;
      setSet(stored ?? null);
      setOrder(stored?.order ?? []);
      setCues(storedCues);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [stem]);

  // A dedicated drag handle carries the listeners, so tapping a row body always
  // navigates and never starts a drag. The activation constraints keep a stray
  // finger-wobble on the handle from being read as a drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 8 } }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id || !set) return;
    setOrder((prev) => {
      const from = prev.indexOf(String(active.id));
      const to = prev.indexOf(String(over.id));
      if (from < 0 || to < 0) return prev;
      const next = arrayMove(prev, from, to);
      // Order is cheap and reconstructible, but persist immediately anyway so a
      // mid-flight app kill never loses the reorder.
      void db.putSet({ ...set, order: next });
      return next;
    });
  };

  const onExport = async () => {
    if (!set) return;
    setExporting(true);
    try {
      const latestCues = await db.getCues(stem);
      const json = buildCuesJson(stem, order, latestCues, new Date());
      const file = new File([json], `${stem} cues.json`, { type: "application/json" });
      const files = [file];
      if (pickExportMethod(navigator, files) === "share") {
        try {
          await navigator.share({ files });
          toast.success("Cues exported");
          return;
        } catch (err) {
          // The user dismissing the share sheet is not a failure — stay silent.
          if (err instanceof Error && err.name === "AbortError") return;
          // Any other share failure falls through to a plain download.
        }
      }
      downloadFile(file);
      toast.success("Cues downloaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <main className="grain min-h-dvh flex items-center justify-center p-6">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (!set) {
    return (
      <main className="grain min-h-dvh flex flex-col items-center justify-center gap-4 p-6">
        <p className="text-sm text-muted-foreground">This set is no longer on this device.</p>
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="size-4" /> Back to Import
        </Button>
      </main>
    );
  }

  const byId = new Map<string, TrackMeta>(set.manifest.tracks.map((t) => [t.id, t]));
  const rows = order.map((id) => byId.get(id)).filter((t): t is TrackMeta => t != null);
  const runtime = formatClock(totalRuntime(rows.map((t) => t.duration)));

  return (
    <main className="grain min-h-dvh flex flex-col items-center p-6">
      <div className="w-full max-w-md space-y-4 pt-8">
        <Card className="bevel">
          <CardHeader className="space-y-3">
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                size="sm"
                className="press -ml-2 h-9 text-muted-foreground"
                onClick={onBack}
              >
                <ArrowLeft className="size-4" /> Import
              </Button>
              <p className="panel-label">Set</p>
            </div>
            <div>
              <h1 className="font-display text-2xl leading-tight tracking-tight text-led led-glow">
                {set.name}
              </h1>
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                {rows.length} {rows.length === 1 ? "track" : "tracks"} · {runtime}
              </p>
            </div>
            <Button
              type="button"
              size="lg"
              className="press h-12 w-full text-base"
              disabled={exporting}
              onClick={onExport}
            >
              {exporting ? <Loader2 className="size-5 animate-spin" /> : <Share2 className="size-5" />}
              {exporting ? "Exporting…" : "Export cues"}
            </Button>
          </CardHeader>
        </Card>

        <Card className="bevel">
          <CardHeader className="pb-2">
            <p className="panel-label">Tracks</p>
          </CardHeader>
          <CardContent className="space-y-1">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={rows.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                {rows.map((track, i) => (
                  <SortableRow
                    key={track.id}
                    index={i}
                    track={track}
                    cueCount={cues[track.id]?.length ?? 0}
                    onOpen={onOpenTrack}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function SortableRow({
  index,
  track,
  cueCount,
  onOpen,
}: {
  index: number;
  track: TrackMeta;
  cueCount: number;
  onOpen: (trackId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: track.id,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const lit = cueCount > 0;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-1 rounded-md",
        isDragging && "relative z-10 bg-secondary shadow-lg",
      )}
    >
      <button
        type="button"
        aria-label={`Reorder ${track.title}`}
        className="press flex size-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-5" />
      </button>

      <button
        type="button"
        className="press flex min-w-0 flex-1 items-center gap-3 rounded-md py-2 pr-2 text-left"
        onClick={() => onOpen(track.id)}
      >
        <span className="w-5 shrink-0 text-right font-mono text-xs text-muted-foreground">
          {index + 1}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{track.title}</span>
          <span className="block truncate text-xs text-muted-foreground">{track.artist}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {track.bpm != null && (
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {Math.round(track.bpm)}
            </span>
          )}
          {track.camelot && (
            <Badge variant="secondary" className="font-mono text-[0.65rem]">
              {track.camelot}
            </Badge>
          )}
          <span className="w-9 text-right font-mono text-xs tabular-nums text-muted-foreground">
            {formatDuration(track.duration)}
          </span>
          <span
            title={`${cueCount} ${cueCount === 1 ? "cue" : "cues"}`}
            className={cn(
              "inline-flex min-w-6 items-center justify-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-[0.65rem]",
              lit
                ? "border-led/50 bg-led/10 text-led led-glow"
                : "border-border bg-secondary text-muted-foreground",
            )}
          >
            <span className={cn("size-1.5 rounded-full", lit ? "bg-led" : "bg-muted-foreground/50")} />
            {cueCount}
          </span>
        </span>
      </button>
    </div>
  );
}
