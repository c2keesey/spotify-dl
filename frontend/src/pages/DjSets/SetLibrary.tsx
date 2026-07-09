import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { LedLamp } from "@/components/LedLamp";
import { PanelHeader } from "@/components/PanelHeader";
import { api, ApiError } from "@/lib/api";
import type { DjTrack, RekordboxPlaylist, SetSummary } from "@/lib/types";
import { forkFromPlaylist, openResolutionNote } from "./setResolve";

const fail = (e: unknown, fallback: string) =>
  toast.error(e instanceof ApiError ? e.detail : fallback);

/** Save a blob to disk via a throwaway object-URL anchor click (same pattern as
 *  SaveSetDialog's .xml export). Revoked immediately after the click fires. */
function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** The set name a cues.json carries, for the XML download filename. Mirrors the
 *  server's fallback (name → set → "Flightcase cues"). */
function cuesSetName(cues: unknown): string {
  const c = (cues ?? {}) as { name?: unknown; set?: unknown };
  const pick = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : "");
  return pick(c.name) || pick(c.set) || "Flightcase cues";
}

/** One saved-set row: open into the rail, rename, duplicate, delete. Exported
 *  sets carry an LED + engraved "exported" label (never colour alone). */
function SetRow({ set, onOpen, onChanged }: {
  set: SetSummary; onOpen: (tracks: DjTrack[]) => void; onChanged: () => void;
}) {
  const open = useMutation({
    mutationFn: () => api.djOpenSet(set.stem),
    onSuccess: (d) => {
      onOpen(d.tracks);
      const note = openResolutionNote(d);
      if (note) toast.warning(`Opened "${d.name}" — ${note}`);
      else toast.success(`Opened "${d.name}" (${d.tracks.length} tracks)`);
    },
    onError: (e) => fail(e, "Couldn't open set"),
  });
  const rename = useMutation({
    mutationFn: (name: string) => api.djRenameSet(set.stem, name),
    onSuccess: onChanged, onError: (e) => fail(e, "Rename failed"),
  });
  const duplicate = useMutation({
    mutationFn: () => api.djDuplicateSet(set.stem),
    onSuccess: onChanged, onError: (e) => fail(e, "Duplicate failed"),
  });
  const del = useMutation({
    mutationFn: () => api.djDeleteSet(set.stem),
    onSuccess: onChanged, onError: (e) => fail(e, "Delete failed"),
  });
  const bundle = useMutation({
    mutationFn: () => api.djBundle(set.stem),
    onSuccess: ({ blob, filename, skipped }) => {
      saveBlob(blob, filename);
      if (skipped > 0) toast.warning(`${skipped} track${skipped > 1 ? "s" : ""} skipped (missing files)`);
      else toast.success(`Bundled "${set.name}"`);
    },
    onError: (e) => fail(e, "Bundle failed"),
  });

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm text-foreground" title={set.name}>{set.name}</span>
          {set.exported && (
            <span className="flex shrink-0 items-center gap-1" title={set.rekordbox_playlist_name ?? "exported to rekordbox"}>
              <LedLamp state="on" />
              <span className="panel-label text-[0.625rem] text-led">exported</span>
            </span>
          )}
        </div>
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{set.track_count} tracks</span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button type="button" size="sm" disabled={open.isPending} onClick={() => open.mutate()}>Open</Button>
        <Button type="button" size="sm" variant="ghost" disabled={bundle.isPending} onClick={() => bundle.mutate()} title="Download a .crate bundle (audio + waveform peaks) for the Flightcase app">
          {bundle.isPending ? "Bundling…" : "Bundle"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => {
          const name = window.prompt("Rename set", set.name);
          if (name && name.trim()) rename.mutate(name.trim());
        }}>Rename</Button>
        <Button type="button" size="sm" variant="ghost" disabled={duplicate.isPending} onClick={() => duplicate.mutate()}>Duplicate</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => {
          if (window.confirm(`Delete set "${set.name}"? This removes the Crate set file only — it never touches a rekordbox playlist.`))
            del.mutate();
        }}>Delete</Button>
      </div>
    </div>
  );
}

/** One rekordbox playlist read in read-only, with a "fork into new set" action. */
function PlaylistRow({ pl, byId, onOpen }: {
  pl: RekordboxPlaylist; byId: Map<string, DjTrack>; onOpen: (tracks: DjTrack[]) => void;
}) {
  const fork = () => {
    const { tracks, dropped } = forkFromPlaylist(pl, byId);
    if (tracks.length === 0) { toast.error(`"${pl.name}" — no tracks resolved in your library`); return; }
    onOpen(tracks);
    if (dropped.length) toast.warning(`Forked "${pl.name}" — ${dropped.length} track${dropped.length > 1 ? "s" : ""} not in your library, left out.`);
    else toast.success(`Forked "${pl.name}" (${tracks.length} tracks) — save it to keep.`);
  };
  return (
    <div className="flex items-center gap-x-3 px-3 py-2">
      <Badge variant="outline" className="shrink-0 font-mono text-[10px] text-muted-foreground">read-only</Badge>
      <span className="min-w-0 flex-1 truncate text-sm text-foreground" title={pl.name}>{pl.name}</span>
      <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{pl.track_count}</span>
      <Button type="button" size="sm" variant="ghost" onClick={fork}>Fork</Button>
    </div>
  );
}

/**
 * Set library — saved Crate sets are first-class here: save the working rail,
 * reopen / rename / duplicate / delete a saved set, and fork any existing
 * rekordbox playlist into a new set. Every operation touches only Crate's own
 * files (or reads rekordbox), so the whole panel works while rekordbox is open.
 */
export function SetLibrary({ tracks, setIds, onOpen }: {
  tracks: DjTrack[]; setIds: string[]; onOpen: (tracks: DjTrack[]) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const sets = useQuery({ queryKey: ["djSets"], queryFn: api.djSets, retry: false });
  const playlists = useQuery({ queryKey: ["djPlaylists"], queryFn: api.djPlaylists, retry: false });
  const allTracks = useQuery({ queryKey: ["djTracks", {}], queryFn: () => api.djTracks({}), retry: false });
  const byId = new Map((allTracks.data?.tracks ?? []).map((t) => [t.id, t] as const));
  const refreshSets = () => qc.invalidateQueries({ queryKey: ["djSets"] });

  const save = useMutation({
    mutationFn: () => api.djSaveSet(name.trim(), setIds),
    onSuccess: () => { toast.success(`Saved "${name.trim()}"`); setName(""); refreshSets(); },
    onError: (e) => fail(e, "Save failed"),
  });

  // Import a Flightcase cues.json (edited on the plane) and get a rekordbox XML
  // back — additive, never mutates a playlist. The parsed cues are the mutation
  // variables so onSuccess can name the download from them.
  const cuesInput = useRef<HTMLInputElement>(null);
  const importCues = useMutation({
    mutationFn: (cues: unknown) => api.djCuesXml(cues),
    onSuccess: ({ xml, unknown }, cues) => {
      saveBlob(new Blob([xml], { type: "application/xml" }), `${cuesSetName(cues)} cues.xml`);
      if (unknown.length) toast.warning(`${unknown.length} track${unknown.length > 1 ? "s" : ""} not in library — omitted`);
      else toast.success("Downloaded rekordbox XML");
    },
    onError: (e) => fail(e, "Cues import failed"),
  });
  async function onCuesFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be picked again after a fix
    if (!file) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      toast.error(`Couldn't read "${file.name}" — not valid JSON.`);
      return;
    }
    importCues.mutate(parsed);
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <PanelHeader>Save current set</PanelHeader>
        <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim() && setIds.length) save.mutate(); }}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Set name" className="max-w-xs" />
          <Button type="submit" size="sm" disabled={!name.trim() || setIds.length === 0 || save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{tracks.length} in rail</span>
        </form>
      </div>

      <div className="space-y-3">
        <PanelHeader action={
          <div className="flex items-center gap-1">
            <input ref={cuesInput} type="file" accept="application/json,.json" className="hidden" onChange={onCuesFile} />
            <Button type="button" size="sm" variant="ghost" disabled={importCues.isPending} onClick={() => cuesInput.current?.click()} title="Turn a Flightcase cues.json back into a rekordbox XML (imports as a new playlist)">
              {importCues.isPending ? "Importing…" : "Import cues"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={refreshSets}>Refresh</Button>
          </div>
        }>Saved Sets</PanelHeader>
        {sets.isError ? (
          <p className="px-1 text-sm text-muted-foreground">Couldn't read saved sets.</p>
        ) : !sets.data ? (
          <p className="px-1 text-sm text-muted-foreground">Loading sets…</p>
        ) : sets.data.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/60 bg-card/40 px-4 py-6 text-center text-sm text-muted-foreground">No saved sets yet.</p>
        ) : (
          <div className="divide-y divide-border/40 rounded-lg border border-border/60 bg-card">
            {sets.data.map((s) => <SetRow key={s.stem} set={s} onOpen={onOpen} onChanged={refreshSets} />)}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <PanelHeader action={<Button type="button" size="sm" variant="ghost" onClick={() => playlists.refetch()}>Refresh</Button>}>rekordbox Playlists (read-only)</PanelHeader>
        {playlists.isError ? (
          <p className="px-1 text-sm text-muted-foreground">Couldn't read rekordbox playlists.</p>
        ) : !playlists.data ? (
          <p className="px-1 text-sm text-muted-foreground">Loading playlists…</p>
        ) : playlists.data.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/60 bg-card/40 px-4 py-6 text-center text-sm text-muted-foreground">No rekordbox playlists found.</p>
        ) : (
          <ScrollArea className="max-h-80 rounded-lg border border-border/60 bg-card">
            <div className="divide-y divide-border/40">
              {playlists.data.map((p) => <PlaylistRow key={p.id} pl={p} byId={byId} onOpen={onOpen} />)}
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}
