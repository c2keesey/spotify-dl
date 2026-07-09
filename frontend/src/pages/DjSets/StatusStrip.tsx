import type { ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { LedLamp } from "@/components/LedLamp";
import { VuMeter } from "@/components/VuMeter";
import { api, ApiError } from "@/lib/api";
import { qk, queryClient } from "@/lib/queries";
import { buildReadouts, nothingToDo, writeDisabledReason, type Readout } from "./statusReadouts";

/**
 * DJ status strip: rekordbox open/closed LED, then a self-explaining readout for
 * every non-zero library count. Each count states in plain text what it means
 * and — when it's asking something of the user — the explicit next move, so a
 * first-time user can read the strip and know what to do without hovering
 * anything. LED colour is decoration on top of that text, never the sole signal.
 * Polls status every 5s while mounted; a DB-unreachable error renders a designed
 * empty state with Retry rather than looping toasts.
 */
export function StatusStrip({ outdir }: { outdir: string }) {
  const status = useQuery({
    queryKey: qk.djStatus(outdir),
    queryFn: () => api.djStatus(outdir),
    refetchInterval: 5000,
    retry: false,
  });

  const doImport = useMutation({
    mutationFn: () => api.djImport(outdir),
    onSuccess: (r) => {
      const skipped = r.skipped_duplicates.length;
      const reasons = [...new Set(r.skipped_duplicates.map((d) => d.reason))].slice(0, 3);
      toast.success(
        `Imported ${r.imported.length} · ${skipped} dup${skipped === 1 ? "" : "s"} skipped`,
        reasons.length ? { description: reasons.join(" · ") } : undefined,
      );
      queryClient.invalidateQueries({ queryKey: ["djStatus"] });
      queryClient.invalidateQueries({ queryKey: ["djTracks"] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.detail : "Import failed"),
  });

  // DB unreachable → designed empty state, not a toast loop.
  if (status.isError || !status.data) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-card px-4 py-3">
        <LedLamp state="off" />
        <span className="text-sm text-muted-foreground">Can't read the rekordbox database.</span>
        <div className="flex-1" />
        <Button type="button" variant="outline" size="sm" onClick={() => status.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  const s = status.data;
  const readouts = buildReadouts(s);
  const idle = nothingToDo(s);
  const disabledReason = writeDisabledReason(s);
  const denom = s.analyzed + s.pending;
  const analysisPct = denom ? (s.analyzed / denom) * 100 : 100;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-card px-4 py-3">
      {/* rekordbox power state + why writes are on or off */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="flex items-center gap-2.5">
          <LedLamp state={s.running ? "warn" : "on"} />
          <span className="panel-label">{s.running ? "Rekordbox open" : "Rekordbox closed"}</span>
        </span>
        <span className="text-xs text-muted-foreground">
          {disabledReason ?? "Crate can write to your rekordbox collection."}
        </span>
      </div>

      {/* readouts — one self-describing cell per non-zero count */}
      <div className="flex flex-wrap gap-2">
        {idle ? (
          <ReadoutCell
            led="on"
            label="NOTHING TO DO"
            count={null}
            meaning="Nothing is waiting on rekordbox and nothing is waiting to be imported — your library is current."
            action={null}
          />
        ) : null}

        {readouts.map((r) => (
          <ReadoutCell key={r.key} led={r.led} label={r.label} count={r.count} meaning={r.meaning} action={r.action}>
            {r.key === "pending" ? (
              <div className="mt-2">
                <VuMeter pct={analysisPct} count={16} />
              </div>
            ) : null}
            {r.key === "not_imported" ? (
              <div className="mt-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={s.running || doImport.isPending}
                  onClick={() => doImport.mutate()}
                >
                  {doImport.isPending ? "Importing…" : `Import ${r.count} new`}
                </Button>
                {s.running ? (
                  <p className="mt-1 text-xs text-vfd">Paused while rekordbox is open.</p>
                ) : null}
              </div>
            ) : null}
          </ReadoutCell>
        ))}
      </div>
    </div>
  );
}

/**
 * One instrument-panel readout: LED lamp + count + engraved label, then the
 * plain-language meaning and (when present) the explicit next action, all as
 * visible text. `count` is null for the affirmative "nothing to do" cell.
 */
function ReadoutCell({
  led,
  label,
  count,
  meaning,
  action,
  children,
}: Pick<Readout, "led" | "label" | "meaning" | "action"> & { count: number | null; children?: ReactNode }) {
  return (
    <div className="flex min-w-[15rem] max-w-xs flex-1 items-start gap-2.5 rounded-md border border-border/40 bg-secondary/40 bevel px-3 py-2">
      <LedLamp state={led} className="mt-[7px]" />
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          {count !== null ? (
            <span className="font-mono text-sm tabular-nums text-foreground">{count.toLocaleString()}</span>
          ) : null}
          <span className="panel-label">{label}</span>
        </div>
        <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{meaning}</p>
        {action ? (
          <p className="mt-1 text-xs leading-snug text-foreground/90">
            <span className="panel-label mr-1 text-[0.625rem] text-vfd">Next</span>
            {action}
          </p>
        ) : null}
        {children}
      </div>
    </div>
  );
}
