import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { LedLamp } from "@/components/LedLamp";
import { api, ApiError } from "@/lib/api";
import { camelotColor } from "@/lib/camelot";
import { cn } from "@/lib/utils";
import type { DjTrack, DupeGroup } from "@/lib/types";
import { defaultSelection, comparedSummary, groupKey } from "./dupeSelect";

const REVIEW_NAME = "Duplicates — review";

const FILE_STATE_NOTE: Record<DjTrack["file_state"], string | null> = {
  present: null,
  missing: "file not found on disk",
  unmounted: "volume not mounted",
  not_a_file: "streaming entry",
};

/** One copy inside a group: a checkbox to mark it for the review playlist, plus
 *  everything needed to tell copies apart — key, title, exact path, file state,
 *  and which playlists it already sits in. */
function CopyRow({ track, marked, onToggle }: { track: DjTrack; marked: boolean; onToggle: () => void }) {
  const note = FILE_STATE_NOTE[track.file_state];
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 px-3 py-2 transition-colors hover:bg-secondary/40",
        marked && "border-l-2 border-vfd bg-vfd/5",
      )}
    >
      <input
        type="checkbox"
        checked={marked}
        onChange={onToggle}
        aria-label={`Mark copy “${track.title}” at ${track.file_path} for the review playlist`}
        className="mt-1 h-4 w-4 shrink-0 accent-[hsl(var(--vfd))]"
      />
      {track.camelot ? (
        <Badge className="mt-0.5 shrink-0 border-transparent font-mono text-white" style={{ background: camelotColor(track.camelot) }}>
          {track.camelot}
        </Badge>
      ) : (
        <span className="mt-0.5 w-9 shrink-0 text-center text-muted-foreground">—</span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm text-foreground" title={track.title}>{track.title}</span>
          {marked && <span className="panel-label shrink-0 text-[0.625rem] text-vfd">marked</span>}
        </div>
        <div className="truncate text-xs text-muted-foreground" title={track.artist}>{track.artist}</div>
        <div className="truncate font-mono text-[11px] text-muted-foreground/70" title={track.file_path}>{track.file_path}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
          {note && <span className="panel-label text-[0.625rem] text-signal">{note}</span>}
          {track.playlists.map((p) => (
            <span key={p} className="rounded-sm border border-border/60 px-1.5 py-px font-mono text-[10px] text-muted-foreground">{p}</span>
          ))}
        </div>
      </div>
    </label>
  );
}

/** A group panel. Exact and fuzzy read differently — LED colour AND an engraved
 *  label AND (for fuzzy) an explicit caution line, so the distinction never
 *  rides on colour alone. */
function GroupPanel({ group, index, marks, onToggle }: {
  group: DupeGroup; index: number; marks: Set<string>; onToggle: (id: string) => void;
}) {
  const exact = group.reason === "exact_path";
  return (
    <div className={cn("bevel overflow-hidden rounded-lg border bg-card", exact ? "border-led/40" : "border-vfd/40")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/60 px-3 py-2">
        <LedLamp state={exact ? "on" : "warn"} />
        <span className="panel-label">{exact ? "Exact — same file" : "Fuzzy — same song (guess)"}</span>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">{group.tracks.length} copies</span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground/80" title={comparedSummary(group)}>
          {comparedSummary(group)}
        </span>
      </div>
      {!exact && (
        <p className="border-b border-border/40 bg-vfd/5 px-3 py-1.5 text-xs text-foreground/90">
          Matched by artist, title and duration — verify each before marking. Nothing is preselected.
        </p>
      )}
      <div className="divide-y divide-border/40">
        {group.tracks.map((t) => (
          <CopyRow key={`${groupKey(group, index)}:${t.id}`} track={t} marked={marks.has(t.id)} onToggle={() => onToggle(t.id)} />
        ))}
      </div>
    </div>
  );
}

/**
 * Duplicate cleanup screen — the bead this project was started for. Shows every
 * duplicate candidate group in the rekordbox collection, exact (certain) and
 * fuzzy (guessed) distinguished. The user marks copies and exports them as a
 * NEW "Duplicates — review" playlist she deletes by hand in rekordbox: Crate
 * deletes nothing. The scan is read-only and runs while rekordbox is open; only
 * the export needs rekordbox closed (it writes master.db).
 */
export function Duplicates() {
  const dupes = useQuery({ queryKey: ["djDuplicates"], queryFn: api.djDuplicates, retry: false });
  const [marks, setMarks] = useState<Set<string>>(new Set());
  const [locked, setLocked] = useState(false); // 409: rekordbox open
  const inFlight = useRef(false);

  // Seed the default marks whenever a fresh scan arrives: exact groups keep one
  // copy and mark the rest; fuzzy groups start with nothing marked.
  useEffect(() => {
    if (dupes.data) setMarks(defaultSelection(dupes.data.groups));
  }, [dupes.data]);

  const toggle = (id: string) =>
    setMarks((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const markedIds = useMemo(() => [...marks], [marks]);

  const exportReview = useMutation({
    mutationFn: () => api.djExport(REVIEW_NAME, markedIds),
    onSuccess: (r) => {
      toast.success(`Exported ${markedIds.length} copies to “${r.playlist}”`, {
        description: "Delete them by hand in rekordbox — Crate removed nothing.",
      });
      setLocked(false);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) setLocked(true);
      else toast.error(e instanceof ApiError ? e.detail : "Export failed");
    },
    onSettled: () => { inFlight.current = false; },
  });

  function doExport() {
    if (inFlight.current || exportReview.isPending || markedIds.length === 0) return;
    inFlight.current = true;
    exportReview.mutate();
  }

  if (dupes.isError) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-card px-4 py-3">
        <LedLamp state="off" />
        <span className="text-sm text-muted-foreground">Can't read the rekordbox database.</span>
        <div className="flex-1" />
        <Button type="button" variant="outline" size="sm" onClick={() => dupes.refetch()}>Retry</Button>
      </div>
    );
  }
  if (!dupes.data) {
    return <p className="px-1 text-sm text-muted-foreground">Scanning the collection for duplicates…</p>;
  }

  const { groups, exact_count, fuzzy_count } = dupes.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border/60 bg-card px-4 py-3">
        <span className="flex items-center gap-2"><LedLamp state="on" /><span className="panel-label">{exact_count} exact</span></span>
        <span className="flex items-center gap-2"><LedLamp state="warn" /><span className="panel-label">{fuzzy_count} fuzzy</span></span>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">{marks.size} marked for review</span>
        <div className="flex-1" />
        <Button type="button" size="sm" disabled={marks.size === 0 || exportReview.isPending} onClick={doExport}>
          {exportReview.isPending ? "Exporting…" : `Export ${marks.size} → review playlist`}
        </Button>
      </div>

      {locked && (
        <div className="flex items-center gap-2 rounded-md border border-vfd/40 bg-vfd/10 px-3 py-2 text-sm text-foreground">
          <LedLamp state="warn" />
          <span>rekordbox is open — the export writes your collection, so close rekordbox first, then export.</span>
        </div>
      )}

      <p className="px-1 text-xs text-muted-foreground">
        Marking a copy adds it to a new <span className="font-mono text-foreground">“{REVIEW_NAME}”</span> playlist (existing playlists
        are never touched). Delete the copies by hand inside rekordbox — Crate never removes anything.
      </p>

      {groups.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 bg-card/40 px-4 py-12 text-center text-sm text-muted-foreground">
          No duplicate candidates found in the collection.
        </div>
      ) : (
        <ScrollArea className="h-[calc(100vh-320px)] min-h-[24rem]">
          <div className="space-y-3 pr-3">
            {groups.map((g, i) => (
              <GroupPanel key={groupKey(g, i)} group={g} index={i} marks={marks} onToggle={toggle} />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
