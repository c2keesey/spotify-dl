import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { qk } from "@/lib/queries";
import type { DjTrack } from "@/lib/types";
import {
  distinctGenres,
  filterTracks,
  normalizeTrack,
  sortTracks,
  type FileStateFilter,
  type SortDir,
  type SortKey,
} from "@/lib/trackSort";
import { TrackFilters } from "./TrackFilters";
import { TrackTable } from "./TrackTable";

/**
 * Track browser. Search / BPM / Camelot feed the server query; genre, duration,
 * analyzed-only and file-state filter the cached list client-side, and every
 * data column sorts. Set members survive filtering (the session cache lives in
 * useSetState, read by the set rail). A failed fetch renders an error row with
 * Retry — never a blank table or a toast loop. `camelotFilter` is lifted so the
 * key wheel can toggle it.
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
  const [genre, setGenre] = useState("");
  const [fileState, setFileState] = useState<FileStateFilter>("any");
  const [lenMin, setLenMin] = useState("");
  const [lenMax, setLenMax] = useState("");
  const [analyzedOnly, setAnalyzedOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Debounce free-text/number inputs that hit the server; selects are immediate.
  const [debounced, setDebounced] = useState({ q: "", bpmMin: "", bpmMax: "" });
  useEffect(() => {
    const t = setTimeout(() => setDebounced({ q, bpmMin, bpmMax }), 300);
    return () => clearTimeout(t);
  }, [q, bpmMin, bpmMax]);

  const serverFilters = useMemo(
    () => ({
      q: debounced.q.trim() || undefined,
      bpm_min: debounced.bpmMin ? Number(debounced.bpmMin) : undefined,
      bpm_max: debounced.bpmMax ? Number(debounced.bpmMax) : undefined,
      camelot: camelotFilter || undefined,
    }),
    [debounced, camelotFilter],
  );

  const tracksQ = useQuery({
    queryKey: qk.djTracks(serverFilters),
    queryFn: () => api.djTracks(serverFilters),
  });

  const all = useMemo(() => (tracksQ.data?.tracks ?? []).map(normalizeTrack), [tracksQ.data]);
  const genres = useMemo(() => distinctGenres(all), [all]);

  const rows = useMemo(() => {
    const filtered = filterTracks(all, {
      genre: genre || null,
      durMin: lenMin ? Number(lenMin) * 60 : null,
      durMax: lenMax ? Number(lenMax) * 60 : null,
      analyzedOnly,
      fileState,
    });
    return sortKey ? sortTracks(filtered, sortKey, sortDir) : filtered;
  }, [all, genre, lenMin, lenMax, analyzedOnly, fileState, sortKey, sortDir]);

  const onSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("asc");
    }
  };

  return (
    <div className="space-y-3">
      <TrackFilters
        q={q}
        setQ={setQ}
        bpmMin={bpmMin}
        setBpmMin={setBpmMin}
        bpmMax={bpmMax}
        setBpmMax={setBpmMax}
        camelot={camelotFilter}
        setCamelot={setCamelotFilter}
        genre={genre}
        setGenre={setGenre}
        fileState={fileState}
        setFileState={setFileState}
        lenMin={lenMin}
        setLenMin={setLenMin}
        lenMax={lenMax}
        setLenMax={setLenMax}
        analyzedOnly={analyzedOnly}
        setAnalyzedOnly={setAnalyzedOnly}
        genres={genres}
      />
      <TrackTable
        rows={rows}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={onSort}
        inSet={inSet}
        onAdd={onAdd}
        isError={tracksQ.isError}
        isLoading={tracksQ.isLoading}
        onRetry={() => tracksQ.refetch()}
      />
    </div>
  );
}
