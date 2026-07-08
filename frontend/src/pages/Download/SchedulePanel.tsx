import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";
import { qk, queryClient } from "@/lib/queries";
import { cn } from "@/lib/utils";
import type { Cron } from "@/lib/types";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
type Freq = "daily" | "weekly" | "hourly";

/**
 * Schedule editor (ports legacy scheduler + edit-existing-schedule). Builds the
 * same body as legacy add-sched; POST to create, PUT when `editing` is set.
 */
export function SchedulePanel({ validUrls, outdir, editing, onDone }: {
  validUrls: string[];
  outdir: string;
  editing: Cron | null;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [freq, setFreq] = useState<Freq>("daily");
  const [dow, setDow] = useState(5); // Friday
  const [time, setTime] = useState("03:00");
  const [every, setEvery] = useState(6);
  const [err, setErr] = useState<string | null>(null);

  // Seed fields from the cron under edit and pop the panel open.
  useEffect(() => {
    if (!editing) return;
    const f = editing.fields ?? { freq: "daily" as Freq, hour: 3, minute: 0 };
    setFreq(f.freq);
    if (f.freq === "weekly" && f.dow != null) setDow(f.dow);
    if (f.freq !== "hourly") setTime(`${String(f.hour ?? 3).padStart(2, "0")}:${String(f.minute ?? 0).padStart(2, "0")}`);
    if (f.freq === "hourly" && f.every) setEvery(f.every);
    setErr(null);
    setOpen(true);
  }, [editing]);

  const reset = () => { setFreq("daily"); setDow(5); setTime("03:00"); setEvery(6); setErr(null); };

  const save = useMutation({
    mutationFn: () => {
      const [hour, minute] = (time || "03:00").split(":").map(Number);
      const body = { urls: validUrls, output: outdir.trim(), freq, hour, minute, dow, every };
      return editing ? api.cronUpdate(editing.id, body) : api.cronCreate(body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.crons });
      setOpen(false);
      reset();
      onDone();
    },
    onError: () => setErr(editing ? "Couldn't save changes." : "Couldn't create schedule."),
  });

  const onAdd = () => {
    if (!validUrls.length) { setErr("Add at least one valid link above first."); return; }
    setErr(null);
    save.mutate();
  };
  const cancelEdit = () => { reset(); setOpen(false); onDone(); };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className={cn("gap-1.5", open && "text-led")}>
          <CalendarClock className="h-4 w-4" strokeWidth={1.75} /> Schedule
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={freq} onValueChange={(v) => setFreq(v as Freq)}>
            <SelectTrigger className="h-8 w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="hourly">Every few hours</SelectItem>
            </SelectContent>
          </Select>
          {freq === "weekly" ? (
            <Select value={String(dow)} onValueChange={(v) => setDow(Number(v))}>
              <SelectTrigger className="h-8 w-[120px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DAYS.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : null}
          {freq !== "hourly" ? (
            <div className="flex items-center gap-1.5">
              <span className="panel-label">at</span>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-8 w-[110px]" />
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="panel-label">every</span>
              <Input type="number" min={1} max={23} value={every} onChange={(e) => setEvery(Number(e.target.value))} className="h-8 w-16" />
              <span className="panel-label">hrs</span>
            </div>
          )}
        </div>
        <div className={cn("text-xs", err ? "text-signal" : "text-muted-foreground")}>
          {err ?? (editing ? (
            <>Editing this schedule. <button type="button" onClick={cancelEdit} className="text-led underline-offset-2 hover:underline">Cancel</button></>
          ) : "Re-downloads the links above on a repeating schedule.")}
        </div>
        <div className="flex justify-end">
          <Button type="button" size="sm" disabled={save.isPending} onClick={onAdd} className="press led-glow">
            {editing ? "Save changes" : "Add schedule"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
