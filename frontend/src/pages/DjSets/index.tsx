import { useMemo, useState } from "react";
import { PanelHeader } from "@/components/PanelHeader";
import { StatusStrip } from "./StatusStrip";
import { TrackBrowser } from "./TrackBrowser";
import { SetRail } from "./SetRail";
import { CamelotWheel } from "./CamelotWheel";
import { EnergyScope } from "./EnergyScope";
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
  const inSet = useMemo(() => new Set(set.setIds), [set.setIds]);
  const toggleCamelot = (code: string) =>
    setCamelotFilter((prev) => (prev === code ? "" : code));

  return (
    <div className="space-y-8">
      <div style={{ animationDelay: "40ms" }} className="animate-[fadeUp_.4s_ease_both]">
        <h1 className="font-display text-2xl tracking-widest text-foreground">DJ SETS</h1>
        <p className="panel-label mt-2">rekordbox library · build a set</p>
      </div>

      <div style={{ animationDelay: "100ms" }} className="animate-[fadeUp_.4s_ease_both]">
        <StatusStrip outdir={outdir} />
      </div>

      <div
        style={{ animationDelay: "160ms" }}
        className="grid animate-[fadeUp_.4s_ease_both] grid-cols-1 items-start gap-8 lg:grid-cols-[3fr_2fr]"
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
    </div>
  );
}
