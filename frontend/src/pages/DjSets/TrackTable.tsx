import { ChevronDown, ChevronUp, ChevronsUpDown, Cloud, FileX2, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { camelotColor } from "@/lib/camelot";
import {
  fileStateMeta,
  formatDuration,
  type SortDir,
  type SortKey,
} from "@/lib/trackSort";
import type { DjTrack, FileState } from "@/lib/types";

const COLSPAN = 8;

/** The key cell: colored Camelot badge, a pulsing "analyzing…", or an em dash. */
function KeyCell({ track }: { track: DjTrack }) {
  if (track.camelot) {
    return (
      <Badge className="border-transparent font-mono text-white" style={{ background: camelotColor(track.camelot) }}>
        {track.camelot}
      </Badge>
    );
  }
  if (track.status === "pending") {
    return <span className="text-xs text-vfd motion-safe:animate-pulse">analyzing…</span>;
  }
  return <span className="text-muted-foreground">—</span>;
}

/** File-state marker: icon + word for anything not present; nothing when present. */
function FileStateCell({ state }: { state: FileState }) {
  const meta = fileStateMeta(state);
  if (!meta) return null;
  const Icon = state === "missing" ? FileX2 : state === "unmounted" ? Unplug : Cloud;
  return (
    <span className={cn("inline-flex items-center gap-1 font-mono text-[11px]", meta.className)} title={meta.label}>
      <Icon className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
      {meta.short}
    </span>
  );
}

/** A clickable, sortable column header with a live sort-direction indicator. */
function SortHead({
  label,
  col,
  sortKey,
  sortDir,
  onSort,
  className,
}: {
  label: string;
  col: SortKey;
  sortKey: SortKey | null;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
  className?: string;
}) {
  const active = sortKey === col;
  const Icon = !active ? ChevronsUpDown : sortDir === "asc" ? ChevronUp : ChevronDown;
  return (
    <TableHead className={className} aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => onSort(col)}
        className={cn(
          "-ml-1 inline-flex items-center gap-1 rounded px-1 hover:text-foreground",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
        <Icon className={cn("h-3 w-3", active ? "text-led" : "opacity-40")} aria-hidden />
      </button>
    </TableHead>
  );
}

/**
 * The track table: sortable headers, the data rows, and the loading / empty /
 * error states. A failed fetch renders an error row with Retry — never a blank
 * table. Purely presentational; all state lives in TrackBrowser.
 */
export function TrackTable({
  rows,
  sortKey,
  sortDir,
  onSort,
  inSet,
  onAdd,
  isError,
  isLoading,
  onRetry,
}: {
  rows: DjTrack[];
  sortKey: SortKey | null;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
  inSet: Set<string>;
  onAdd: (track: DjTrack) => void;
  isError: boolean;
  isLoading: boolean;
  onRetry: () => void;
}) {
  const head = (label: string, col: SortKey, className?: string) => (
    <SortHead label={label} col={col} sortKey={sortKey} sortDir={sortDir} onSort={onSort} className={className} />
  );
  return (
    <ScrollArea className="h-[560px] rounded-lg border border-border/60 bg-card">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-card [&_th]:h-9">
          <TableRow>
            {head("Title", "title")}
            {head("Artist", "artist")}
            {head("BPM", "bpm", "w-20 text-right [&>button]:ml-0")}
            {head("Key", "key", "w-24")}
            {head("Genre", "genre", "w-36")}
            {head("Length", "duration", "w-20 text-right [&>button]:ml-0")}
            <TableHead className="w-28">File</TableHead>
            <TableHead className="w-24" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {isError ? (
            <TableRow>
              <TableCell colSpan={COLSPAN} className="py-10">
                <div className="flex flex-col items-center gap-3 text-center">
                  <span className="text-sm text-muted-foreground">Couldn't load tracks from the rekordbox library.</span>
                  <Button type="button" variant="outline" size="sm" onClick={onRetry}>
                    Retry
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={COLSPAN} className="py-10 text-center text-muted-foreground">
                {isLoading ? "Loading tracks…" : "No tracks match."}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((t) => {
              const added = inSet.has(t.id);
              return (
                <TableRow key={t.id} className="[&_td]:py-1.5">
                  <TableCell className="max-w-0 truncate text-foreground" title={t.title}>
                    {t.title}
                  </TableCell>
                  <TableCell className="max-w-0 truncate text-muted-foreground" title={t.artist}>
                    {t.artist}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                    {t.bpm != null ? t.bpm.toFixed(1) : ""}
                  </TableCell>
                  <TableCell>
                    <KeyCell track={t} />
                  </TableCell>
                  <TableCell className="max-w-0 truncate text-muted-foreground" title={t.genre ?? undefined}>
                    {t.genre ?? ""}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                    {formatDuration(t.duration)}
                  </TableCell>
                  <TableCell>
                    <FileStateCell state={t.file_state} />
                  </TableCell>
                  <TableCell className="text-right">
                    {t.status === "analyzed" ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7"
                        disabled={added}
                        onClick={() => onAdd(t)}
                      >
                        {added ? "Added" : "+ Set"}
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </ScrollArea>
  );
}
