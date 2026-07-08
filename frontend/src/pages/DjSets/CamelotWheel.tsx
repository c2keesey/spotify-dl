import { useMemo } from "react";
import { camelotColor } from "@/lib/camelot";
import { WHEEL_SIZE, segmentGeometry, chordNode, type Ring } from "@/lib/wheel";
import type { DjTrack } from "@/lib/types";

const RINGS: Ring[] = ["A", "B"];

/**
 * The Camelot key wheel — 24 segments (12 numbers × A/B rings) arranged as the
 * classic harmonic-mixing clock. Keys present in the current set light to full
 * opacity with a phosphor glow and a `code·count` tally; absent keys sit dim.
 * Arrows trace the harmonic move between each consecutive pair of set tracks
 * whose keys differ. Clicking any segment toggles the browser's key filter.
 *
 * Geometry is the faithful v1 port (`@/lib/wheel`); only the presentation —
 * glow, tokens, hover — is restyled for the crate UI.
 */
export function CamelotWheel({
  tracks,
  onSegmentClick,
}: {
  tracks: DjTrack[];
  onSegmentClick: (code: string) => void;
}) {
  const { present, counts } = useMemo(() => {
    const present = new Set<string>();
    const counts: Record<string, number> = {};
    for (const t of tracks) {
      if (t.camelot) {
        present.add(t.camelot);
        counts[t.camelot] = (counts[t.camelot] ?? 0) + 1;
      }
    }
    return { present, counts };
  }, [tracks]);

  // Arrows between consecutive tracks whose keys differ (skip repeats / unkeyed).
  const arrows = useMemo(() => {
    const seq = tracks.filter((t) => t.camelot);
    const out: { x1: number; y1: number; x2: number; y2: number; key: string }[] = [];
    for (let i = 0; i < seq.length - 1; i++) {
      const a = seq[i].camelot!;
      const b = seq[i + 1].camelot!;
      if (a === b) continue;
      const [x1, y1] = chordNode(a);
      const [x2, y2] = chordNode(b);
      out.push({ x1, y1, x2, y2, key: `${i}-${a}-${b}` });
    }
    return out;
  }, [tracks]);

  return (
    <div className="rounded-lg border border-border/60 bg-card p-4">
      <svg viewBox={`0 0 ${WHEEL_SIZE} ${WHEEL_SIZE}`} width="100%" role="img" aria-label="Camelot key wheel">
        <defs>
          <marker
            id="camelot-arrow"
            viewBox="0 0 6 6"
            refX="5"
            refY="3"
            markerWidth="5"
            markerHeight="5"
            orient="auto"
          >
            <path d="M0,0 L6,3 L0,6 Z" fill="hsl(var(--foreground))" opacity="0.6" />
          </marker>
        </defs>

        {Array.from({ length: 12 }, (_, i) => i + 1).flatMap((n) =>
          RINGS.map((ring) => {
            const code = `${n}${ring}`;
            const on = present.has(code);
            const g = segmentGeometry(n, ring);
            const label = counts[code] ? `${code}·${counts[code]}` : code;
            return (
              <g key={code}>
                <path
                  d={g.path}
                  fill={camelotColor(code)}
                  opacity={on ? 1 : 0.16}
                  stroke="hsl(var(--card))"
                  strokeWidth={1.5}
                  style={{
                    cursor: "pointer",
                    filter: on ? "drop-shadow(0 0 3px hsl(var(--led) / 0.55))" : undefined,
                  }}
                  onClick={() => onSegmentClick(code)}
                />
                <text
                  x={g.labelX}
                  y={g.labelY + 3.5}
                  textAnchor="middle"
                  pointerEvents="none"
                  fontSize={10}
                  fontWeight={600}
                  fill={on ? "#fff" : "hsl(var(--muted-foreground))"}
                >
                  {label}
                </text>
              </g>
            );
          }),
        )}

        {arrows.map((a) => (
          <line
            key={a.key}
            x1={a.x1}
            y1={a.y1}
            x2={a.x2}
            y2={a.y2}
            stroke="hsl(var(--foreground))"
            strokeWidth={1.4}
            opacity={0.5}
            markerEnd="url(#camelot-arrow)"
          />
        ))}
      </svg>
    </div>
  );
}
