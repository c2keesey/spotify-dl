import type { Cue } from "@/lib/types";

export type CueAction =
  | { type: "place"; num: number; start: number }
  | { type: "move"; num: number; start: number } // keeps loop length
  | { type: "clear"; num: number }
  | { type: "rename"; num: number; name: string }
  | { type: "setLoopEnd"; num: number; end: number | null }; // null = back to point cue

function sorted(cues: Cue[]): Cue[] {
  return [...cues].sort((a, b) => a.num - b.num);
}

export function cueReducer(cues: Cue[], action: CueAction): Cue[] {
  if (action.num < 0 || action.num > 7) return cues;

  const existing = cues.find((c) => c.num === action.num);

  switch (action.type) {
    case "place": {
      const next: Cue = { num: action.num, name: "", start: Math.max(0, action.start), end: null };
      return sorted([...cues.filter((c) => c.num !== action.num), next]);
    }
    case "move": {
      if (!existing) return cues;
      const start = Math.max(0, action.start);
      const end = existing.end === null ? null : start + (existing.end - existing.start);
      return sorted(cues.map((c) => (c.num === action.num ? { ...c, start, end } : c)));
    }
    case "setLoopEnd": {
      if (!existing) return cues;
      if (action.end !== null && action.end <= existing.start) return cues;
      return sorted(cues.map((c) => (c.num === action.num ? { ...c, end: action.end } : c)));
    }
    case "clear": {
      if (!existing) return cues;
      return cues.filter((c) => c.num !== action.num);
    }
    case "rename": {
      if (!existing) return cues;
      return sorted(cues.map((c) => (c.num === action.num ? { ...c, name: action.name } : c)));
    }
  }
}
