import type { DjStatus } from "@/lib/types";
import { buildReadouts, nothingToDo, writeDisabledReason } from "./statusReadouts";

const status = (over: Partial<DjStatus> = {}): DjStatus => ({
  running: false,
  can_write: true,
  analyzed: 0,
  pending: 0,
  not_imported: 0,
  missing: 0,
  unmounted: 0,
  not_a_file: 0,
  ...over,
});

describe("buildReadouts", () => {
  it("drops zero counts and keeps only what's present", () => {
    const readouts = buildReadouts(status({ analyzed: 500, missing: 740 }));
    expect(readouts.map((r) => r.key)).toEqual(["analyzed", "missing"]);
    expect(readouts.map((r) => r.count)).toEqual([500, 740]);
  });

  it("orders actionable counts (pending, not_imported) ahead of informational ones", () => {
    const readouts = buildReadouts(status({ analyzed: 10, pending: 3, not_imported: 2, missing: 5, not_a_file: 1 }));
    expect(readouts.map((r) => r.key)).toEqual(["pending", "not_imported", "analyzed", "missing", "not_a_file"]);
  });

  it("gives every actionable count an explicit next action and leaves informational ones without one", () => {
    const byKey = Object.fromEntries(
      buildReadouts(status({ pending: 1, not_imported: 1, unmounted: 1, analyzed: 1, missing: 1, not_a_file: 1 })).map(
        (r) => [r.key, r],
      ),
    );
    expect(byKey.pending.action).toBeTruthy();
    expect(byKey.not_imported.action).toBeTruthy();
    expect(byKey.unmounted.action).toBeTruthy();
    expect(byKey.analyzed.action).toBeNull();
    expect(byKey.missing.action).toBeNull();
    expect(byKey.not_a_file.action).toBeNull();
  });

  it("labels unmounted as UNMOUNTED and never as missing, and says the drive is not deleted", () => {
    const [u] = buildReadouts(status({ unmounted: 4 }));
    expect(u.label).toBe("UNMOUNTED");
    expect(u.label).not.toMatch(/missing/i);
    expect(u.meaning.toLowerCase()).toContain("not deleted");
  });

  it("presents not_a_file as a streaming entry, not an error", () => {
    const [s] = buildReadouts(status({ not_a_file: 186 }));
    expect(s.label).toBe("STREAMING");
    expect(s.meaning.toLowerCase()).toContain("not an error");
  });

  it("every readout carries a non-empty meaning (nothing is hover-only)", () => {
    const readouts = buildReadouts(status({ pending: 1, not_imported: 1, unmounted: 1, analyzed: 1, missing: 1, not_a_file: 1 }));
    expect(readouts).toHaveLength(6);
    for (const r of readouts) expect(r.meaning.trim().length).toBeGreaterThan(0);
  });

  it("returns nothing when every count is zero", () => {
    expect(buildReadouts(status())).toEqual([]);
  });
});

describe("nothingToDo", () => {
  it("is true only when both pending and not_imported are zero", () => {
    expect(nothingToDo(status({ analyzed: 500, missing: 740 }))).toBe(true);
    expect(nothingToDo(status({ pending: 1 }))).toBe(false);
    expect(nothingToDo(status({ not_imported: 1 }))).toBe(false);
    expect(nothingToDo(status({ pending: 2, not_imported: 3 }))).toBe(false);
  });

  it("ignores missing/unmounted/not_a_file — those aren't work the user can do here", () => {
    expect(nothingToDo(status({ missing: 740, unmounted: 12, not_a_file: 186 }))).toBe(true);
  });
});

describe("writeDisabledReason", () => {
  it("returns null when rekordbox is closed", () => {
    expect(writeDisabledReason(status({ running: false }))).toBeNull();
  });

  it("explains that writes are paused because rekordbox is running", () => {
    const reason = writeDisabledReason(status({ running: true }));
    expect(reason).toBeTruthy();
    expect(reason!.toLowerCase()).toContain("rekordbox");
    expect(reason!.toLowerCase()).toContain("import");
  });
});
