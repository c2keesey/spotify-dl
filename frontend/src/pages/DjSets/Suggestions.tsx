import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "@/lib/api";
import { qk } from "@/lib/queries";
import { camelotColor } from "@/lib/camelot";
import { signedDelta } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Rating, Suggestion } from "@/lib/types";
import { useSetState } from "./useSetState";
import { suggestGate } from "./suggestGate";

/** Rating → LED colour + spoken word. The word is the meaning; colour only
 * decorates it, so the rating is never carried by colour alone. */
const RATING: Record<Rating, { color: string; word: string }> = {
  good: { color: "hsl(var(--led))", word: "Strong match" },
  ok: { color: "hsl(var(--vfd))", word: "Workable" },
  clash: { color: "hsl(var(--signal-red))", word: "Stretch" },
};

/** An empty/explanatory state that fills the panel with text, never a blank. */
function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border/60 bg-card/40 px-4 py-10 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

/** One candidate row: what it is, WHY it scored (relation + signed BPM delta),
 * and an add action. Reasoning is text; add is an explicit click. */
function Row({ s, added, onAdd }: { s: Suggestion; added: boolean; onAdd: () => void }) {
  const t = s.track;
  const rating = RATING[s.rating];
  return (
    <div className="bevel flex items-center gap-3 rounded-md border border-border/60 bg-card px-3 py-2">
      {t.camelot ? (
        <Badge className="shrink-0 border-transparent font-mono text-white" style={{ background: camelotColor(t.camelot) }}>
          {t.camelot}
        </Badge>
      ) : (
        <span className="w-9 shrink-0 text-center text-muted-foreground">—</span>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-foreground" title={t.title}>{t.title}</div>
        <div className="truncate text-xs text-muted-foreground" title={t.artist}>{t.artist}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: rating.color, boxShadow: `0 0 4px 0 ${rating.color}` }}
            aria-hidden
          />
          <span className="text-foreground/80">{rating.word}</span>
          <span aria-hidden>·</span>
          <span className="truncate">{s.relation}</span>
        </div>
      </div>
      <span className="shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
        <span className="block">{t.bpm != null ? t.bpm.toFixed(1) : "—"}</span>
        <span className="block text-[10px] text-muted-foreground/70" title="BPM change from the last slot">
          {s.bpm_delta != null ? `${signedDelta(s.bpm_delta)} BPM` : "BPM —"}
        </span>
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 shrink-0"
        disabled={added}
        onClick={onAdd}
        aria-label={`Add ${t.title} to the set`}
      >
        {added ? "Added" : <><Plus className="h-3.5 w-3.5" /> Set</>}
      </Button>
    </div>
  );
}

/**
 * Suggestions panel: what could play next after the set's LAST slot, ranked by
 * harmonic + tempo compatibility. It RECOMMENDS — it never reorders the set and
 * never adds anything on its own; each row's add button is the only way in. Every
 * candidate shows its reasoning (key relation + signed BPM delta), not a bare
 * score, so the ranking is legible and therefore trustworthy. Empty set or an
 * unscoreable last slot → an explanatory note, never a blank panel.
 */
export function Suggestions() {
  const { setIds, tracks, add } = useSetState();
  const gate = useMemo(() => suggestGate(tracks), [tracks]);

  const q = useQuery({
    queryKey: qk.djSuggest(setIds),
    queryFn: () => api.djSuggest(setIds),
    enabled: gate.canSuggest,
  });

  if (!gate.canSuggest) return <Note>{gate.reason}</Note>;
  if (q.isError) {
    return (
      <Note>
        <div className="flex flex-col items-center gap-3">
          <span>Couldn't load suggestions from the rekordbox library.</span>
          <Button type="button" variant="outline" size="sm" onClick={() => q.refetch()}>Retry</Button>
        </div>
      </Note>
    );
  }
  const suggestions = q.data?.suggestions ?? [];
  if (q.isLoading) return <Note>Finding tracks that mix with your last slot…</Note>;
  if (suggestions.length === 0) {
    return <Note>No analyzed tracks left to mix with your last slot.</Note>;
  }

  const last = tracks[tracks.length - 1];
  return (
    <div className="space-y-3">
      <p className="panel-label">
        Next after <span className="text-foreground">{last?.title}</span>
      </p>
      <ScrollArea className={cn("max-h-[420px] rounded-lg")}>
        <div className="space-y-2 pr-2">
          {suggestions.map((s) => (
            <Row key={s.track.id} s={s} added={setIds.includes(s.track.id)} onAdd={() => add(s.track)} />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
