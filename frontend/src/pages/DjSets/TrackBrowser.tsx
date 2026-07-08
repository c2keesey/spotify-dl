import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api";
import { qk } from "@/lib/queries";
import { camelotColor, CAMELOT_CODES } from "@/lib/camelot";
import type { DjTrack } from "@/lib/types";

const ANY = "__any__";

/** One track row's key cell: colored Camelot badge, or a pulsing "analyzing…". */
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

/**
 * Track browser: debounced text/BPM filters + an immediate Camelot Select feed a
 * `djTracks` query. Rows render in a scrollable table with a sticky header; the
 * Camelot badge is the color accent. Analyzed rows expose a "+ Set" button
 * (calls `onAdd`); rows already in the set show a disabled "Added".
 *
 * `camelotFilter` is lifted so Task 11's key wheel can toggle it.
 */
export function TrackBrowser({
  camelotFilter,
  setCamelotFilter,
  onAdd,
  inSet,
}: {
  camelotFilter: string;
  setCamelotFilter: (v: string) => void;
  onAdd: (track: DjTrack) => void;
  inSet: Set<string>;
}) {
  const [q, setQ] = useState("");
  const [bpmMin, setBpmMin] = useState("");
  const [bpmMax, setBpmMax] = useState("");

  // Debounce the free-text/number inputs 300ms; the Camelot Select is immediate.
  const [debounced, setDebounced] = useState({ q: "", bpmMin: "", bpmMax: "" });
  useEffect(() => {
    const t = setTimeout(() => setDebounced({ q, bpmMin, bpmMax }), 300);
    return () => clearTimeout(t);
  }, [q, bpmMin, bpmMax]);

  const filters = useMemo(
    () => ({
      q: debounced.q.trim() || undefined,
      bpm_min: debounced.bpmMin ? Number(debounced.bpmMin) : undefined,
      bpm_max: debounced.bpmMax ? Number(debounced.bpmMax) : undefined,
      camelot: camelotFilter || undefined,
    }),
    [debounced, camelotFilter],
  );

  const tracksQ = useQuery({
    queryKey: qk.djTracks(filters),
    queryFn: () => api.djTracks(filters),
  });

  const tracks = tracksQ.data?.tracks ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search title or artist"
          className="h-9 max-w-64"
        />
        <Input
          value={bpmMin}
          onChange={(e) => setBpmMin(e.target.value)}
          type="number"
          inputMode="numeric"
          placeholder="BPM min"
          className="h-9 w-24 font-mono tabular-nums"
        />
        <Input
          value={bpmMax}
          onChange={(e) => setBpmMax(e.target.value)}
          type="number"
          inputMode="numeric"
          placeholder="BPM max"
          className="h-9 w-24 font-mono tabular-nums"
        />
        <Select
          value={camelotFilter || ANY}
          onValueChange={(v) => setCamelotFilter(v === ANY ? "" : v)}
        >
          <SelectTrigger className="h-9 w-32">
            <SelectValue placeholder="Any key" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any key</SelectItem>
            {CAMELOT_CODES.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ScrollArea className="h-[420px] rounded-lg border border-border/60 bg-card">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card [&_th]:h-9">
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Title</TableHead>
              <TableHead>Artist</TableHead>
              <TableHead className="w-20 text-right">BPM</TableHead>
              <TableHead className="w-20">Key</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {tracks.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  {tracksQ.isLoading ? "Loading tracks…" : "No tracks match."}
                </TableCell>
              </TableRow>
            ) : (
              tracks.map((t) => {
                const added = inSet.has(t.id);
                return (
                  <TableRow key={t.id} className="[&_td]:py-1.5">
                    <TableCell className="text-center text-muted-foreground">
                      {t.status === "pending" ? "⏳" : "·"}
                    </TableCell>
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
    </div>
  );
}
