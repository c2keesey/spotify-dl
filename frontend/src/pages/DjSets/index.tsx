import { useMemo, useState } from "react";
import { PanelHeader } from "@/components/PanelHeader";
import { StatusStrip } from "./StatusStrip";
import { TrackBrowser } from "./TrackBrowser";
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

  return (
    <div className="space-y-8">
      <div style={{ animationDelay: "40ms" }} className="animate-[fadeUp_.4s_ease_both]">
        <h1 className="font-display text-2xl tracking-widest text-foreground">DJ SETS</h1>
        <p className="panel-label mt-2">rekordbox library · build a set</p>
      </div>

      <div style={{ animationDelay: "100ms" }} className="animate-[fadeUp_.4s_ease_both]">
        <StatusStrip outdir={outdir} />
      </div>

      <div style={{ animationDelay: "160ms" }} className="animate-[fadeUp_.4s_ease_both] space-y-3">
        <PanelHeader>Track Browser</PanelHeader>
        <TrackBrowser
          camelotFilter={camelotFilter}
          setCamelotFilter={setCamelotFilter}
          onAdd={set.add}
          inSet={inSet}
        />
      </div>
    </div>
  );
}
