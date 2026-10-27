import { useEffect, useId, useRef, useState } from "react";
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
  const width = useWidth();
  const padding = { left: 52, right: 20, top: 20, bottom: 36 };
  const values = data.map((point) => Number(point[metric]));
  const max = Math.max(1, ...values);
  const x = scalePoint<string>()
    .domain(data.map((point) => point.date))
    .range([padding.left, width.value - padding.right]);
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
      <div className="chart-empty" style={{ height }} ref={width.ref}>
        <span>{language === "zh" ? "暂无数据" : "No data yet"}</span>
      </div>
    );
  }
  // Show at most ~8 date labels so they never collide.
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(width.value / 90))));

  return (
    <div className="series-chart-frame" ref={width.ref} style={{ height }}>
    <svg
      className="series-chart"
      width={width.value}
      height={height}
      viewBox={`0 0 ${width.value} ${height}`}
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
            x2={width.value - padding.right}
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
      {data.map((point, index) => (
        <g key={point.date}>
          <circle
            cx={x(point.date)}
            cy={y(Number(point[metric]))}
            r={data.length > 40 ? 0 : 3.5}
            fill="var(--paper)"
            stroke={accent}
            strokeWidth="2.5"
          >
            <title>
              {point.date}: {compactNumber(Number(point[metric]), language)}
            </title>
          </circle>
          {(index % labelEvery === 0 || index === data.length - 1) && (
            <text
              x={x(point.date)}
              y={height - 10}
              textAnchor={index === 0 ? "start" : index === data.length - 1 ? "end" : "middle"}
              className="chart-axis"
            >
              {formatDate(point.date, language)}
            </text>
          )}
        </g>
      ))}
    </svg>
    </div>
  );
}

/** Tracks an element's width so charts draw at 1:1 and text keeps its CSS size. */
function useWidth(fallback = 800) {
  const ref = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState(fallback);
  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const update = () => {
      const next = Math.round(element.clientWidth);
      if (next > 0) {
        setValue(next);
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, value };
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
      <div className="activity-bars">
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
            </div>
          );
        })}
      </div>
      <div className="activity-hours" aria-hidden="true">
        {data.map((point) => (
          <span className="activity-hour" key={point.hour}>
            {point.hour % 3 === 0 ? `${point.hour}`.padStart(2, "0") : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

export function ButtonDonut({
  items,
  language,
}: {
  items: Array<{ label: string; value: number; color: string }>;
  language: Language;
}) {
  const total = donutTotal(items);
  const denominator = Math.max(1, total);
  let offset = 0;
  const radius = 58;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="button-donut">
      <svg viewBox="0 0 150 150" role="img" aria-label="Pointer button distribution">
        <circle cx="75" cy="75" r={radius} fill="none" stroke="var(--line)" strokeWidth="15" />
        {items.map((item) => {
          const length = (item.value / denominator) * circumference;
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

export function donutTotal(items: Array<{ value: number }>): number {
  return items.reduce((sum, item) => sum + item.value, 0);
}
