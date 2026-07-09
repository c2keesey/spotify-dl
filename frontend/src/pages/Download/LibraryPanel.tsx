import { useEffect, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Folder, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PanelHeader } from "@/components/PanelHeader";
import { api, ApiError } from "@/lib/api";
import { qk, queryClient } from "@/lib/queries";
import { cn } from "@/lib/utils";

/**
 * Cassette-label folder card: a colored spine strip + name plate, mono track
 * count. Green spine for playlist folders, amber for the loose "This folder".
 * Sync (when the folder has a source url) re-downloads into the current outdir.
 */
function TapeCard({ name, sub, path, url, outdir, amber }: {
  name: string; sub: string; path: string; url: string | null; outdir: string; amber?: boolean;
}) {
  const sync = useMutation({
    mutationFn: () => api.download([url!], outdir.trim()),
    onSuccess: () => { toast.success("Sync started"); queryClient.invalidateQueries({ queryKey: qk.jobs }); },
    onError: (e) => toast.error(e instanceof ApiError ? e.detail : "Sync failed"),
  });
  const reveal = useMutation({ mutationFn: () => api.reveal(path) });

  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <div className="relative grid h-9 w-9 shrink-0 place-items-end overflow-hidden rounded-sm border border-border/70 bg-secondary">
        <div className={cn("absolute inset-x-0 top-0 h-2", amber ? "bg-vfd/70" : "bg-led/70")} />
        <Folder className="mb-1 mr-1 h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-foreground">{name}</div>
        <div className="truncate font-mono text-xs tabular-nums text-muted-foreground">{sub}</div>
      </div>
      {url ? (
        <Button
          type="button" variant="outline" size="sm"
          disabled={sync.isPending}
          title="Download newly added tracks from the source"
          onClick={() => sync.mutate()}
        >
          {sync.isPending ? "Syncing…" : "Sync"}
        </Button>
      ) : null}
      <Button type="button" variant="ghost" size="sm" onClick={() => reveal.mutate()}>Reveal</Button>
    </div>
  );
}

/** Library panel: folder cards for the current outdir, refreshed when jobs settle. */
export function LibraryPanel({ outdir }: { outdir: string }) {
  const lib = useQuery({ queryKey: qk.library(outdir), queryFn: () => api.library(outdir) });
  // Read jobs from the shared cache (JobsPanel drives the poll); refresh the
  // library whenever the set of settled jobs changes (a download just finished).
  const jobs = useQuery({ queryKey: qk.jobs, queryFn: api.jobs });
  const settledSig = (jobs.data ?? [])
    .filter((j) => j.status !== "running").map((j) => j.id).sort((a, b) => a - b).join(",");
  // Skip the mount run: the library query already fetches on mount, so firing an
  // invalidate for the initial (empty) signature would just double the request.
  // Only a *change* in the settled set (a download finished) should refresh.
  const firstSig = useRef(true);
  useEffect(() => {
    if (firstSig.current) { firstSig.current = false; return; }
    queryClient.invalidateQueries({ queryKey: ["library"] });
  }, [settledSig]);

  const data = lib.data;
  const folders = (data?.folders ?? []).filter((f) => f.tracks > 0);
  const total = folders.length + (data?.loose ? 1 : 0);
  const trackWord = (n: number) => `${n} track${n === 1 ? "" : "s"}`;

  return (
    <section className="space-y-3">
      <PanelHeader
        action={
          <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={() => lib.refetch()}>
            <RotateCw className="h-3.5 w-3.5" strokeWidth={1.75} /> Refresh
          </Button>
        }
      >
        Library
      </PanelHeader>
      {total === 0 ? (
        <p className="panel-label">No downloads in this folder yet.</p>
      ) : (
        <div className="bevel divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60 bg-card">
          {folders.map((f) => (
            <TapeCard key={f.path} name={f.name} sub={trackWord(f.tracks)} path={f.path} url={f.url} outdir={outdir} />
          ))}
          {data?.loose ? (
            <TapeCard name="This folder" sub={`${trackWord(data.loose)} loose`} path={data.path} url={null} outdir={outdir} amber />
          ) : null}
        </div>
      )}
    </section>
  );
}
