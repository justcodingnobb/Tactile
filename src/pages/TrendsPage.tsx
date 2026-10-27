import { SeriesChart } from "../components/Charts";
import { Delta, EmptyState, MetricLabel, SectionHeading, Segmented } from "../components/Primitives";
import type { Dictionary } from "../i18n";
import { compactNumber, todayIso, type Language } from "../lib/format";
import type { HourlyPoint, RangePreset, StatsSnapshot } from "../types";

export type TrendMetric = "distance_px" | "key_presses" | "clicks" | "active_seconds";

export function TrendsPage({
  stats,
  language,
  t,
  empty,
  metric,
  onMetricChange,
  period,
  customStart,
  customEnd,
  onCustomStart,
  onCustomEnd,
}: {
  stats: StatsSnapshot;
  language: Language;
  t: Dictionary;
  empty: boolean;
  metric: TrendMetric;
  onMetricChange: (metric: TrendMetric) => void;
  period: RangePreset;
  customStart: string;
  customEnd: string;
  onCustomStart: (date: string) => void;
  onCustomEnd: (date: string) => void;
}) {
  const maxHour = stats.hourly.reduce<HourlyPoint | null>(
    (best, point) => (point.events > (best?.events ?? 0) ? point : best),
    null,
  );
  const hourMax = Math.max(1, ...stats.hourly.map((item) => item.events));
  return (
    <div className="page">
      <SectionHeading
        title={t.trends.title}
        subtitle={t.trends.subtitle}
        action={
          <div className="peak-badge">
            <span>{language === "zh" ? "高峰时段" : "PEAK HOUR"}</span>
            <strong>{maxHour ? `${`${maxHour.hour}`.padStart(2, "0")}:00` : "—"}</strong>
          </div>
        }
      />
      {period === "custom" && (
        <div className="date-controls paper-card">
          <label>
            <span>{language === "zh" ? "开始日期" : "Start date"}</span>
            <input
              type="date"
              value={customStart}
              max={customEnd}
              onChange={(event) => event.target.value && onCustomStart(event.target.value)}
            />
          </label>
          <label>
            <span>{language === "zh" ? "结束日期" : "End date"}</span>
            <input
              type="date"
              value={customEnd}
              min={customStart}
              max={todayIso()}
              onChange={(event) => event.target.value && onCustomEnd(event.target.value)}
            />
          </label>
          <span className="fine-print">
            {language === "zh" ? "最长可查询 5 年。" : "Ranges up to five years."}
          </span>
        </div>
      )}
      {empty ? (
        <EmptyState title={t.overview.noData} body={t.overview.noDataBody} />
      ) : (
        <>
          <section className="trend-card paper-card">
            <div className="trend-head">
              <div>
                <MetricLabel>{t.trends.daily}</MetricLabel>
                <Segmented
                  label={t.trends.daily}
                  value={metric}
                  options={[
                    { value: "distance_px", label: t.trends.distance },
                    { value: "key_presses", label: t.trends.keystrokes },
                    { value: "clicks", label: t.trends.clicks },
                    { value: "active_seconds", label: t.trends.active },
                  ]}
                  onChange={onMetricChange}
                />
              </div>
              <Delta
                language={language}
                value={
                  metric === "distance_px"
                    ? stats.comparison.distance_ratio
                    : metric === "key_presses"
                      ? stats.comparison.key_ratio
                      : metric === "clicks"
                        ? stats.comparison.click_ratio
                        : stats.comparison.active_ratio
                }
              />
            </div>
            <SeriesChart
              data={stats.series}
              metric={metric}
              language={language}
              accent={metric === "key_presses" ? "var(--lime-ink)" : "var(--orange)"}
              height={330}
            />
          </section>
          <section className="hour-card ink-card">
            <div className="card-heading">
              <MetricLabel>{t.trends.hour}</MetricLabel>
              <span className="mono-label">00 / 23</span>
            </div>
            <div className="hour-bars">
              {stats.hourly.map((point) => {
                const max = hourMax;
                return (
                  <div key={point.hour}>
                    <span
                      className="hour-bar"
                      style={{ height: `${Math.max(2, (point.events / max) * 100)}%` }}
                      title={`${point.hour}:00 · ${compactNumber(point.events, language)}`}
                    />
                    <small>{point.hour % 3 === 0 ? point.hour : ""}</small>
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
