import { forwardRef } from "react";
import type { ShareCardConfig, StatsSnapshot } from "../types";
import type { Language } from "../lib/format";
import {
  compactNumber,
  formatDistance,
  formatDuration,
  formatRatio,
} from "../lib/format";

export const ShareCard = forwardRef<
  HTMLDivElement,
  {
    stats: StatsSnapshot;
    config: ShareCardConfig;
    language: Language;
  }
>(function ShareCard({ stats, config, language }, ref) {
  const topKey = stats.keys[0];
  return (
    <div className="share-card" ref={ref} data-testid="share-card">
      <div className="share-orbit orbit-a" />
      <div className="share-orbit orbit-b" />
      <header>
        <span>指痕 · TACTILE</span>
        <span>{language === "zh" ? "只在本机" : "LOCAL ONLY"}</span>
      </header>
      <div className="share-main">
        <p>{language === "zh" ? "鼠标累计距离" : "MOUSE DISTANCE"}</p>
        <div className="share-distance">
          <strong>{formatDistance(stats.totals.distance_km, language)}</strong>
          <span>KM</span>
        </div>
        <div className="share-metrics">
          <div>
            <span>{language === "zh" ? "击键" : "KEYS"}</span>
            <strong>{compactNumber(stats.totals.key_presses, language)}</strong>
          </div>
          <div>
            <span>{language === "zh" ? "点击" : "CLICKS"}</span>
            <strong>{compactNumber(stats.totals.clicks, language)}</strong>
          </div>
          {config.show_active_seconds && (
            <div>
              <span>{language === "zh" ? "活跃" : "ACTIVE"}</span>
              <strong>{formatDuration(stats.totals.active_seconds, language)}</strong>
            </div>
          )}
          {config.show_top_key && topKey && (
            <div>
              <span>{language === "zh" ? "最高频键" : "TOP KEY"}</span>
              <strong>{topKey.label}</strong>
            </div>
          )}
        </div>
        {config.show_comparison && (
          <p className="share-comparison">
            {language === "zh" ? "较上一周期" : "VS PREVIOUS"} ·{" "}
            {formatRatio(stats.comparison.distance_ratio)}
          </p>
        )}
      </div>
      <footer>
        <span>{language === "zh" ? "输入，被安静地测量。" : "INPUT, MEASURED QUIETLY."}</span>
        <span>NO CONTENT CAPTURED</span>
      </footer>
    </div>
  );
});
