import type { TrackCues } from "@/lib/types";

export function buildCuesJson(setStem: string, order: string[], cues: TrackCues, now: Date): string {
  const hasCues = (id: string): boolean => Array.isArray(cues[id]) && cues[id].length > 0;

  const orderSet = new Set(order);
  const orderedIds = order.filter(hasCues);
  const extraIds = Object.keys(cues).filter((id) => hasCues(id) && !orderSet.has(id));
  const ids = [...orderedIds, ...extraIds];

  const tracks = ids.map((id) => ({
    id,
    cues: [...cues[id]]
      .sort((a, b) => a.num - b.num)
      .map((c) => ({ num: c.num, name: c.name, start: c.start, end: c.end })),
  }));

  return JSON.stringify(
    {
      schema: 1,
      set: setStem,
      exported_at: now.toISOString(),
      order,
      tracks,
    },
    null,
    2,
  );
}
