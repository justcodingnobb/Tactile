import { useRef, useState } from "react";
import { Download, Image, X } from "lucide-react";
import { toPng } from "html-to-image";
import type { ShareCardConfig, StatsSnapshot } from "../types";
import type { Dictionary } from "../i18n";
import type { Language } from "../lib/format";
import { ShareCard } from "./ShareCard";
import { Toggle } from "./Primitives";

export function ShareCardDialog({
  open,
  onClose,
  stats,
  config,
  onConfigChange,
  onDownload,
  language,
  dictionary: t,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  stats: StatsSnapshot;
  config: ShareCardConfig;
  onConfigChange: (config: ShareCardConfig) => void;
  onDownload: (blob: Blob) => Promise<void>;
  language: Language;
  dictionary: Dictionary;
  busy: boolean;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  if (!open) {
    return null;
  }
  const download = async () => {
    if (!cardRef.current) {
      return;
    }
    setError(null);
    try {
      const dataUrl = await toPng(cardRef.current, {
        pixelRatio: 10 / 3,
        cacheBust: true,
        backgroundColor: "#171713",
      });
      const response = await fetch(dataUrl);
      await onDownload(await response.blob());
    } catch {
      setError(t.errors.generic);
    }
  };
  return (
    <div className="dialog-scrim" role="presentation" onMouseDown={onClose}>
      <section
        className="dialog share-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="dialog-header">
          <div>
            <p className="eyebrow">EXPORT / 1080 × 1440 PNG</p>
            <h2 id="share-title">{t.actions.exportCard}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label={t.actions.close}>
            <X size={18} />
          </button>
        </header>
        <div className="share-dialog-body">
          <div className="share-preview">
            <ShareCard ref={cardRef} stats={stats} config={config} language={language} />
          </div>
          <div className="share-options">
            <label className="setting-row">
              <span>{t.settings.activeSeconds}</span>
              <Toggle
                checked={config.show_active_seconds}
                label={t.settings.activeSeconds}
                onChange={(checked) =>
                  onConfigChange({ ...config, show_active_seconds: checked })
                }
              />
            </label>
            <label className="setting-row">
              <span>{t.settings.topKey}</span>
              <Toggle
                checked={config.show_top_key}
                label={t.settings.topKey}
                onChange={(checked) =>
                  onConfigChange({ ...config, show_top_key: checked })
                }
              />
            </label>
            <label className="setting-row">
              <span>{t.settings.comparison}</span>
              <Toggle
                checked={config.show_comparison}
                label={t.settings.comparison}
                onChange={(checked) =>
                  onConfigChange({ ...config, show_comparison: checked })
                }
              />
            </label>
            <p className="fine-print">
              {language === "zh"
                ? "分享卡只包含数字与抽象图形，不包含轨迹、快捷键序列或应用信息。"
                : "This card contains numbers and abstract geometry only. No path, shortcut sequence or app identity is included."}
            </p>
            {error && <p className="form-error">{error}</p>}
            <button className="primary-button" type="button" onClick={download} disabled={busy}>
              <Image size={16} />
              {busy ? "..." : t.actions.exportCard}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

export function ExportMenu({
  onJson,
  onCsv,
  onShare,
  t,
}: {
  onJson: () => void;
  onCsv: () => void;
  onShare: () => void;
  t: Dictionary;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="export-menu">
      <button className="outline-button" type="button" onClick={() => setOpen(!open)}>
        <Download size={15} />
        {t.actions.export}
      </button>
      {open && (
        <div className="export-popover">
          <button type="button" onClick={() => { setOpen(false); onJson(); }}>
            <strong>{t.actions.exportJson}</strong>
            <span>schema v1 · .json</span>
          </button>
          <button type="button" onClick={() => { setOpen(false); onCsv(); }}>
            <strong>{t.actions.exportCsv}</strong>
            <span>6 files · .zip</span>
          </button>
          <button type="button" onClick={() => { setOpen(false); onShare(); }}>
            <strong>{t.actions.exportCard}</strong>
            <span>1080 × 1440 · .png</span>
          </button>
        </div>
      )}
    </div>
  );
}
