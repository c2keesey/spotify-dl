import { useMemo, useState } from "react";
import { PanelHeader } from "@/components/PanelHeader";
import { Button } from "@/components/ui/button";
import { StatusStrip } from "./StatusStrip";
import { TrackBrowser } from "./TrackBrowser";
import { SetRail } from "./SetRail";
import { CamelotWheel } from "./CamelotWheel";
import { EnergyScope } from "./EnergyScope";
import { Duplicates } from "./Duplicates";
import { AuditionProvider } from "./Audition";
import { useSetState } from "./useSetState";

/**
 * DJ Sets page: rekordbox status strip over a filterable track browser. The
 * working set lives here (via useSetState) so the browser can mark added rows;
 * Task 10 adds the set rail and Task 11 the key-wheel viz that will drive
 * `camelotFilter` (lifted here for that reason).
 */
export function DjSetsPage({ outdir }: { outdir: string }) {
  const set = useSetState();
  const [camelotFilter, setCamelotFilter] = useState("");
  const [view, setView] = useState<"build" | "duplicates">("build");
  const inSet = useMemo(() => new Set(set.setIds), [set.setIds]);
  const toggleCamelot = (code: string) =>
    setCamelotFilter((prev) => (prev === code ? "" : code));

  return (
    <AuditionProvider>
    <div className="space-y-8">
      <div style={{ animationDelay: "40ms" }} className="flex flex-wrap items-end justify-between gap-4 animate-[fadeUp_.4s_ease_both]">
        <div>
          <h1 className="font-display text-2xl tracking-widest text-foreground">DJ SETS</h1>
          <p className="panel-label mt-2">rekordbox library · {view === "build" ? "build a set" : "find duplicates"}</p>
        </div>
        <div className="flex items-center gap-1 rounded-md border border-border/60 bg-card p-1">
          <Button type="button" size="sm" variant={view === "build" ? "default" : "ghost"} onClick={() => setView("build")}>Build</Button>
          <Button type="button" size="sm" variant={view === "duplicates" ? "default" : "ghost"} onClick={() => setView("duplicates")}>Duplicates</Button>
        </div>
      </div>

      {view === "duplicates" ? (
        <div style={{ animationDelay: "100ms" }} className="animate-[fadeUp_.4s_ease_both]">
          <Duplicates />
        </div>
      ) : (
      <>
      <div style={{ animationDelay: "100ms" }} className="animate-[fadeUp_.4s_ease_both]">
        <StatusStrip outdir={outdir} />
      </div>

      <div
        style={{ animationDelay: "160ms" }}
        className="grid animate-[fadeUp_.4s_ease_both] grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_360px]"
      >
        <div className="space-y-3">
          <PanelHeader>Track Browser</PanelHeader>
          <TrackBrowser
            camelotFilter={camelotFilter}
            setCamelotFilter={setCamelotFilter}
            onAdd={set.add}
            inSet={inSet}
          />
        </div>
        <div className="space-y-3">
          <PanelHeader>Set</PanelHeader>
          <SetRail
            setIds={set.setIds}
            tracks={set.tracks}
            onRemove={set.remove}
            onReorder={set.reorder}
          />
        </div>
      </div>

      <div
        style={{ animationDelay: "220ms" }}
        className="grid animate-[fadeUp_.4s_ease_both] grid-cols-1 items-start gap-8 lg:grid-cols-2"
      >
        <div className="space-y-3">
          <PanelHeader>Key Wheel</PanelHeader>
          <CamelotWheel tracks={set.tracks} onSegmentClick={toggleCamelot} />
        </div>
        <div className="space-y-3">
          <PanelHeader>Energy Scope</PanelHeader>
          <EnergyScope tracks={set.tracks} />
        </div>
      </div>
      </>
      )}
    </div>
    </AuditionProvider>
  );
}
