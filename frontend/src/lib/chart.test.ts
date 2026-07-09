import { buildChart, energyAbsenceReason, type EnergyDatum } from "@/lib/chart";
import type { DjTrack } from "@/lib/types";

const t = (id: string, bpm: number | null): DjTrack => ({
  id,
  title: `T${id}`,
  artist: "A",
  bpm,
  key_name: null,
  camelot: null,
  genre: null,
  file_path: `/m/${id}.mp3`,
  file_state: "missing",
  duration: 200,
  status: "analyzed",
  playlists: [],
});

const NO_ENERGY = new Map<string, EnergyDatum>();

it("builds a BPM chart with ZERO energy values (the missing-file reality)", () => {
  const tracks = [t("a", 120), t("b", 126), t("c", 124)];
  const c = buildChart(tracks, NO_ENERGY);
  expect(c.kind).toBe("chart");
  if (c.kind !== "chart") return;
  expect(c.segments).toHaveLength(1); // one unbroken run
  expect(c.dots).toHaveLength(3);
  expect(c.energy.shown).toBe(false);
});

it("is empty only when fewer than 2 tracks have a BPM", () => {
  expect(buildChart([t("a", 120)], NO_ENERGY).kind).toBe("empty");
  expect(buildChart([t("a", null), t("b", 120)], NO_ENERGY).kind).toBe("empty");
  expect(buildChart([t("a", 120), t("b", 122)], NO_ENERGY).kind).toBe("chart");
});

it("breaks the line at a null BPM instead of interpolating through it", () => {
  const tracks = [t("a", 120), t("b", null), t("c", 128)];
  const c = buildChart(tracks, NO_ENERGY);
  if (c.kind !== "chart") throw new Error("expected chart");
  expect(c.segments).toHaveLength(2); // two runs, one per side of the gap
  expect(c.dots).toHaveLength(2); // no dot for the null slot
});

it("emits a per-transition delta only across present BPM pairs", () => {
  const tracks = [t("a", 120), t("b", 126), t("c", null), t("d", 130)];
  const c = buildChart(tracks, NO_ENERGY);
  if (c.kind !== "chart") throw new Error("expected chart");
  // a->b present (+6); b->c and c->d each touch the null slot => skipped.
  expect(c.deltas.map((d) => d.label)).toEqual(["+6"]);
});

it("labels the axis with the real BPM range", () => {
  const c = buildChart([t("a", 118), t("b", 132)], NO_ENERGY);
  if (c.kind !== "chart") throw new Error("expected chart");
  expect(c.axis.lo).toBe(118);
  expect(c.axis.hi).toBe(132);
});

it("shows the energy overlay once 2+ files are measured", () => {
  const tracks = [t("a", 120), t("b", 124), t("c", 128)];
  const energy = new Map<string, EnergyDatum>([
    ["a", { value: -9, state: "measured" }],
    ["b", { value: -7, state: "measured" }],
    ["c", { value: null, state: "missing" }],
  ]);
  const c = buildChart(tracks, energy);
  if (c.kind !== "chart") throw new Error("expected chart");
  expect(c.energy.shown).toBe(true);
});

it("explains WHY energy is absent, distinguishing missing from failed", () => {
  const tracks = [t("a", 120), t("b", 124), t("c", 128)];
  const allMissing = new Map<string, EnergyDatum>(
    tracks.map((x) => [x.id, { value: null, state: "missing" as const }]),
  );
  expect(energyAbsenceReason(tracks, allMissing)).toBe(
    "Energy overlay hidden — 3 of 3 files not found on disk.",
  );

  const mixed = new Map<string, EnergyDatum>([
    ["a", { value: null, state: "missing" }],
    ["b", { value: null, state: "failed" }],
    ["c", { value: null, state: "missing" }],
  ]);
  expect(energyAbsenceReason(tracks, mixed)).toBe(
    "Energy overlay hidden — 2 of 3 files not found on disk, 1 could not be analyzed.",
  );
});

it("stays quiet (no reason) while measurement is still pending", () => {
  const tracks = [t("a", 120), t("b", 124)];
  expect(energyAbsenceReason(tracks, NO_ENERGY)).toBe("");
});
