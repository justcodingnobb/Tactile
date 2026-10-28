import { ArrowUpCircle, RefreshCw } from "lucide-react";
import type { Dictionary } from "../i18n";
import type { UpdatePhase } from "../lib/updater";

export function UpdateBanner({
  phase,
  notesOpen,
  onNotes,
  onInstall,
  onDismiss,
  onRestart,
  version,
  t,
}: {
  phase: UpdatePhase;
  notesOpen: boolean;
  onNotes: () => void;
  onInstall: () => void;
  onDismiss: () => void;
  onRestart: () => void;
  version: string | null;
  t: Dictionary;
}) {
  const visibleVersion = version ?? "";
  if (phase.kind !== "available" && phase.kind !== "downloading" && phase.kind !== "ready") {
    return null;
  }
  return (
    <div className="banner banner-info update-banner" role="status">
      <ArrowUpCircle size={18} />
      <div className="update-banner-copy">
        <strong>
          {t.updates.available.replace("{version}", visibleVersion)}
        </strong>
        {phase.kind === "downloading" && (
          <span>
            {t.updates.downloading}
            {phase.progress !== null && ` ${Math.round(phase.progress * 100)}%`}
          </span>
        )}
        {phase.kind === "ready" && <span>{t.updates.ready}</span>}
        {notesOpen && phase.kind === "available" && (
          <pre className="update-notes">{phase.notes || t.updates.noNotes}</pre>
        )}
      </div>
      {phase.kind === "available" && (
        <div className="update-banner-actions">
          <button className="text-button" type="button" onClick={onNotes}>
            {t.updates.whatsNew}
          </button>
          <button className="outline-button" type="button" onClick={onInstall}>
            {t.updates.install}
          </button>
          <button className="text-button" type="button" onClick={onDismiss}>
            {t.updates.later}
          </button>
        </div>
      )}
      {phase.kind === "downloading" && (
        <span className="update-progress" aria-hidden="true">
          <i style={{ width: `${(phase.progress ?? 0) * 100}%` }} />
        </span>
      )}
      {phase.kind === "ready" && (
        <button className="primary-button" type="button" onClick={onRestart}>
          <RefreshCw size={14} />
          {t.updates.restart}
        </button>
      )}
    </div>
  );
}
