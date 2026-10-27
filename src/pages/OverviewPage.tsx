import { ActivityBand } from "../components/Charts";
import { ClickHeatmapCanvas } from "../components/ClickHeatmap";
import { Delta, EmptyState, MetricLabel, SectionHeading } from "../components/Primitives";
import type { Dictionary } from "../i18n";
import {
  compactNumber,
  formatDateRange,
  formatDistance,
  formatDuration,
  type Language,
} from "../lib/format";
import type { Heatmap, StatsSnapshot } from "../types";

export function OverviewPage({
  stats,
  heatmap,
  language,
  t,
  empty,
  onOpenKeyboard,
  onOpenMouse,
}: {
  stats: StatsSnapshot;
  heatmap: Heatmap;
  language: Language;
  t: Dictionary;
  empty: boolean;
  onOpenKeyboard: () => void;
  onOpenMouse: () => void;
}) {
  const topKey = stats.keys[0];
  const range = stats.range;
  return (
    <div className="page overview-page">
      <SectionHeading
        title={t.nav.overview}
        subtitle={
          range ? formatDateRange(range.start_local_day, range.end_local_day, language) : undefined
        }
      />

      {empty ? (
        <EmptyState title={t.overview.noData} body={t.overview.noDataBody} />
      ) : (
        <>
          <article className="distance-card paper-card">
            <div className="distance-layout">
              <div className="distance-summary">
                <MetricLabel>{t.overview.eyebrow}</MetricLabel>
                <div className="distance-readout">
                  <span className="distance-number">
                    {formatDistance(stats.totals.distance_km, language)}
                  </span>
                  {stats.totals.distance_km >= 0.1 && (
                    <span className="distance-unit">KM</span>
                  )}
                </div>
                <div className="distance-footer">
                  <p>{t.overview.distanceCaption}</p>
                  <Delta value={stats.comparison.distance_ratio} language={language} />
                </div>
              </div>
              <section className="overview-heatmap-panel">
                <div className="overview-heatmap-head">
                  <MetricLabel>{t.mouse.heatmap}</MetricLabel>
                  <div className="overview-heatmap-meta">
                    <span className="overview-heatmap-total">
                      <strong>{compactNumber(heatmap.filtered_total, language)}</strong>{" "}
                      {t.mouse.clicksUnit}
                    </span>
                    <button className="text-button" type="button" onClick={onOpenMouse}>
                      {t.mouse.details} →
                    </button>
                  </div>
                </div>
                <ClickHeatmapCanvas heatmap={heatmap} language={language} compact />
              </section>
            </div>
          </article>

          <section className="metrics-strip">
            <MetricTile
             
              label={t.overview.keys}
              value={compactNumber(stats.totals.key_presses, language)}
              unit={t.units.keys}
              delta={stats.comparison.key_ratio}
              language={language}
            />
            <MetricTile
             
              label={t.overview.clicks}
              value={compactNumber(stats.totals.clicks, language)}
              unit={t.units.clicks}
              delta={stats.comparison.click_ratio}
              language={language}
            />
            <MetricTile
             
              label={t.overview.active}
              value={formatDuration(stats.totals.active_seconds, language)}
              unit={t.units.sessions}
              delta={stats.comparison.active_ratio}
              language={language}
            />
            <MetricTile
             
              label={t.overview.shortcuts}
              value={`${(stats.totals.shortcut_ratio * 100).toFixed(1)}%`}
              unit={`${compactNumber(stats.totals.shortcut_presses, language)} ${language === "zh" ? "次" : "presses"}`}
              delta={null}
              language={language}
            />
          </section>

          <section className="lower-grid">
            <article className="activity-card paper-card">
              <div className="card-heading">
                <div>
                  <MetricLabel>{t.overview.activity}</MetricLabel>
                  <p>{t.overview.activitySub}</p>
                </div>
                <span className="mono-label">00 — 23 H</span>
              </div>
              <ActivityBand data={stats.hourly} language={language} />
            </article>
            <article className="paper-card key-list-card">
              <div className="card-heading">
                <MetricLabel>{t.overview.topKeys}</MetricLabel>
                <button className="text-button" type="button" onClick={onOpenKeyboard}>
                  {t.keyboard.view} →
                </button>
              </div>
              {stats.keys.slice(0, 6).map((key) => {
                const max = topKey?.count || 1;
                return (
                  <div className="key-rank-row" key={key.key_id}>
                    <span className="key-name">{key.label}</span>
                    <div className="key-bar">
                      <span style={{ width: `${(key.count / max) * 100}%` }} />
                    </div>
                    <strong>{compactNumber(key.count, language)}</strong>
                  </div>
                );
              })}
            </article>
          </section>
        </>
      )}
    </div>
  );
}

function MetricTile({
  label,
  value,
  unit,
  delta,
  language,
}: {
  label: string;
  value: string;
  unit: string;
  delta: number | null;
  language: Language;
}) {
  return (
    <article className="metric-tile paper-card">
      <MetricLabel>{label}</MetricLabel>
      <strong className="metric-value">{value}</strong>
      <div className="metric-bottom">
        <span>{unit}</span>
        <Delta value={delta} language={language} />
      </div>
    </article>
  );
}
