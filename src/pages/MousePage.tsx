import { ArrowDown, ArrowUp } from "lucide-react";
import { ButtonDonut, SeriesChart } from "../components/Charts";
import { ClickHeatmapCanvas } from "../components/ClickHeatmap";
import { Delta, EmptyState, MetricLabel, SectionHeading } from "../components/Primitives";
import type { Dictionary } from "../i18n";
import { compactNumber, formatDistance, type Language } from "../lib/format";
import type { Heatmap, PointerButton, StatsSnapshot } from "../types";

const BUTTON_COLORS: Record<PointerButton, string> = {
  left: "var(--orange)",
  right: "var(--ink)",
  middle: "var(--lime-ink)",
  side1: "var(--muted)",
  side2: "var(--line-strong)",
  other_side: "var(--paper-deep)",
};

export function buttonLabel(button: PointerButton, language: Language): string {
  const zh: Record<PointerButton, string> = {
    left: "左键",
    right: "右键",
    middle: "中键",
    side1: "侧键 1",
    side2: "侧键 2",
    other_side: "其他",
  };
  const en: Record<PointerButton, string> = {
    left: "Left",
    right: "Right",
    middle: "Middle",
    side1: "Side 1",
    side2: "Side 2",
    other_side: "Other",
  };
  return (language === "zh" ? zh : en)[button];
}

export function MousePage({
  stats,
  heatmap,
  language,
  t,
  empty,
}: {
  stats: StatsSnapshot;
  heatmap: Heatmap;
  language: Language;
  t: Dictionary;
  empty: boolean;
}) {
  // Hide buttons that were never pressed so the legend stays readable.
  const buttons = stats.buttons.filter((button) => button.count > 0);
  const outside = Math.max(0, stats.totals.clicks - heatmap.filtered_total);
  return (
    <div className="page">
      <SectionHeading title={t.mouse.title} subtitle={t.mouse.subtitle} />
      {empty ? (
        <EmptyState title={t.overview.noData} body={t.overview.noDataBody} />
      ) : (
        <div className="mouse-layout">
          <section className="mouse-summary paper-card">
            <MetricLabel>{t.overview.eyebrow}</MetricLabel>
            <div className="distance-readout">
              <span className="distance-number">
                {formatDistance(stats.totals.distance_km, language)}
              </span>
              {stats.totals.distance_km >= 0.1 && <span className="distance-unit">KM</span>}
            </div>
            <p className="muted">{t.overview.distanceCaption}</p>
            <Delta value={stats.comparison.distance_ratio} language={language} />
          </section>
          <section className="mouse-buttons paper-card">
            <MetricLabel>{t.mouse.buttons}</MetricLabel>
            <ButtonDonut
              language={language}
              items={buttons.map((button) => ({
                label: buttonLabel(button.button, language),
                value: button.count,
                color: BUTTON_COLORS[button.button],
              }))}
            />
            <div className="button-legend">
              {buttons.map((button) => (
                <div key={button.button}>
                  <span style={{ background: BUTTON_COLORS[button.button] }} />
                  <span>{buttonLabel(button.button, language)}</span>
                  <strong>{compactNumber(button.count, language)}</strong>
                </div>
              ))}
            </div>
          </section>
          <section className="wheel-card ink-card">
            <MetricLabel>{t.mouse.wheel}</MetricLabel>
            <div className="wheel-numbers">
              <div>
                <ArrowUp size={20} />
                <strong>{compactNumber(Math.round(stats.totals.wheel_up), language)}</strong>
                <span>{t.mouse.up}</span>
              </div>
              <div>
                <ArrowDown size={20} />
                <strong>{compactNumber(Math.round(stats.totals.wheel_down), language)}</strong>
                <span>{t.mouse.down}</span>
              </div>
            </div>
          </section>
          <section className="click-terrain paper-card">
            <div className="card-heading">
              <div>
                <MetricLabel>{t.mouse.heatmap}</MetricLabel>
                <p>{t.mouse.heatmapNote}</p>
              </div>
              <div className="heatmap-totals">
                <span>{t.mouse.loadedClicks}</span>
                <strong>{compactNumber(heatmap.filtered_total, language)}</strong>
                {outside > 0 && (
                  <small>
                    {t.mouse.outside} · {compactNumber(outside, language)}
                  </small>
                )}
              </div>
            </div>
            <ClickHeatmapCanvas heatmap={heatmap} language={language} />
          </section>
          <section className="mouse-trend paper-card">
            <MetricLabel>{t.trends.daily}</MetricLabel>
            <SeriesChart
              data={stats.series}
              metric="distance_px"
              language={language}
              accent="var(--orange)"
            />
          </section>
        </div>
      )}
    </div>
  );
}
