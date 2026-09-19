import type { MovementVolumeTrend } from "../lib/stats";

const WIDTH = 220;
const HEIGHT = 64;
const PAD = 8;
const GAP = 3;

/** How a unit reads in a caption: reps of a pull-up, seconds of a hold. */
function unitLabel(unit: MovementVolumeTrend["unit"], total: number): string {
  const word = unit === "seconds" ? "second" : "rep";
  return `${total} ${word}${total === 1 ? "" : "s"}`;
}

/**
 * One movement's volume, session by session (DN-22).
 *
 * Bars rather than a line: volume is a quantity per session, and a line
 * between two of them draws a slope through days that did not happen. Scaled
 * to this movement's own biggest session, because the card is about that
 * movement and nothing else shares its axis.
 */
function VolumeCard({ trend }: { trend: MovementVolumeTrend }) {
  const max = Math.max(...trend.points.map((p) => p.total));
  const barWidth = (WIDTH - PAD * 2 - GAP * (trend.points.length - 1)) / trend.points.length;
  const first = trend.points[0];
  const last = trend.points[trend.points.length - 1];

  return (
    <div className="p-4" style={{ background: "var(--panel-2)", border: "1px solid var(--border)" }}>
      <span className="font-semibold uppercase" style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}>
        {trend.name}
      </span>
      <svg
        role="img"
        aria-label={`Volume trend for ${trend.name}`}
        width={WIDTH}
        height={HEIGHT}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="mt-2"
      >
        {trend.points.map((point, i) => {
          const height = (point.total / max) * (HEIGHT - PAD * 2);
          return (
            <rect
              key={point.date}
              x={PAD + i * (barWidth + GAP)}
              y={HEIGHT - PAD - height}
              width={barWidth}
              height={height}
              fill="var(--glow)"
              opacity={i === trend.points.length - 1 ? 1 : 0.55}
            />
          );
        })}
      </svg>
      <div
        className="mt-1 flex items-center justify-between text-xs"
        style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", color: "var(--ink-faint)" }}
      >
        <span>{unitLabel(trend.unit, first.total)}</span>
        <span className="font-semibold" style={{ color: "var(--glow)", textShadow: "0 0 6px var(--glow-tint)" }}>
          {unitLabel(trend.unit, last.total)}
        </span>
      </div>
    </div>
  );
}

export function MovementVolumeCharts({ trends }: { trends: MovementVolumeTrend[] }) {
  if (trends.length === 0) {
    return (
      <p className="text-sm text-[var(--ink-faint)]">
        Train a prescribed movement on more than one day to see its volume here.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {trends.map((t) => (
        <VolumeCard key={t.exerciseId} trend={t} />
      ))}
    </div>
  );
}
