import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CAMELOT_CODES } from "@/lib/camelot";
import type { FileStateFilter } from "@/lib/trackSort";

const ANY = "__any__";

const FILE_STATE_OPTIONS: { value: FileStateFilter; label: string }[] = [
  { value: "any", label: "Any file" },
  { value: "present", label: "Present" },
  { value: "missing", label: "Missing" },
  { value: "unmounted", label: "Unmounted" },
  { value: "not_a_file", label: "Streaming" },
];

export type FilterUi = {
  q: string;
  setQ: (v: string) => void;
  bpmMin: string;
  setBpmMin: (v: string) => void;
  bpmMax: string;
  setBpmMax: (v: string) => void;
  camelot: string;
  setCamelot: (v: string) => void;
  genre: string;
  setGenre: (v: string) => void;
  fileState: FileStateFilter;
  setFileState: (v: FileStateFilter) => void;
  lenMin: string;
  setLenMin: (v: string) => void;
  lenMax: string;
  setLenMax: (v: string) => void;
  analyzedOnly: boolean;
  setAnalyzedOnly: (v: boolean) => void;
  genres: string[];
};

/**
 * The full filter bar for the track browser. Search / BPM / Camelot drive the
 * server query; genre / duration / analyzed-only / file state filter the cached
 * list client-side. All compose, and Camelot stays in sync with the key wheel.
 */
export function TrackFilters(p: FilterUi) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        value={p.q}
        onChange={(e) => p.setQ(e.target.value)}
        placeholder="Search title or artist"
        className="h-9 max-w-56"
        aria-label="Search title or artist"
      />
      <Input
        value={p.bpmMin}
        onChange={(e) => p.setBpmMin(e.target.value)}
        type="number"
        inputMode="numeric"
        placeholder="BPM min"
        className="h-9 w-24 font-mono tabular-nums"
        aria-label="Minimum BPM"
      />
      <Input
        value={p.bpmMax}
        onChange={(e) => p.setBpmMax(e.target.value)}
        type="number"
        inputMode="numeric"
        placeholder="BPM max"
        className="h-9 w-24 font-mono tabular-nums"
        aria-label="Maximum BPM"
      />
      <Select value={p.camelot || ANY} onValueChange={(v) => p.setCamelot(v === ANY ? "" : v)}>
        <SelectTrigger className="h-9 w-28" aria-label="Camelot key">
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
      <Select value={p.genre || ANY} onValueChange={(v) => p.setGenre(v === ANY ? "" : v)}>
        <SelectTrigger className="h-9 w-36" aria-label="Genre">
          <SelectValue placeholder="Any genre" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>Any genre</SelectItem>
          {p.genres.map((g) => (
            <SelectItem key={g} value={g}>
              {g}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={p.fileState} onValueChange={(v) => p.setFileState(v as FileStateFilter)}>
        <SelectTrigger className="h-9 w-32" aria-label="File state">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FILE_STATE_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex items-center gap-1">
        <Input
          value={p.lenMin}
          onChange={(e) => p.setLenMin(e.target.value)}
          type="number"
          inputMode="numeric"
          placeholder="min"
          className="h-9 w-16 font-mono tabular-nums"
          aria-label="Minimum length in minutes"
        />
        <span className="panel-label">–</span>
        <Input
          value={p.lenMax}
          onChange={(e) => p.setLenMax(e.target.value)}
          type="number"
          inputMode="numeric"
          placeholder="max"
          className="h-9 w-16 font-mono tabular-nums"
          aria-label="Maximum length in minutes"
        />
        <span className="panel-label ml-1">min</span>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
        <Switch checked={p.analyzedOnly} onCheckedChange={p.setAnalyzedOnly} aria-label="Analyzed only" />
        Analyzed only
      </label>
    </div>
  );
}
