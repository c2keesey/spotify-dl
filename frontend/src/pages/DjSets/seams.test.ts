import type { Rating } from "@/lib/types";
import { seamFor } from "./seams";

// 4 tracks → 3 gaps → ratings has 3 entries; seam i lives between track i and i+1.
const ratings: Rating[] = ["good", "ok", "clash"];

it("returns the rating between track i and track i+1", () => {
  expect(seamFor(ratings, 0)).toBe("good");
  expect(seamFor(ratings, 1)).toBe("ok");
  expect(seamFor(ratings, 2)).toBe("clash");
});

it("returns null past the last gap (no seam after the final track)", () => {
  expect(seamFor(ratings, 3)).toBeNull();
});

it("returns null for negative indices", () => {
  expect(seamFor(ratings, -1)).toBeNull();
});

it("returns null against an empty ratings list", () => {
  expect(seamFor([], 0)).toBeNull();
});
