import { useId } from "react";
import { scaleLinear, scalePoint } from "d3-scale";
import { area, curveMonotoneX, line } from "d3-shape";
import type { HourlyPoint, SeriesPoint } from "../types";
import type { Language } from "../lib/format";
import { compactNumber, formatDate } from "../lib/format";

type Metric = keyof Pick<
  SeriesPoint,
  "distance_px" | "key_presses" | "clicks" | "active_seconds"
>;

export function SeriesChart({
  data,
  metric,
  language,
  accent = "var(--orange)",
  height = 260,
}: {
  data: SeriesPoint[];
  metric: Metric;
  language: Language;
  accent?: string;
  height?: number;
}) {
  const gradientId = useId().replaceAll(":", "");
  const width = 820;
  const padding = { left: 44, right: 18, top: 22, bottom: 38 };
  const values = data.map((point) => Number(point[metric]));
  const max = Math.max(1, ...values);
  const x = scalePoint<string>()
    .domain(data.map((point) => point.date))
    .range([padding.left, width - padding.right]);
  const y = scaleLinear()
    .domain([0, max * 1.15])
    .nice()
    .range([height - padding.bottom, padding.top]);
  const linePath = line<SeriesPoint>()
    .x((point) => x(point.date) ?? padding.left)
    .y((point) => y(Number(point[metric])))
    .curve(curveMonotoneX)(data);
  const areaPath = area<SeriesPoint>()
    .x((point) => x(point.date) ?? padding.left)
    .y0(height - padding.bottom)
    .y1((point) => y(Number(point[metric])))
    .curve(curveMonotoneX)(data);
  const ticks = y.ticks(4);

  if (data.length === 0) {
    return (
      <div className="chart-empty" style={{ height }}>
        <span>NO SIGNAL</span>
      </div>
    );
  }

  return (
    <svg
      className="series-chart"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${metric} trend from ${data[0]?.date} to ${data.at(-1)?.date}`}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={accent} stopOpacity="0.32" />
          <stop offset="100%" stopColor={accent} stopOpacity="0" />
        </linearGradient>
      </defs>
      {ticks.map((tick) => (
        <g key={tick}>
          <line
            x1={padding.left}
            x2={width - padding.right}
            y1={y(tick)}
            y2={y(tick)}
            className="chart-grid"
          />
          <text x={padding.left - 10} y={y(tick) + 4} className="chart-axis" textAnchor="end">
            {compactNumber(tick, language)}
          </text>
        </g>
      ))}
      {areaPath && <path d={areaPath} fill={`url(#${gradientId})`} />}
      {linePath && (
        <path
          d={linePath}
          fill="none"
          stroke={accent}
          strokeWidth="3"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {data.map((point) => (
        <g key={point.date}>
          <circle
            cx={x(point.date)}
            cy={y(Number(point[metric]))}
            r="4"
            fill="var(--paper)"
            stroke={accent}
            strokeWidth="2.5"
          >
            <title>
              {point.date}: {compactNumber(Number(point[metric]), language)}
            </title>
          </circle>
          <text
            x={x(point.date)}
            y={height - 12}
            textAnchor="middle"
            className="chart-axis"
          >
            {formatDate(point.date, language)}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function ActivityBand({
  data,
  language,
}: {
  data: HourlyPoint[];
  language: Language;
}) {
  const max = Math.max(1, ...data.map((point) => point.events));
  return (
    <div className="activity-band" role="img" aria-label="24 hour activity distribution">
      {data.map((point) => {
        const intensity = point.events / max;
        return (
          <div className="activity-slot" key={point.hour}>
            <div
              className="activity-bar"
              style={{
                "--intensity": intensity,
                animationDelay: `${point.hour * 18}ms`,
              } as React.CSSProperties}
              title={`${point.hour}:00 · ${compactNumber(point.events, language)}`}
            />
            {point.hour % 3 === 0 && (
              <span className="activity-hour">
                {`${point.hour}`.padStart(2, "0")}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function TraceGlyph({ hourly }: { hourly: HourlyPoint[] }) {
  const width = 440;
  const height = 250;
  const max = Math.max(1, ...hourly.map((point) => point.events));
  const points = hourly.map((point, index) => {
    const angle = (index / 24) * Math.PI * 2 - Math.PI / 2;
    const radius = 42 + (point.events / max) * 82;
    return {
      x: width / 2 + Math.cos(angle) * radius * 1.45,
      y: height / 2 + Math.sin(angle) * radius,
    };
  });
  const path = line<{ x: number; y: number }>()
    .x((point) => point.x)
    .y((point) => point.y)
    .curve(curveMonotoneX)(points);
  return (
    <svg
      className="trace-glyph"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Abstract input rhythm ring"
    >
      <circle cx={width / 2} cy={height / 2} r="104" className="trace-ring" />
      <circle cx={width / 2} cy={height / 2} r="70" className="trace-ring faint" />
      <line x1="0" x2={width} y1={height / 2} y2={height / 2} className="trace-axis" />
      <line x1={width / 2} x2={width / 2} y1="0" y2={height} className="trace-axis" />
      {path && <path d={path} className="trace-path" />}
      {points.filter((_, index) => index % 3 === 0).map((point, index) => (
        <circle key={index} cx={point.x} cy={point.y} r="3" className="trace-node" />
      ))}
      <circle cx={width / 2} cy={height / 2} r="6" className="trace-core" />
    </svg>
  );
}

export function ButtonDonut({
  items,
  language,
}: {
  items: Array<{ label: string; value: number; color: string }>;
  language: Language;
}) {
  const total = Math.max(
    1,
    items.reduce((sum, item) => sum + item.value, 0),
  );
  let offset = 0;
  const radius = 58;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="button-donut">
      <svg viewBox="0 0 150 150" role="img" aria-label="Pointer button distribution">
        <circle cx="75" cy="75" r={radius} fill="none" stroke="var(--line)" strokeWidth="15" />
        {items.map((item) => {
          const length = (item.value / total) * circumference;
          const segment = (
            <circle
              key={item.label}
              cx="75"
              cy="75"
              r={radius}
              fill="none"
              stroke={item.color}
              strokeWidth="15"
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 75 75)"
            />
          );
          offset += length;
          return segment;
        })}
      </svg>
      <div>
        <strong>{compactNumber(total, language)}</strong>
        <span>{language === "zh" ? "总点击" : "total clicks"}</span>
      </div>
    </div>
  );
}
