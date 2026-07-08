import { jobLabel, jobView } from "./JobsPanel";
import type { Job, Progress } from "@/lib/types";

const prog = (p: Partial<Progress> = {}): Progress => ({
  total: 0, done: 0, failed: 0, current: "", pct: 0, failed_tracks: [], unmatched: [], ...p,
});
const job = (j: Partial<Job> = {}): Job => ({
  id: 1, urls: ["https://open.spotify.com/track/x"], output: "/out",
  status: "running", meta: [], progress: prog(), error: null, ...j,
});

test("jobLabel prefers meta name, falls back to shortUrl, picks first image", () => {
  const j = job({
    urls: ["https://open.spotify.com/playlist/a", "https://soundcloud.com/b/c"],
    meta: [
      { url: "https://open.spotify.com/playlist/a", kind: "spotify", name: "My Mix", image: "img.jpg", count: 10, error: null },
      { url: "https://soundcloud.com/b/c", kind: "soundcloud", name: null, image: null, count: null, error: null },
    ],
  });
  const { title, image } = jobLabel(j);
  expect(title).toBe("My Mix, soundcloud.com/b/c");
  expect(image).toBe("img.jpg");
});

test("running with no total → fetching + indeterminate", () => {
  const v = jobView(job({ status: "running", progress: prog({ total: 0 }) }));
  expect(v.running).toBe(true);
  expect(v.indeterminate).toBe(true);
  expect(v.line).toBe("Fetching tracks…");
  expect(v.count).toBe("");
  expect(v.led).toBe("warn");
});

test("running with total → current line, mono counter, meter pct", () => {
  const v = jobView(job({ status: "running", progress: prog({ total: 4, done: 2, pct: 50, current: "Artist — Song" }) }));
  expect(v.line).toBe("Artist — Song");
  expect(v.count).toBe("2 / 4");
  expect(v.pct).toBeCloseTo(((2 + 0.5) / 4) * 100); // 62.5
  expect(v.indeterminate).toBe(false);
});

test("done clean → N of M, green counter, no retry", () => {
  const v = jobView(job({ status: "done", progress: prog({ total: 3, done: 3 }) }));
  expect(v.line).toBe("3 of 3 tracks");
  expect(v.count).toBe("Done");
  expect(v.countTone).toBe("done");
  expect(v.retry).toBe(false);
  expect(v.expandable).toBe(false);
  expect(v.led).toBe("on");
});

test("done with missing → expandable, more line, failed/unmatched, note, retry", () => {
  const v = jobView(job({
    status: "done",
    progress: prog({ total: 5, done: 2, failed: 3, failed_tracks: ["A"], unmatched: ["B"] }),
  }));
  expect(v.line).toBe("2 of 5 tracks");
  expect(v.more).toBe("3 didn't make it · 1 unmatched");
  expect(v.expandable).toBe(true);
  expect(v.failed).toEqual(["A"]);
  expect(v.unmatched).toEqual(["B"]);
  expect(v.note).toBe("+1 more didn't make it."); // missing 3 > known 2
  expect(v.retry).toBe(true);
});

test("failed with error and no total → error string, retry, red", () => {
  const v = jobView(job({ status: "failed", error: "boom", progress: prog({ total: 0 }) }));
  expect(v.line).toBe("boom");
  expect(v.lineErr).toBe(true);
  expect(v.count).toBe("Failed");
  expect(v.countTone).toBe("failed");
  expect(v.retry).toBe(true);
  expect(v.led).toBe("err");
});
