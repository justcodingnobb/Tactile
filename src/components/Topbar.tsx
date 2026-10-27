import { Pause, Play } from "lucide-react";
import { ExportMenu } from "./ExportDialog";
import { StatusDot } from "./Primitives";
import type { Dictionary } from "../i18n";
import type { CaptureState, RangePreset } from "../types";

const periodValues: RangePreset[] = ["today", "week", "month", "year", "custom"];

export function Topbar({
  period,
  onPeriodChange,
  status,
  statusLabel,
  t,
  onPause,
  onExportJson,
  onExportCsv,
  onShare,
  demo,
  onLeaveDemo,
  hidden,
}: {
  period: RangePreset;
  onPeriodChange: (period: RangePreset) => void;
  status: CaptureState;
  statusLabel: string;
  t: Dictionary;
  onPause: () => void;
  onExportJson: () => void;
  onExportCsv: () => void;
  onShare: () => void;
  demo: boolean;
  onLeaveDemo: () => void;
  hidden: boolean;
}) {
  if (hidden) {
    return null;
  }
  const paused = status.status === "paused";
  return (
    <header className="topbar">
      <div className="period-switcher" role="radiogroup" aria-label={t.periods.label}>
        {periodValues.map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={period === value}
            className={period === value ? "is-active" : ""}
            onClick={() => onPeriodChange(value)}
          >
            {t.periods[value]}
          </button>
        ))}
      </div>
      <div className="topbar-actions">
        {demo && (
          <button className="demo-pill" type="button" onClick={onLeaveDemo}>
            DEMO · {t.actions.real}
          </button>
        )}
        {!demo && (
          <span className={`status-pill status-${status.status}`} role="status">
            <StatusDot status={status.status} />
            {statusLabel}
          </span>
        )}
        <button
          className="icon-button pause-button"
          type="button"
          onClick={onPause}
          disabled={demo}
          aria-label={paused ? t.actions.resume : t.actions.pause}
          title={paused ? t.actions.resume : t.actions.pause}
        >
          {paused ? <Play size={16} /> : <Pause size={16} />}
        </button>
        <ExportMenu
          onJson={onExportJson}
          onCsv={onExportCsv}
          onShare={onShare}
          t={t}
        />
      </div>
    </header>
  );
}
