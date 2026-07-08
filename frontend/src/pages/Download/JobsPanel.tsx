import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { PanelHeader } from "@/components/PanelHeader";
import { LedLamp } from "@/components/LedLamp";
import { VuMeter } from "@/components/VuMeter";
import { api } from "@/lib/api";
import { qk, queryClient } from "@/lib/queries";
import { cn } from "@/lib/utils";
import type { Job } from "@/lib/types";

const shortUrl = (u: string) => {
  try {
    const p = new URL(u);
    return p.hostname.replace("www.", "").replace("open.", "") + p.pathname;
  } catch { return u; }
};

/** Title from server-resolved meta names (fallback shortUrl); cover from first meta with art. */
export function jobLabel(j: Job): { title: string; image: string | null } {
  const metas = (j.meta ?? []).filter(Boolean);
  const names = j.urls.map((u) => metas.find((m) => m.url === u)?.name || shortUrl(u));
  return { title: names.join(", "), image: metas.find((m) => m.image)?.image ?? null };
}

export type JobView = {
  led: "on" | "warn" | "err";
  running: boolean;
  indeterminate: boolean;
  line: string;
  lineErr: boolean;
  more: string | null;
  count: string;
  countTone: "" | "done" | "failed";
  pct: number;
  expandable: boolean;
  failed: string[];
  unmatched: string[];
  note: string | null;
  retry: boolean;
};

/** Pure port of legacy renderStatus — derives everything the card renders from a job. */
export function jobView(j: Job): JobView {
  const p = j.progress;
  const led = j.status === "running" ? "warn" : j.status === "done" ? "on" : "err";
  const base: JobView = {
    led, running: false, indeterminate: false, line: "", lineErr: false, more: null,
    count: "", countTone: "", pct: 0, expandable: false, failed: [], unmatched: [], note: null, retry: false,
  };

  if (j.status === "running") {
    if (!p.total) return { ...base, running: true, indeterminate: true, line: "Fetching tracks…" };
    return {
      ...base, running: true, line: p.current || "Starting downloads…",
      count: `${p.done} / ${p.total}`,
      pct: Math.min(100, ((p.done + p.pct / 100) / p.total) * 100),
    };
  }

  const retry = j.status === "failed" || (p.failed || 0) > 0;
  const count = j.status === "failed" ? "Failed" : "Done";
  const countTone = j.status as "done" | "failed";

  if (j.status === "failed" && j.error && !p.total) {
    return { ...base, line: j.error, lineErr: true, count, countTone, retry };
  }

  const missing = p.failed || 0;
  const line = p.total ? `${p.done} of ${p.total} track${p.total === 1 ? "" : "s"}` : "Done";
  if (missing <= 0) return { ...base, line, count, countTone, retry };

  const failed = p.failed_tracks || [];
  const unmatched = p.unmatched || [];
  const more = `${missing} didn't make it` + (unmatched.length ? ` · ${unmatched.length} unmatched` : "");
  const known = failed.length + unmatched.length;
  const note = missing > known ? `${known ? "+" : ""}${missing - known} more didn't make it.` : null;
  return { ...base, line, more, count, countTone, retry, expandable: true, failed, unmatched, note };
}

const ART = "relative h-10 w-10 shrink-0 overflow-hidden rounded-md border border-border/70 bg-secondary bg-cover bg-center";

function JobCard({ job, open, onToggle, onRetry, retrying }: {
  job: Job; open: boolean; onToggle: () => void; onRetry: () => void; retrying: boolean;
}) {
  const { title, image } = jobLabel(job);
  const v = jobView(job);
  const clickable = v.expandable;

  return (
    <div className="px-4 py-3">
      <div
        className={cn("flex items-center gap-3", clickable && "cursor-pointer select-none")}
        onClick={clickable ? onToggle : undefined}
      >
        <div className={ART} style={image ? { backgroundImage: `url('${image}')` } : undefined}>
          {!image && <span className="grid h-full w-full place-items-center text-muted-foreground">♪</span>}
          <LedLamp
            state={v.led}
            className={cn("absolute -bottom-0.5 -right-0.5 ring-2 ring-card", v.led === "warn" && "motion-safe:animate-pulse")}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm text-foreground">{title}</div>
          <div className={cn("truncate text-xs", v.lineErr ? "whitespace-normal text-signal" : "text-muted-foreground")}>
            {v.line}
            {v.more ? <> · <span className="text-vfd">{v.more}</span></> : null}
          </div>
        </div>
        {v.count ? (
          <div className={cn(
            "shrink-0 font-mono text-xs tabular-nums",
            v.countTone === "done" ? "text-led" : v.countTone === "failed" ? "text-signal" : "text-muted-foreground",
          )}>
            {v.count}
          </div>
        ) : null}
        {v.retry ? (
          <Button
            type="button" variant="outline" size="sm"
            disabled={retrying}
            onClick={(e) => { e.stopPropagation(); onRetry(); }}
          >
            {retrying ? "Retrying…" : "Retry"}
          </Button>
        ) : null}
      </div>

      {v.running ? (
        <VuMeter pct={v.pct} indeterminate={v.indeterminate} className="mt-2.5 pl-[52px]" />
      ) : null}

      {v.expandable ? (
        <Collapsible open={open}>
          <CollapsibleContent className="pl-[52px]">
            <div className="mt-2 divide-y divide-border/50 border-t border-border/50">
              {v.failed.map((n, i) => (
                <div key={`f${i}`} className="flex items-center gap-2 py-1.5 text-xs text-muted-foreground">
                  <span className="shrink-0 font-semibold text-signal">×</span>
                  <span className="truncate">{n}</span>
                </div>
              ))}
              {v.unmatched.map((n, i) => (
                <div key={`u${i}`} className="flex items-center gap-2 py-1.5 text-xs text-muted-foreground/80">
                  <span className="shrink-0 font-semibold text-vfd">?</span>
                  <span className="truncate">{n}</span>
                  <span className="ml-auto shrink-0 rounded-full bg-vfd/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-vfd">
                    no YouTube match
                  </span>
                </div>
              ))}
              {v.note ? <div className="pt-1.5 text-xs text-muted-foreground/60">{v.note}</div> : null}
            </div>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  );
}

/** Downloads panel: 1.5s poll, newest-first job cards with the VU meter as hero. */
export function JobsPanel() {
  const jobs = useQuery({ queryKey: qk.jobs, queryFn: api.jobs, refetchInterval: 1500 });
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const toggle = (id: number) =>
    setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const retry = useMutation({
    mutationFn: (id: number) => api.retry(id),
    onSuccess: ({ id }) => {
      setExpanded((s) => new Set(s).add(id));
      queryClient.invalidateQueries({ queryKey: qk.jobs });
    },
  });

  const list = jobs.data ?? [];

  return (
    <section className="space-y-3">
      <PanelHeader>Downloads</PanelHeader>
      {list.length === 0 ? (
        <p className="panel-label">Nothing yet.</p>
      ) : (
        <div className="bevel divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60 bg-card">
          {list.map((j) => (
            <JobCard
              key={j.id}
              job={j}
              open={expanded.has(j.id)}
              onToggle={() => toggle(j.id)}
              onRetry={() => retry.mutate(j.id)}
              retrying={retry.isPending && retry.variables === j.id}
            />
          ))}
        </div>
      )}
    </section>
  );
}
