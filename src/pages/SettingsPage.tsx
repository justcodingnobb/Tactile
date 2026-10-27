import { Download, Mouse, Pause, Play } from "lucide-react";
import { MetricLabel, SectionHeading, Segmented, StatusDot, Toggle } from "../components/Primitives";
import type { Dictionary } from "../i18n";
import { formatBytes, type Language } from "../lib/format";
import type { AppSettings, CaptureState, StatsSnapshot } from "../types";

const IS_MAC = /Mac/i.test(navigator.platform);

export function SettingsPage({
  settings,
  onSettings,
  status,
  stats,
  language,
  t,
  onTogglePause,
  onGrant,
  onDemo,
  onLeaveDemo,
  onExportJson,
  onExportCsv,
  onShare,
  onDiagnostics,
  clearConfirm,
  onClearConfirm,
  onClear,
  busy,
}: {
  settings: AppSettings;
  onSettings: (patch: Partial<AppSettings>) => Promise<void>;
  status: CaptureState;
  stats: StatsSnapshot;
  language: Language;
  t: Dictionary;
  onTogglePause: () => void;
  onGrant: () => void;
  onDemo: () => void;
  onLeaveDemo: () => void;
  onExportJson: () => void;
  onExportCsv: () => void;
  onShare: () => void;
  onDiagnostics: () => void;
  clearConfirm: boolean;
  onClearConfirm: (confirm: boolean) => void;
  onClear: () => void;
  busy: boolean;
}) {
  const demo = status.demo_mode;
  return (
    <div className="page settings-page">
      <SectionHeading
        title={t.settings.title}
        subtitle={t.settings.subtitle}
        action={<span className="beta-badge">{t.settings.beta}</span>}
      />
      <div className="settings-grid">
        <section className="setting-block paper-card">
          <MetricLabel>{t.settings.capture}</MetricLabel>
          <div className="capture-state-large">
            <StatusDot status={status.status} />
            <div>
              <strong>{t.status[status.status]}</strong>
              <p>
                {status.secure_input
                  ? language === "zh"
                    ? "检测到安全输入状态，键盘事件暂不统计。"
                    : "Secure input is active; keyboard events are skipped."
                  : language === "zh"
                    ? "进程内采集 · 本地落盘 · 无内容捕获"
                    : "In-process capture · local storage · no content capture"}
                {status.status === "storage_error" && status.message && (
                  <span className="setting-status">{status.message}</span>
                )}
              </p>
            </div>
            <button
              className="outline-button"
              type="button"
              onClick={onTogglePause}
              disabled={demo}
            >
              {status.status === "paused" ? <Play size={14} /> : <Pause size={14} />}
              {status.status === "paused" ? t.actions.resume : t.actions.pause}
            </button>
          </div>
          {status.status === "permission_required" && (
            <button className="primary-button" type="button" onClick={onGrant}>
              {t.actions.grant}
            </button>
          )}
        </section>

        <section className="setting-block paper-card">
          <MetricLabel>{t.settings.appearance}</MetricLabel>
          <div className="setting-row">
            <span>{t.settings.theme}</span>
            <Segmented
              label={t.settings.theme}
              value={settings.theme}
              options={[
                { value: "system", label: t.settings.system },
                { value: "light", label: t.settings.light },
                { value: "dark", label: t.settings.dark },
              ]}
              onChange={(theme) => void onSettings({ theme })}
            />
          </div>
          <div className="setting-row">
            <span>{t.settings.language}</span>
            <Segmented
              label={t.settings.language}
              value={settings.language}
              options={[
                { value: "system", label: t.settings.system },
                { value: "zh", label: t.settings.chinese },
                { value: "en", label: t.settings.english },
              ]}
              onChange={(nextLanguage) => void onSettings({ language: nextLanguage })}
            />
          </div>
        </section>

        <section className="setting-block paper-card">
          <MetricLabel>{t.settings.behavior}</MetricLabel>
          <label className="setting-row">
            <span>{t.settings.autostart}</span>
            <Toggle
              checked={settings.launch_at_login}
              label={t.settings.autostart}
              onChange={(checked) => void onSettings({ launch_at_login: checked })}
            />
          </label>
          <label className="setting-row">
            <span>{t.settings.shortcuts}</span>
            <Toggle
              checked={settings.shortcuts_enabled}
              label={t.settings.shortcuts}
              onChange={(checked) => void onSettings({ shortcuts_enabled: checked })}
            />
          </label>
          <label className="setting-row">
            <span>
              {t.settings.updates}
              <small className="setting-status">{t.settings.updatesSoon}</small>
            </span>
            <Toggle
              checked={settings.check_updates}
              label={t.settings.updates}
              onChange={(checked) => void onSettings({ check_updates: checked })}
              disabled
            />
          </label>
          <p className="fine-print">
            {IS_MAC ? "⌘ ⇧ P · ⌘ ⇧ T" : "Ctrl ⇧ P · Ctrl ⇧ T"} ·{" "}
            {language === "zh" ? "暂停/继续 · 打开窗口" : "pause/resume · show window"}
          </p>
          {status.shortcut_error && (
            <p className="form-error">
              {language === "zh"
                ? "部分快捷键已被其他应用占用。"
                : "Some shortcuts are taken by another app."}
            </p>
          )}
        </section>

        <section className="setting-block paper-card">
          <MetricLabel>{t.settings.privacy}</MetricLabel>
          <p className="setting-copy">{t.settings.privacyBody}</p>
          <dl className="data-facts">
            <div>
              <dt>{t.settings.database}</dt>
              <dd>{formatBytes(stats.data_coverage?.database_bytes ?? 0)}</dd>
            </div>
            <div>
              <dt>{t.settings.retention}</dt>
              <dd>{t.settings.retentionBody}</dd>
            </div>
            <div>
              <dt>{language === "zh" ? "采集范围" : "Captured"}</dt>
              <dd>
                {language === "zh"
                  ? "键位 · 按下次数 · 组合键比例 · 点击网格"
                  : "Keys · press counts · shortcut ratio · click grid"}
              </dd>
            </div>
          </dl>
          <button className="outline-button" type="button" onClick={onDiagnostics}>
            <Download size={14} />
            {t.actions.diagnostics}
          </button>
        </section>

        <section className="setting-block paper-card">
          <MetricLabel>{t.settings.demo}</MetricLabel>
          <p className="setting-copy">{t.settings.demoBody}</p>
          {demo ? (
            <button className="outline-button" type="button" onClick={onLeaveDemo}>
              <Mouse size={14} />
              {t.actions.real}
            </button>
          ) : (
            <button className="outline-button" type="button" onClick={onDemo}>
              <Mouse size={14} />
              {t.actions.demo}
            </button>
          )}
        </section>

        <section className="setting-block paper-card">
          <MetricLabel>{t.settings.exportCenter}</MetricLabel>
          <p className="setting-copy">{t.settings.exportBody}</p>
          <div className="inline-actions">
            <button className="outline-button" type="button" onClick={onExportJson}>
              JSON
            </button>
            <button className="outline-button" type="button" onClick={onExportCsv}>
              CSV / ZIP
            </button>
            <button className="outline-button" type="button" onClick={onShare}>
              PNG
            </button>
          </div>
        </section>

        <section className="setting-block danger-block paper-card">
          <MetricLabel>{t.settings.danger}</MetricLabel>
          <p className="setting-copy">{t.settings.dangerBody}</p>
          {demo ? (
            <p className="fine-print">
              {language === "zh"
                ? "演示模式下不修改真实数据。"
                : "Demo mode never modifies real data."}
            </p>
          ) : clearConfirm ? (
            <div className="danger-confirm">
              <p>
                {language === "zh"
                  ? "确认清除全部本地统计？此操作在应用内不可恢复。"
                  : "Clear all local statistics? This cannot be recovered in the app."}
              </p>
              <button className="danger-button" type="button" onClick={onClear} disabled={busy}>
                {busy ? "..." : t.actions.confirmClear}
              </button>
              <button className="text-button" type="button" onClick={() => onClearConfirm(false)}>
                {t.actions.cancel}
              </button>
            </div>
          ) : (
            <button className="danger-outline" type="button" onClick={() => onClearConfirm(true)}>
              {t.actions.clear}
            </button>
          )}
        </section>
      </div>
    </div>
  );
}
