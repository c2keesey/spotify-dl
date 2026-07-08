import { useMemo, useState } from "react";
import { PasteDeck } from "./PasteDeck";
import { FolderPicker } from "./FolderPicker";
import { SchedulePanel } from "./SchedulePanel";
import { CronList } from "./CronList";
import { usePreviews } from "./usePreviews";
import type { Cron } from "@/lib/types";

/**
 * Download page: paste deck (with folder picker + schedule editor mounted in its
 * bar) plus the scheduled-crons list. Links + edit state live here so the edit
 * flow can push a cron's urls/output into the deck and its fields into the panel.
 */
export function DownloadPage({ outdir, setOutdir }: { outdir: string; setOutdir: (v: string) => void }) {
  const [text, setText] = useState("");
  const [editingCron, setEditingCron] = useState<Cron | null>(null);
  const urls = useMemo(() => text.split("\n").map((s) => s.trim()).filter(Boolean), [text]);
  const preview = usePreviews(urls);

  const onEdit = (c: Cron) => {
    if (editingCron?.id === c.id) { setEditingCron(null); return; } // toggle off
    setText((c.urls ?? []).join("\n"));
    if (c.output) setOutdir(c.output);
    setEditingCron(c);
  };

  return (
    <div className="space-y-8">
      <div style={{ animationDelay: "40ms" }} className="animate-[fadeUp_.4s_ease_both]">
        <h1 className="font-display text-2xl tracking-widest text-foreground">DOWNLOAD</h1>
        <p className="panel-label mt-2">paste links · check · pull</p>
      </div>
      <div style={{ animationDelay: "100ms" }} className="animate-[fadeUp_.4s_ease_both]">
        <PasteDeck
          text={text}
          setText={setText}
          urls={urls}
          preview={preview}
          outdir={outdir}
          setOutdir={setOutdir}
          pickerSlot={
            <>
              <FolderPicker value={outdir} onChange={setOutdir} />
              <SchedulePanel validUrls={preview.validUrls} outdir={outdir} editing={editingCron} onDone={() => setEditingCron(null)} />
            </>
          }
        />
      </div>
      <div style={{ animationDelay: "160ms" }} className="animate-[fadeUp_.4s_ease_both]">
        <CronList editingId={editingCron?.id ?? null} onEdit={onEdit} />
      </div>
    </div>
  );
}
