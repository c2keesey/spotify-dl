import type { StoredSet, TrackCues } from "@/lib/types";

const DB_NAME = "flightcase";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const idb = req.result;
      if (!idb.objectStoreNames.contains("sets")) idb.createObjectStore("sets", { keyPath: "stem" });
      if (!idb.objectStoreNames.contains("cues")) idb.createObjectStore("cues");
      if (!idb.objectStoreNames.contains("peaks")) idb.createObjectStore("peaks");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (idb) =>
      new Promise<T>((resolve, reject) => {
        const t = idb.transaction(store, mode);
        const req = run(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const db = {
  putSet(s: StoredSet): Promise<void> {
    return tx<IDBValidKey>("sets", "readwrite", (store) => store.put(s)).then(() => undefined);
  },
  getSet(stem: string): Promise<StoredSet | undefined> {
    return tx<StoredSet | undefined>("sets", "readonly", (store) => store.get(stem));
  },
  listSets(): Promise<StoredSet[]> {
    return tx<StoredSet[]>("sets", "readonly", (store) => store.getAll());
  },
  deleteSet(stem: string): Promise<void> {
    return tx<undefined>("sets", "readwrite", (store) => store.delete(stem)).then(() => undefined);
  },
  putCues(stem: string, cues: TrackCues): Promise<void> {
    return tx<IDBValidKey>("cues", "readwrite", (store) => store.put(cues, stem)).then(() => undefined);
  },
  getCues(stem: string): Promise<TrackCues> {
    return tx<TrackCues | undefined>("cues", "readonly", (store) => store.get(stem)).then((c) => c ?? {});
  },
  putPeaks(stem: string, trackId: string, peaks: Uint8Array): Promise<void> {
    return tx<IDBValidKey>("peaks", "readwrite", (store) => store.put(peaks, `${stem}/${trackId}`)).then(
      () => undefined,
    );
  },
  getPeaks(stem: string, trackId: string): Promise<Uint8Array | undefined> {
    return tx<Uint8Array | undefined>("peaks", "readonly", (store) => store.get(`${stem}/${trackId}`));
  },
};
