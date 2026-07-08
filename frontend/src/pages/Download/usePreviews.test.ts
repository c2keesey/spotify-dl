import { act, renderHook, waitFor } from "@testing-library/react";
import { api } from "@/lib/api";
import type { LinkMeta } from "@/lib/types";
import { usePreviews } from "./usePreviews";

const meta = (over: Partial<LinkMeta>): LinkMeta => ({
  url: "u", kind: "spotify", name: "Mix", image: null, count: 3, error: null, ...over,
});

afterEach(() => vi.restoreAllMocks());

it("debounces 350ms, fetches each URL once, and derives valid/total/loading", async () => {
  vi.useFakeTimers();
  const spy = vi.spyOn(api, "preview").mockImplementation(async (url) => meta({ url }));
  const urls = ["https://open.spotify.com/album/a", "https://open.spotify.com/album/b"];

  const { result, rerender } = renderHook(({ u }) => usePreviews(u), { initialProps: { u: urls } });
  expect(api.preview).not.toHaveBeenCalled(); // debounced

  await act(async () => { vi.advanceTimersByTime(350); });
  expect(spy).toHaveBeenCalledTimes(2);

  vi.useRealTimers();
  await waitFor(() => expect(result.current.validUrls).toHaveLength(2));
  expect(result.current.trackTotal).toBe(6);
  expect(result.current.anyLoading).toBe(false);

  // Re-render with identical content: no refetch of already-seen URLs.
  rerender({ u: [...urls] });
  await act(async () => {});
  expect(spy).toHaveBeenCalledTimes(2);
});

it("marks failed fetches as error rows (not valid)", async () => {
  vi.spyOn(api, "preview").mockRejectedValue(new Error("boom"));
  const { result } = renderHook(() => usePreviews(["https://open.spotify.com/x"]));
  await waitFor(() => expect(result.current.previews["https://open.spotify.com/x"]).toBeTruthy());
  const state = result.current.previews["https://open.spotify.com/x"];
  expect(state).not.toBe("loading");
  expect((state as LinkMeta).error).toBe("Couldn't check this link.");
  expect(result.current.validUrls).toHaveLength(0);
});
