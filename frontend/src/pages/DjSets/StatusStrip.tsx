import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { LedLamp } from "@/components/LedLamp";
import { VuMeter } from "@/components/VuMeter";
import { api, ApiError } from "@/lib/api";
import { qk, queryClient } from "@/lib/queries";

/**
 * DJ status strip: rekordbox open/closed LED + state text, a mini VU of the
 * analysis backlog, and an Import button when the outdir has un-imported mp3s.
 * Polls status every 5s while mounted (the page unmounts on tab switch, so the
 * poll naturally stops). A DB-unreachable error renders a designed empty state
 * with a Retry button rather than looping toasts.
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
  if (status.isError) {
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
  const running = s?.running ?? false;
  const analyzed = s?.analyzed ?? 0;
  const pending = s?.pending ?? 0;
  const denom = analyzed + pending;
  const pct = denom ? (analyzed / denom) * 100 : 100;

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-lg border border-border/60 bg-card px-4 py-3">
      <div className="flex items-center gap-2.5">
        <LedLamp state={running ? "warn" : "on"} />
        <span className="text-sm text-foreground">
          {running ? "REKORDBOX OPEN — analyzing" : "REKORDBOX CLOSED — writable"}
        </span>
      </div>

      {pending > 0 ? (
        <div className="flex items-center gap-2.5">
          <VuMeter pct={pct} count={16} />
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {pending} pending analysis
          </span>
        </div>
      ) : null}

      <div className="flex-1" />

      {s && s.not_imported > 0 ? (
        running ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <Button type="button" size="sm" disabled>
                    Import {s.not_imported} new
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>Close rekordbox first</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          <Button type="button" size="sm" disabled={doImport.isPending} onClick={() => doImport.mutate()}>
            {doImport.isPending ? "Importing…" : `Import ${s.not_imported} new`}
          </Button>
        )
      ) : null}
    </div>
  );
}
