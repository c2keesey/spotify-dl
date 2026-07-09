import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, ChevronUp, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { qk } from "@/lib/queries";

const RECENTS_KEY = "recentDirs";
const readRecents = (): string[] => {
  try { return JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]"); } catch { return []; }
};
const pushRecent = (path: string) => {
  const list = [path, ...readRecents().filter((p) => p !== path)].slice(0, 5);
  localStorage.setItem(RECENTS_KEY, JSON.stringify(list));
};
const baseName = (p: string) => p.split("/").pop() || p;

/**
 * Native-first folder picker (ports legacy pickFolderNative/openPicker/browseTo).
 * Browse → OS dialog via api.pickFolder; on 501 (non-macOS) or any failure we
 * fall back to an in-browser ⌘K-style Dialog that walks api.browse.
 */
export function FolderPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const config = useQuery({ queryKey: qk.config, queryFn: api.config });
  const places = config.data?.places ?? [];
  const defaultOut = config.data?.default_output ?? "";

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [path, setPath] = useState("");
  const [dirs, setDirs] = useState<string[]>([]);
  const [parent, setParent] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const browseTo = async (target: string) => {
    try {
      const r = await api.browse(target);
      setPath(r.path);
      setDirs(r.dirs);
      setParent(r.parent);
      setFilter("");
    } catch { /* keep current view on failure */ }
  };
  const enterFolder = (name: string) => browseTo(path.replace(/\/$/, "") + "/" + name);

  const openDialog = async () => {
    setOpen(true);
    await browseTo(value.trim() || defaultOut);
  };
  const commit = (p: string) => { onChange(p); pushRecent(p); };

  const onBrowseClick = async () => {
    setBusy(true);
    try {
      const r = await api.pickFolder(value.trim() || defaultOut);
      if (r.cancelled) return;
      if (r.path) commit(r.path);
    } catch {
      openDialog(); // 501 / dialog failure → in-browser fallback
    } finally {
      setBusy(false);
    }
  };

  const useThisFolder = () => { commit(path); setOpen(false); };
  const recents = readRecents();

  return (
    <>
      <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onBrowseClick} className="gap-1.5">
        <FolderOpen className="h-4 w-4" strokeWidth={1.75} /> Browse
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[470px]">
          <DialogTitle className="sr-only">Choose output folder</DialogTitle>
          <Command filter={(v, s) => (v.toLowerCase().includes(s.toLowerCase()) ? 1 : 0)} className="rounded-none bg-transparent">
            <div className="flex items-center gap-1 border-b border-border/60 pl-2">
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" disabled={!parent} title="Up one level" aria-label="Up one level" onClick={() => parent && browseTo(parent)}>
                <ChevronUp className="h-4 w-4" />
              </Button>
              <CommandInput value={filter} onValueChange={setFilter} placeholder="Filter folders…" className="border-0" />
            </div>
            <div className="truncate border-b border-border/60 px-3 py-2 font-mono text-xs text-muted-foreground">{path || "…"}</div>
            {places.length || recents.length ? (
              <div className="flex flex-wrap gap-1.5 border-b border-border/60 px-3 py-2">
                {places.map((p) => <Chip key={p.path} label={p.label} onClick={() => browseTo(p.path)} />)}
                {recents.length ? <span className="panel-label w-full pt-1">Recent</span> : null}
                {recents.map((p) => <Chip key={p} label={baseName(p)} onClick={() => browseTo(p)} />)}
              </div>
            ) : null}
            <CommandList className="max-h-[38vh] p-1">
              <CommandEmpty className="py-6 text-center text-sm text-muted-foreground">
                No subfolders{filter ? " match" : " here"}.
              </CommandEmpty>
              {dirs.map((d) => (
                <CommandItem key={d} value={d} onSelect={() => enterFolder(d)} className="cursor-pointer gap-2 font-mono text-sm">
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> {d}
                </CommandItem>
              ))}
            </CommandList>
            <div className="flex items-center justify-end gap-2 border-t border-border/60 p-3">
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="button" size="sm" onClick={useThisFolder} className="press led-glow">Use this folder</Button>
            </div>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Chip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-border/70 bg-secondary/40 px-2.5 py-1 text-xs text-foreground transition-colors hover:border-led/50 hover:text-led"
    >
      {label}
    </button>
  );
}
