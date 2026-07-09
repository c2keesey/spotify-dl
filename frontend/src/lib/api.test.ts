import { api, ApiError } from "./api";
import type { Job } from "./types";

describe("api", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("jobs() returns parsed JSON on 200", async () => {
    const job: Job = {
      id: 1,
      urls: ["https://open.spotify.com/track/abc"],
      output: "/tmp/out",
      status: "done",
      meta: [],
      progress: { total: 1, done: 1, failed: 0, current: "", pct: 100, failed_tracks: [], unmatched: [] },
      error: null,
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [job],
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await api.jobs();

    expect(fetchMock).toHaveBeenCalledWith("/api/jobs", undefined);
    expect(result).toEqual([job]);
  });

  it("djImport() throws ApiError with detail from a 409 body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      statusText: "Conflict",
      json: async () => ({ detail: "close rekordbox first" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.djImport("/some/path")).rejects.toMatchObject({
      status: 409,
      detail: "close rekordbox first",
    });
    await expect(api.djImport("/some/path")).rejects.toBeInstanceOf(ApiError);
  });

  it("djExport sends {name, ids} as JSON body with POST + content-type header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ playlist: "My Set" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await api.djExport("My Set", ["t1", "t2"]);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/dj/export",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "My Set", ids: ["t1", "t2"] }),
      })
    );
  });

  it("djDuplicates() GETs the duplicates endpoint and returns the parsed result", async () => {
    const result = { groups: [], exact_count: 0, fuzzy_count: 0 };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => result });
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.djDuplicates()).resolves.toEqual(result);
    expect(fetchMock).toHaveBeenCalledWith("/api/dj/duplicates", undefined);
  });

  it("djBundle returns the blob, a <stem>.crate filename, and the skipped-track header", async () => {
    const blob = new Blob(["zip"]);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "X-Skipped-Tracks": "2" }),
      blob: async () => blob,
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.djBundle("my-set")).resolves.toEqual({ blob, filename: "my-set.crate", skipped: 2 });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/dj/bundle",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ set: "my-set" }) })
    );
  });

  it("djBundle defaults skipped to 0 when the header is absent", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: new Headers(), blob: async () => new Blob([]),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.djBundle("s")).resolves.toMatchObject({ skipped: 0 });
  });

  it("djCuesXml returns the XML text and splits the unknown-ids header (empty when none)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "X-Unknown-Ids": "a,b" }),
      text: async () => "<DJ_PLAYLISTS/>",
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.djCuesXml({ order: [] })).resolves.toEqual({ xml: "<DJ_PLAYLISTS/>", unknown: ["a", "b"] });

    const noneMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: new Headers({ "X-Unknown-Ids": "" }), text: async () => "<x/>",
    });
    vi.stubGlobal("fetch", noneMock);
    await expect(api.djCuesXml({})).resolves.toMatchObject({ unknown: [] });
  });

  it("djCuesXml throws ApiError with detail on a 400", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false, status: 400, statusText: "Bad Request",
      json: async () => ({ detail: "no track ids match the library" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.djCuesXml({})).rejects.toMatchObject({ status: 400, detail: "no track ids match the library" });
  });

  it("preview URL-encodes the url param", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ url: "x", kind: null, name: null, image: null, count: null, error: null }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await api.preview("https://open.spotify.com/playlist/abc?si=123&x=y");

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/preview?url=${encodeURIComponent("https://open.spotify.com/playlist/abc?si=123&x=y")}`,
      undefined
    );
  });
});
