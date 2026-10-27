import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, ShieldAlert } from "lucide-react";
import { Sidebar } from "./components/Sidebar";
import { Onboarding } from "./components/Onboarding";
import { ShareCardDialog } from "./components/ExportDialog";
import { Topbar } from "./components/Topbar";
import { Toast, useToast } from "./components/Toast";
import { useDashboard } from "./hooks/useDashboard";
import { useAppControl } from "./hooks/useAppControl";
import { OverviewPage } from "./pages/OverviewPage";
import { MousePage } from "./pages/MousePage";
import { KeyboardPage } from "./pages/KeyboardPage";
import { TrendsPage, type TrendMetric } from "./pages/TrendsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { resolveLanguage, todayIso } from "./lib/format";
import { dictionary } from "./i18n";
import { previewSection } from "./lib/ipc";
import type { AppSection, RangePreset, ShareCardConfig, StatsRequest } from "./types";

const SECTIONS: AppSection[] = ["overview", "mouse", "keyboard", "trends", "settings"];
const initialSection: AppSection = SECTIONS.includes(previewSection as AppSection)
  ? (previewSection as AppSection)
  : "overview";
import "./styles.css";

function App() {
  const [section, setSection] = useState<AppSection>(initialSection);
  const [period, setPeriod] = useState<RangePreset>("week");
  const [customStart, setCustomStart] = useState(todayIso);
  const [customEnd, setCustomEnd] = useState(todayIso);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareConfig, setShareConfig] = useState<ShareCardConfig>({
    show_active_seconds: false,
    show_top_key: true,
    show_comparison: false,
  });
  const [clearConfirm, setClearConfirm] = useState(false);
  const [trendMetric, setTrendMetric] = useState<TrendMetric>("distance_px");
  const toast = useToast();

  const control = useAppControl(toast.show);
  const { settings, status, ready } = control;
  const language = resolveLanguage(settings.language);
  const t = dictionary(language);
  const demo = status.demo_mode;

  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  }, [language]);

  const request = useMemo<StatsRequest>(
    () => (period === "custom" ? { start: customStart, end: customEnd } : { preset: period }),
    [period, customStart, customEnd],
  );
  const dashboard = useDashboard(request, demo ? "demo" : "real");
  const { stats, heatmap } = dashboard;
  const live = !demo && status.status === "active";
  const isEmpty =
    !demo &&
    stats.totals.key_presses === 0 &&
    stats.totals.clicks === 0 &&
    stats.totals.distance_px === 0;

  const choosePeriod = useCallback((next: RangePreset) => {
    setPeriod(next);
    if (next === "custom") {
      setSection("trends");
    }
  }, []);

  const statusLabel = demo ? t.settings.demo : t.status[status.status];
  const onboarding = ready && control.onboarding;

  const renderPage = () => {
    if (dashboard.loading && !ready) {
      return <LoadingDesk />;
    }
    switch (section) {
      case "overview":
        return (
          <OverviewPage
            stats={stats}
            heatmap={heatmap}
            language={language}
            t={t}
            empty={isEmpty}
            onOpenKeyboard={() => setSection("keyboard")}
            onOpenMouse={() => setSection("mouse")}
          />
        );
      case "mouse":
        return (
          <MousePage stats={stats} heatmap={heatmap} language={language} t={t} empty={isEmpty} />
        );
      case "keyboard":
        return (
          <KeyboardPage stats={stats} language={language} t={t} live={live} />
        );
      case "trends":
        return (
          <TrendsPage
            stats={stats}
            language={language}
            t={t}
            empty={isEmpty}
            metric={trendMetric}
            onMetricChange={setTrendMetric}
            period={period}
            customStart={customStart}
            customEnd={customEnd}
            onCustomStart={setCustomStart}
            onCustomEnd={setCustomEnd}
          />
        );
      case "settings":
        return (
          <SettingsPage
            settings={settings}
            onSettings={control.saveSettings}
            status={status}
            stats={stats}
            language={language}
            t={t}
            onTogglePause={control.togglePause}
            onGrant={control.grantPermission}
            onDemo={control.enterDemo}
            onLeaveDemo={control.leaveDemo}
            onExportJson={() => void control.exportFile("json", request)}
            onExportCsv={() => void control.exportFile("zip", request)}
            onShare={() => setShareOpen(true)}
            onDiagnostics={control.diagnostics}
            clearConfirm={clearConfirm}
            onClearConfirm={setClearConfirm}
            onClear={() =>
              void control.clear().then((cleared) => {
                if (cleared) {
                  setClearConfirm(false);
                  void dashboard.refresh();
                }
              })
            }
            busy={control.busy}
          />
        );
    }
  };

  return (
    <div className={`app-shell ${onboarding ? "is-onboarding" : ""}`}>
      <Sidebar section={section} onChange={setSection} t={t} demo={demo} />
      <div className="workspace">
        <Topbar
          period={period}
          onPeriodChange={choosePeriod}
          status={status}
          statusLabel={statusLabel}
          t={t}
          onPause={control.togglePause}
          onExportJson={() => void control.exportFile("json", request)}
          onExportCsv={() => void control.exportFile("zip", request)}
          onShare={() => setShareOpen(true)}
          demo={demo}
          onLeaveDemo={control.leaveDemo}
          hidden={onboarding}
        />
        {!onboarding && status.status === "permission_required" && (
          <div className="banner banner-warning" role="alert">
            <ShieldAlert size={18} />
            <div>
              <strong>{statusLabel}</strong>
              <span>{t.onboarding.permissionBody}</span>
            </div>
            <button className="outline-button" type="button" onClick={control.grantPermission}>
              {t.actions.grant}
            </button>
          </div>
        )}
        {!onboarding && (status.status === "storage_error" || status.status === "hook_error") && (
          <div className="banner banner-error" role="alert">
            <ShieldAlert size={18} />
            <div>
              <strong>{statusLabel}</strong>
              <span>{status.message ?? t.errors.generic}</span>
            </div>
            <button className="outline-button" type="button" onClick={control.diagnostics}>
              {t.actions.diagnostics}
            </button>
          </div>
        )}
        {!onboarding && dashboard.error && (
          <div className="banner banner-error" role="alert">
            <ShieldAlert size={18} />
            <span>{t.errors.load}</span>
            <button className="outline-button" type="button" onClick={() => void dashboard.refresh()}>
              <RefreshCw size={14} />
              {t.actions.retry}
            </button>
          </div>
        )}
        <main className={onboarding ? "main onboarding-main" : "main"}>
          {onboarding ? (
            <Onboarding
              t={t}
              language={language}
              platform={navigator.platform}
              onBegin={control.finishOnboarding}
              onDemo={control.enterDemo}
              onGrant={control.grantPermission}
            />
          ) : (
            <div className="page-frame" key={section}>
              {renderPage()}
            </div>
          )}
        </main>
      </div>
      <ShareCardDialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        stats={stats}
        config={shareConfig}
        onConfigChange={setShareConfig}
        onSave={async (png) => {
          if (await control.saveCard(png)) {
            setShareOpen(false);
          }
        }}
        language={language}
        dictionary={t}
        busy={control.busy}
      />
      <Toast message={toast.message} />
    </div>
  );
}

function LoadingDesk() {
  return (
    <div className="loading-desk" aria-busy="true" aria-label="Loading statistics">
      <div className="loading-line" />
      <div className="loading-grid">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

export default App;
