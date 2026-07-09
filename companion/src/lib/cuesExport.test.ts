import { buildCuesJson } from "@/lib/cuesExport";
import type { TrackCues } from "@/lib/types";

const now = new Date("2026-07-09T12:34:56.000Z");

describe("buildCuesJson", () => {
  test("produces the spec shape and parses back", () => {
    const cues: TrackCues = {
      a: [{ num: 0, name: "Intro", start: 1.5, end: null }],
    };
    const json = buildCuesJson("my-set", ["a"], cues, now);
    const parsed = JSON.parse(json);
    expect(parsed).toEqual({
      schema: 1,
      set: "my-set",
      exported_at: "2026-07-09T12:34:56.000Z",
      order: ["a"],
      tracks: [{ id: "a", cues: [{ num: 0, name: "Intro", start: 1.5, end: null }] }],
    });
  });

  test("is 2-space indented", () => {
    const json = buildCuesJson("s", [], {}, now);
    expect(json).toContain('\n  "schema": 1');
  });

  test("only includes tracks that have at least one cue", () => {
    const cues: TrackCues = {
      a: [{ num: 0, name: "", start: 0, end: null }],
      b: [],
    };
    const parsed = JSON.parse(buildCuesJson("s", ["a", "b"], cues, now));
    expect(parsed.tracks.map((t: { id: string }) => t.id)).toEqual(["a"]);
  });

  test("orders tracks by the order array first, then cue-carrying ids not in order (insertion order)", () => {
    const cues: TrackCues = {
      z: [{ num: 0, name: "", start: 0, end: null }],
      a: [{ num: 0, name: "", start: 0, end: null }],
      m: [{ num: 0, name: "", start: 0, end: null }],
    };
    // order lists only a; z and m are cue-carrying but not in order → appended in insertion order (z, m)
    const parsed = JSON.parse(buildCuesJson("s", ["a"], cues, now));
    expect(parsed.tracks.map((t: { id: string }) => t.id)).toEqual(["a", "z", "m"]);
  });

  test("sorts each track's cues by num and keeps end null for point cues", () => {
    const cues: TrackCues = {
      a: [
        { num: 5, name: "b", start: 5, end: 9 },
        { num: 1, name: "a", start: 1, end: null },
      ],
    };
    const parsed = JSON.parse(buildCuesJson("s", ["a"], cues, now));
    expect(parsed.tracks[0].cues).toEqual([
      { num: 1, name: "a", start: 1, end: null },
      { num: 5, name: "b", start: 5, end: 9 },
    ]);
  });

  test("is deterministic given the same now", () => {
    const cues: TrackCues = { a: [{ num: 0, name: "", start: 0, end: null }] };
    expect(buildCuesJson("s", ["a"], cues, now)).toBe(buildCuesJson("s", ["a"], cues, now));
  });
});
