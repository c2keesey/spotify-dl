export type TrackMeta = {
  id: string;
  title: string;
  artist: string;
  bpm: number | null;
  key_name: string;
  camelot: string;
  genre: string;
  duration: number | null;
  audio: string;
  peaks: string;
  peaks_rate: number;
};

export type Manifest = {
  schema: 1;
  set: string;
  name: string;
  created_at: string;
  order: string[];
  tracks: TrackMeta[];
};

export type Cue = { num: number; name: string; start: number; end: number | null };

export type TrackCues = Record<string, Cue[]>; // trackId -> cues

export type StoredSet = {
  stem: string;
  name: string;
  manifest: Manifest;
  order: string[];
  importedAt: string;
};
