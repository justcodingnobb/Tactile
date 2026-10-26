import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  Download,
  Mouse,
  Pause,
  Play,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { listen } from "@tauri-apps/api/event";
import { Sidebar } from "./components/Sidebar";
import { Onboarding } from "./components/Onboarding";
import {
  ActivityBand,
  ButtonDonut,
  SeriesChart,
  TraceGlyph,
} from "./components/Charts";
import { KeyboardHeatmap } from "./components/Keyboard";
import { ClickHeatmapCanvas } from "./components/ClickHeatmap";
import { ExportMenu, ShareCardDialog } from "./components/ExportDialog";
import {
  Delta,
  EmptyState,
  MetricLabel,
  SectionHeading,
  Segmented,
  StatusDot,
  Toggle,
} from "./components/Primitives";
import { demoStats, makeEmptyStats } from "./lib/demo";
import {
  clearData,
  createDiagnostics,
  exportData,
  exportShareCard,
  getCaptureStatus,
  getClickHeatmap,
  getSettings,
  getStats,
  isTauri,
  openSystemSettings,
  pauseCapture,
  previewHeatmap,
  requestInputPermission,
  setDemoMode,
  updateSettings,
} from "./lib/ipc";
import {
  applyTheme,
  compactNumber,
  defaultSettings,
  formatBytes,
  formatDateRange,
  formatDistance,
  formatDuration,
  fullNumber,
  resolveLanguage,
  todayIso,
} from "./lib/format";
import { dictionary } from "./i18n";
import type {
  AppSection,
  AppSettings,
  CaptureState,
  Heatmap,
  RangePreset,
  ShareCardConfig,
  StatsRequest,
  StatsSnapshot,
} from "./types";
import "./styles.css";

const periodValues: RangePreset[] = ["today", "week", "month", "year", "custom"];

function App() {
  const [section, setSection] = useState<AppSection>("overview");
  const [period, setPeriod] = useState<RangePreset>("week");
  const [customStart, setCustomStart] = useState(todayIso());
  const [customEnd, setCustomEnd] = useState(todayIso());
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [status, setStatus] = useState<CaptureState>({
    status: "active",
    message: null,
    secure_input: false,
    demo_mode: false,
  });
  const [stats, setStats] = useState<StatsSnapshot>(makeEmptyStats);
  const [heatmap, setHeatmap] = useState<Heatmap>({
    columns: 24,
    rows: 16,
    cells: Array(384).fill(0),
    max_value: 0,
    filtered_total: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [onboarding, setOnboarding] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareConfig, setShareConfig] = useState<ShareCardConfig>({
    show_active_seconds: false,
    show_top_key: false,
    show_comparison: false,
  });
  const [clearConfirm, setClearConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [trendMetric, setTrendMetric] = useState<
    "distance_px" | "key_presses" | "clicks" | "active_seconds"
  >("distance_px");
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  const language = resolveLanguage(settings.language);
  const t = dictionary(language);
  const demo = status.demo_mode;

  const request = useMemo<StatsRequest>(() => {
    if (period === "custom") {
      return { start: customStart, end: customEnd };
    }
    return { preset: period };
  }, [period, customStart, customEnd]);

  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) {
      window.clearTimeout(toastTimer.current);
    }
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [nextStats, nextHeatmap] = await Promise.all([
        getStats(request),
        getClickHeatmap(request),
      ]);
      setStats(nextStats);
      setHeatmap(nextHeatmap);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.errors.generic);
    } finally {
      setLoading(false);
    }
  }, [request, t.errors.generic]);

  useEffect(() => {
    let active = true;
    Promise.all([getSettings(), getCaptureStatus()])
      .then(([nextSettings, nextStatus]) => {
        if (!active) {
          return;
        }
        setSettings(nextSettings);
        setStatus(nextStatus);
        setOnboarding(!nextSettings.onboarding_complete && !nextStatus.demo_mode);
        applyTheme(nextSettings.theme);
      })
      .catch(() => {
        setOnboarding(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    applyTheme(settings.theme);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (settings.theme === "system") {
        applyTheme("system");
      }
    };
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, [settings.theme]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!isTauri) {
      return;
    }
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    listen<CaptureState>("capture-status-changed", (event) => {
      setStatus(event.payload);
    }).then((fn) => {
      if (disposed) {
        fn();
      } else {
        unlisten = fn;
      }
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!isTauri) {
      return;
    }
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    listen<AppSettings>("settings-changed", (event) => {
      setSettings((current) => ({ ...current, ...event.payload }));
      applyTheme(event.payload.theme);
    }).then((fn) => {
      if (disposed) {
        fn();
      } else {
        unlisten = fn;
      }
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!isTauri) {
      return;
    }
    const interval = window.setInterval(() => {
      if (
        document.visibilityState === "visible" &&
        status.status !== "paused" &&
        !status.demo_mode
      ) {
        void refresh();
      }
    }, 2000);
    return () => window.clearInterval(interval);
  }, [refresh, status.status, status.demo_mode]);

  const saveSettings = async (patch: Partial<AppSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    applyTheme(next.theme);
    try {
      const saved = await updateSettings(next);
      setSettings(saved);
    } catch {
      notify(t.errors.generic);
    }
  };

  const togglePause = async () => {
    if (demo) {
      notify(language === "zh" ? "演示模式不会记录输入。" : "Demo mode never records input.");
      return;
    }
    try {
      const next = await pauseCapture(status.status !== "paused");
      setStatus(next);
      if (next.status !== "paused") {
        void refresh();
      }
    } catch {
      notify(t.errors.generic);
    }
  };

  const enterDashboard = async () => {
    setOnboarding(false);
    await saveSettings({ onboarding_complete: true });
  };

  const enterDemo = async () => {
    try {
      const next = await setDemoMode(true);
      setStatus(next);
      setStats(demoStats);
      setHeatmap(previewHeatmap());
      setOnboarding(false);
    } catch {
      setStatus({ ...status, demo_mode: true, status: "paused" });
      setStats(demoStats);
      setHeatmap(previewHeatmap());
      setOnboarding(false);
    }
  };

  const leaveDemo = async () => {
    const next = await setDemoMode(false);
    setStatus(next);
    await refresh();
  };

  const grantPermission = async () => {
    try {
      const result = await requestInputPermission();
      notify(
        result.granted
          ? language === "zh"
            ? "输入监控已授权。"
            : "Input Monitoring granted."
          : language === "zh"
            ? "请在系统设置中允许后重新检查。"
            : "Allow access in System Settings, then check again.",
      );
      setStatus(await getCaptureStatus());
      if (!result.granted) {
        await openSystemSettings("input_monitoring");
      }
    } catch {
      notify(t.errors.generic);
    }
  };

  const choosePath = async (
    defaultPath: string,
    filters: { name: string; extensions: string[] }[],
  ): Promise<string | null> => {
    if (!isTauri) {
      notify(t.errors.noTauri);
      return null;
    }
    return save({ defaultPath, filters });
  };

  const doExport = async (format: "json" | "zip") => {
    const suffix = format === "json" ? "json" : "zip";
    const path = await choosePath(`trajectory-${todayIso()}.${suffix}`, [
      { name: suffix.toUpperCase(), extensions: [suffix] },
    ]);
    if (!path) {
      return;
    }
    setBusy(true);
    try {
      const result = await exportData(format, path, request);
      notify(
        language === "zh" ? `已导出到 ${result.path}` : `Exported to ${result.path}`,
      );
    } catch {
      notify(t.errors.generic);
    } finally {
      setBusy(false);
    }
  };

  const doShareDownload = async (blob: Blob) => {
    const path = await choosePath(`trajectory-share-${todayIso()}.png`, [
      { name: "PNG", extensions: ["png"] },
    ]);
    if (!path) {
      return;
    }
    setBusy(true);
    try {
      if (isTauri) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        await exportShareCard(path, bytes);
      } else {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "trajectory-share.png";
        anchor.click();
        URL.revokeObjectURL(url);
      }
      setShareOpen(false);
      notify(language === "zh" ? "分享卡已生成。" : "Share card created.");
    } catch {
      notify(t.errors.generic);
    } finally {
      setBusy(false);
    }
  };

  const doDiagnostics = async () => {
    const path = await choosePath(`trajectory-diagnostics-${todayIso()}.json`, [
      { name: "JSON", extensions: ["json"] },
    ]);
    if (!path) {
      return;
    }
    try {
      await createDiagnostics(path);
      notify(language === "zh" ? "诊断包已导出。" : "Diagnostics exported.");
    } catch {
      notify(t.errors.generic);
    }
  };

  const doClear = async () => {
    setBusy(true);
    try {
      await clearData();
      setClearConfirm(false);
      await refresh();
      notify(language === "zh" ? "数据已清除。" : "Data cleared.");
    } catch {
      notify(t.errors.generic);
    } finally {
      setBusy(false);
    }
  };

  const statusLabel = t.status[status.status];
  const isEmpty =
    !demo &&
    stats.totals.key_presses === 0 &&
    stats.totals.clicks === 0 &&
    stats.totals.distance_px === 0;

  return (
    <div className={`app-shell ${onboarding ? "is-onboarding" : ""}`}>
      <div className="ambient-grid" aria-hidden="true" />
      <Sidebar section={section} onChange={setSection} t={t} demo={demo} />
      <div className="workspace">
        <Topbar
          period={period}
          onPeriodChange={setPeriod}
          status={status}
          statusLabel={statusLabel}
          t={t}
          language={language}
          onPause={togglePause}
          onExportJson={() => void doExport("json")}
          onExportCsv={() => void doExport("zip")}
          onShare={() => setShareOpen(true)}
          demo={demo}
          onLeaveDemo={leaveDemo}
        />
        {status.status === "permission_required" && (
          <div className="banner banner-warning" role="alert">
            <ShieldAlert size={18} />
            <div>
              <strong>{statusLabel}</strong>
              <span>{t.onboarding.permissionBody}</span>
            </div>
            <button className="outline-button" type="button" onClick={grantPermission}>
              {t.actions.grant}
            </button>
          </div>
        )}
        {(status.status === "storage_error" || status.status === "hook_error") && (
          <div className="banner banner-error" role="alert">
            <ShieldAlert size={18} />
            <div>
              <strong>{statusLabel}</strong>
              <span>{status.message ?? t.errors.generic}</span>
            </div>
            <button className="outline-button" type="button" onClick={doDiagnostics}>
              {t.actions.diagnostics}
            </button>
          </div>
        )}
        {error && (
          <div className="banner banner-error" role="alert">
            <ShieldAlert size={18} />
            <span>{error}</span>
            <button className="outline-button" type="button" onClick={() => void refresh()}>
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
              onBegin={enterDashboard}
              onDemo={enterDemo}
              onGrant={grantPermission}
            />
          ) : (
            <>
              {loading ? (
                <LoadingDesk />
              ) : section === "overview" ? (
                <Overview
                  stats={stats}
                  heatmap={heatmap}
                  language={language}
                  t={t}
                  empty={isEmpty}
                  period={period}
                  onPeriodChange={setPeriod}
                  onOpenKeyboard={() => setSection("keyboard")}
                  onOpenMouse={() => setSection("mouse")}
                />
              ) : section === "mouse" ? (
                <MousePage
                  stats={stats}
                  heatmap={heatmap}
                  language={language}
                  t={t}
                  empty={isEmpty}
                />
              ) : section === "keyboard" ? (
                <KeyboardPage
                  stats={stats}
                  language={language}
                  t={t}
                  empty={isEmpty}
                />
              ) : section === "trends" ? (
                <TrendsPage
                  stats={stats}
                  language={language}
                  t={t}
                  empty={isEmpty}
                  metric={trendMetric}
                  onMetricChange={setTrendMetric}
                  period={period}
                  onPeriodChange={setPeriod}
                  customStart={customStart}
                  customEnd={customEnd}
                  onCustomStart={setCustomStart}
                  onCustomEnd={setCustomEnd}
                />
              ) : (
                <SettingsPage
                  settings={settings}
                  onSettings={saveSettings}
                  status={status}
                  stats={stats}
                  language={language}
                  t={t}
                  onTogglePause={togglePause}
                  onGrant={grantPermission}
                  onDemo={enterDemo}
                  onLeaveDemo={leaveDemo}
                  onExportJson={() => void doExport("json")}
                  onExportCsv={() => void doExport("zip")}
                  onShare={() => setShareOpen(true)}
                  onDiagnostics={doDiagnostics}
                  clearConfirm={clearConfirm}
                  onClearConfirm={setClearConfirm}
                  onClear={() => void doClear()}
                  busy={busy}
                />
              )}
            </>
          )}
        </main>
      </div>
      <ShareCardDialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        stats={stats}
        config={shareConfig}
        onConfigChange={setShareConfig}
        onDownload={doShareDownload}
        language={language}
        dictionary={t}
        busy={busy}
      />
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

function Topbar({
  period,
  onPeriodChange,
  status,
  statusLabel,
  t,
  language,
  onPause,
  onExportJson,
  onExportCsv,
  onShare,
  demo,
  onLeaveDemo,
}: {
  period: RangePreset;
  onPeriodChange: (period: RangePreset) => void;
  status: CaptureState;
  statusLabel: string;
  t: ReturnType<typeof dictionary>;
  language: "zh" | "en";
  onPause: () => void;
  onExportJson: () => void;
  onExportCsv: () => void;
  onShare: () => void;
  demo: boolean;
  onLeaveDemo: () => void;
}) {
  return (
    <header className="topbar">
      <div className="period-switcher">
        {periodValues.map((value) => (
          <button
            key={value}
            type="button"
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
        <span className={`status-pill status-${status.status}`}>
          <StatusDot status={status.status} />
          {statusLabel}
        </span>
        <button
          className="icon-button pause-button"
          type="button"
          onClick={onPause}
          aria-label={status.status === "paused" ? t.actions.resume : t.actions.pause}
          title={status.status === "paused" ? t.actions.resume : t.actions.pause}
        >
          {status.status === "paused" ? <Play size={16} /> : <Pause size={16} />}
        </button>
        <ExportMenu
          onJson={onExportJson}
          onCsv={onExportCsv}
          onShare={onShare}
          t={t}
        />
        <span className="language-badge">{language === "zh" ? "中" : "EN"}</span>
      </div>
    </header>
  );
}

function Overview({
  stats,
  heatmap,
  language,
  t,
  empty,
  period,
  onPeriodChange,
  onOpenKeyboard,
  onOpenMouse,
}: {
  stats: StatsSnapshot;
  heatmap: Heatmap;
  language: "zh" | "en";
  t: ReturnType<typeof dictionary>;
  empty: boolean;
  period: RangePreset;
  onPeriodChange: (period: RangePreset) => void;
  onOpenKeyboard: () => void;
  onOpenMouse: () => void;
}) {
  const topKey = stats.keys[0];
  const range = stats.range;
  return (
    <div className="page overview-page">
      <div className="page-intro">
        <div>
          <p className="eyebrow">{t.brandEyebrow}</p>
          <h1>
            {language === "zh" ? "你的动作，" : "Your motion,"}
            <br />
            <em>{language === "zh" ? "留下一条轨迹。" : "kept as a trace."}</em>
          </h1>
        </div>
        {range && (
          <p className="date-range">
            {formatDateRange(range.start_local_day, range.end_local_day, language)}
          </p>
        )}
      </div>

      {empty ? (
        <EmptyState title={t.overview.noData} body={t.overview.noDataBody} />
      ) : (
        <>
          <section className="hero-grid">
            <article className="distance-card paper-card">
              <MetricLabel index="A—01">{t.overview.eyebrow}</MetricLabel>
              <div className="distance-readout">
                <span className="distance-number">
                  {formatDistance(stats.totals.distance_km, language)}
                </span>
                <span className="distance-unit">KM</span>
              </div>
              <div className="distance-footer">
                <p>{t.overview.distanceCaption}</p>
                <Delta value={stats.comparison.distance_ratio} language={language} />
              </div>
              <div className="hero-orbit" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            </article>
            <article className="trace-card ink-card">
              <div className="trace-card-head">
                <div>
                  <MetricLabel index="A—02">{t.overview.rhythm}</MetricLabel>
                  <p>{t.overview.rhythmSub}</p>
                </div>
                <span className="pulse-label">LIVE / AGGREGATE</span>
              </div>
              <TraceGlyph hourly={stats.hourly} />
              <div className="trace-stats">
                <div>
                  <span>{t.overview.shortcuts}</span>
                  <strong>{(stats.totals.shortcut_ratio * 100).toFixed(1)}%</strong>
                </div>
                <div>
                  <span>{language === "zh" ? "最高频键" : "TOP KEY"}</span>
                  <strong>{topKey?.label ?? "—"}</strong>
                </div>
              </div>
            </article>
          </section>

          <section className="metrics-strip">
            <MetricTile
              index="B—01"
              label={t.overview.keys}
              value={compactNumber(stats.totals.key_presses, language)}
              unit={t.units.keys}
              delta={stats.comparison.key_ratio}
              language={language}
            />
            <MetricTile
              index="B—02"
              label={t.overview.clicks}
              value={compactNumber(stats.totals.clicks, language)}
              unit={t.units.clicks}
              delta={stats.comparison.click_ratio}
              language={language}
            />
            <MetricTile
              index="B—03"
              label={t.overview.active}
              value={formatDuration(stats.totals.active_seconds, language)}
              unit={t.units.sessions}
              delta={stats.comparison.active_ratio}
              language={language}
            />
            <MetricTile
              index="B—04"
              label={t.overview.shortcuts}
              value={`${(stats.totals.shortcut_ratio * 100).toFixed(1)}%`}
              unit={`${compactNumber(stats.totals.shortcut_presses, language)} ${language === "zh" ? "次" : "presses"}`}
              delta={null}
              language={language}
            />
          </section>

          <section className="activity-card paper-card">
            <div className="card-heading">
              <div>
                <MetricLabel index="C—01">{t.overview.activity}</MetricLabel>
                <p>{t.overview.activitySub}</p>
              </div>
              <span className="mono-label">00 — 23 H</span>
            </div>
            <ActivityBand data={stats.hourly} language={language} />
          </section>

          <section className="lower-grid">
            <article className="paper-card key-list-card" onClick={onOpenKeyboard}>
              <div className="card-heading">
                <MetricLabel index="D—01">{t.overview.topKeys}</MetricLabel>
                <button className="text-button" type="button">
                  {language === "zh" ? "查看键盘" : "View keyboard"} →
                </button>
              </div>
              {stats.keys.slice(0, 6).map((key, index) => {
                const max = stats.keys[0]?.count || 1;
                return (
                  <div className="key-rank-row" key={key.key_id}>
                    <span className="rank">{`${index + 1}`.padStart(2, "0")}</span>
                    <span className="key-name">{key.label}</span>
                    <div className="key-bar">
                      <span style={{ width: `${(key.count / max) * 100}%` }} />
                    </div>
                    <strong>{compactNumber(key.count, language)}</strong>
                  </div>
                );
              })}
            </article>
            <article className="ink-card heat-grid-card" onClick={onOpenMouse}>
              <div className="card-heading">
                <MetricLabel index="D—02">{t.mouse.heatmap}</MetricLabel>
                <button className="text-button text-light" type="button">
                  {language === "zh" ? "指针详情" : "Pointer details"} →
                </button>
              </div>
              <ClickHeatmapCanvas heatmap={heatmap} language={language} />
              <p className="fine-on-dark">
                {t.mouse.heatmapNote} · {compactNumber(heatmap.filtered_total, language)}{" "}
                {language === "zh" ? "次点击" : "clicks"}
              </p>
            </article>
          </section>
        </>
      )}
      <footer className="page-foot">
        <span>{language === "zh" ? "本地时间" : "LOCAL TIME"} · {period}</span>
        <button type="button" onClick={() => onPeriodChange("today")}>
          ± {language === "zh" ? "对比同长度上一周期" : "COMPARE PREVIOUS"}
        </button>
      </footer>
    </div>
  );
}

function MetricTile({
  index,
  label,
  value,
  unit,
  delta,
  language,
}: {
  index: string;
  label: string;
  value: string;
  unit: string;
  delta: number | null;
  language: "zh" | "en";
}) {
  return (
    <article className="metric-tile paper-card">
      <MetricLabel index={index}>{label}</MetricLabel>
      <strong className="metric-value">{value}</strong>
      <div className="metric-bottom">
        <span>{unit}</span>
        <Delta value={delta} language={language} />
      </div>
    </article>
  );
}

function MousePage({
  stats,
  heatmap,
  language,
  t,
  empty,
}: {
  stats: StatsSnapshot;
  heatmap: Heatmap;
  language: "zh" | "en";
  t: ReturnType<typeof dictionary>;
  empty: boolean;
}) {
  const buttonLabels: Record<string, string> = {
    left: language === "zh" ? "左键" : "Left",
    right: language === "zh" ? "右键" : "Right",
    middle: language === "zh" ? "中键" : "Middle",
    side1: language === "zh" ? "侧键 1" : "Side 1",
    side2: language === "zh" ? "侧键 2" : "Side 2",
    other_side: language === "zh" ? "其他侧键" : "Other side",
  };
  const buttonColors = ["#ff5a1f", "#171713", "#d8ff3e", "#8b8a80", "#c9c5b8"];
  return (
    <div className="page">
      <SectionHeading
        kicker="02 / POINTER"
        title={t.mouse.title}
        subtitle={t.mouse.subtitle}
      />
      {empty ? (
        <EmptyState title={t.overview.noData} body={t.overview.noDataBody} />
      ) : (
        <div className="mouse-layout">
          <section className="mouse-summary paper-card">
            <MetricLabel index="A—01">{t.overview.eyebrow}</MetricLabel>
            <div className="distance-readout">
              <span className="distance-number">
                {formatDistance(stats.totals.distance_km, language)}
              </span>
              <span className="distance-unit">KM</span>
            </div>
            <p className="muted">
              {fullNumber(stats.totals.distance_px, language)} logical px
            </p>
            <Delta value={stats.comparison.distance_ratio} language={language} />
          </section>
          <section className="mouse-buttons paper-card">
            <MetricLabel index="A—02">{t.mouse.buttons}</MetricLabel>
            <ButtonDonut
              language={language}
              items={stats.buttons.map((button, index) => ({
                label: buttonLabels[button.button],
                value: button.count,
                color: buttonColors[index % buttonColors.length],
              }))}
            />
            <div className="button-legend">
              {stats.buttons.map((button, index) => (
                <div key={button.button}>
                  <span style={{ background: buttonColors[index % buttonColors.length] }} />
                  <span>{buttonLabels[button.button]}</span>
                  <strong>{compactNumber(button.count, language)}</strong>
                </div>
              ))}
            </div>
          </section>
          <section className="wheel-card ink-card">
            <MetricLabel index="B—01">{t.mouse.wheel}</MetricLabel>
            <div className="wheel-numbers">
              <div>
                <ArrowUp size={22} />
                <strong>{compactNumber(stats.totals.wheel_up, language)}</strong>
                <span>{t.mouse.up}</span>
              </div>
              <div>
                <ArrowDown size={22} />
                <strong>{compactNumber(stats.totals.wheel_down, language)}</strong>
                <span>{t.mouse.down}</span>
              </div>
            </div>
          </section>
          <section className="click-terrain ink-card">
            <div className="card-heading">
              <div>
                <MetricLabel index="B—02">{t.mouse.heatmap}</MetricLabel>
                <p>{t.mouse.heatmapNote}</p>
              </div>
              <div className="heatmap-totals">
                <span>{t.mouse.loadedClicks}</span>
                <strong>{compactNumber(heatmap.filtered_total, language)}</strong>
              </div>
            </div>
            <ClickHeatmapCanvas heatmap={heatmap} language={language} />
            <p className="fine-on-dark">
              {t.mouse.outside}:{" "}
              {compactNumber(
                Math.max(0, stats.totals.clicks - heatmap.filtered_total),
                language,
              )}
            </p>
          </section>
          <section className="mouse-trend paper-card">
            <MetricLabel index="C—01">{t.trends.daily}</MetricLabel>
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

function KeyboardPage({
  stats,
  language,
  t,
  empty,
}: {
  stats: StatsSnapshot;
  language: "zh" | "en";
  t: ReturnType<typeof dictionary>;
  empty: boolean;
}) {
  return (
    <div className="page">
      <SectionHeading
        kicker="03 / KEYBOARD"
        title={t.keyboard.title}
        subtitle={t.keyboard.subtitle}
        action={
          <div className="heading-stat">
            <span>{t.keyboard.shortcutShare}</span>
            <strong>{(stats.totals.shortcut_ratio * 100).toFixed(1)}%</strong>
          </div>
        }
      />
      {empty ? (
        <EmptyState title={t.overview.noData} body={t.overview.noDataBody} />
      ) : (
        <div className="keyboard-layout">
          <section className="key-terrain paper-card">
            <div className="card-heading">
              <div>
                <MetricLabel index="A—01">{t.keyboard.heatmap}</MetricLabel>
                <p>{t.keyboard.modifierNote}</p>
              </div>
              <span className="mono-label">104-KEY / PHYSICAL</span>
            </div>
            <KeyboardHeatmap keys={stats.keys} language={language} />
            <div className="heat-legend">
              <span>{language === "zh" ? "低" : "LOW"}</span>
              <i />
              <span>{language === "zh" ? "高" : "HIGH"}</span>
            </div>
          </section>
          <section className="key-ranking paper-card">
            <MetricLabel index="A—02">{t.keyboard.ranking}</MetricLabel>
            <div className="key-table">
              {stats.keys.slice(0, 18).map((key, index) => (
                <div key={key.key_id}>
                  <span>{`${index + 1}`.padStart(2, "0")}</span>
                  <strong>{key.label}</strong>
                  <i style={{ width: `${(key.count / (stats.keys[0]?.count || 1)) * 100}%` }} />
                  <b>{compactNumber(key.count, language)}</b>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function TrendsPage({
  stats,
  language,
  t,
  empty,
  metric,
  onMetricChange,
  period,
  onPeriodChange,
  customStart,
  customEnd,
  onCustomStart,
  onCustomEnd,
}: {
  stats: StatsSnapshot;
  language: "zh" | "en";
  t: ReturnType<typeof dictionary>;
  empty: boolean;
  metric: "distance_px" | "key_presses" | "clicks" | "active_seconds";
  onMetricChange: (
    metric: "distance_px" | "key_presses" | "clicks" | "active_seconds",
  ) => void;
  period: RangePreset;
  onPeriodChange: (period: RangePreset) => void;
  customStart: string;
  customEnd: string;
  onCustomStart: (date: string) => void;
  onCustomEnd: (date: string) => void;
}) {
  const maxHour = [...stats.hourly].sort((a, b) => b.events - a.events)[0];
  return (
    <div className="page">
      <SectionHeading
        kicker="04 / TIME"
        title={t.trends.title}
        subtitle={t.trends.subtitle}
        action={
          <div className="peak-badge">
            <span>PEAK HOUR</span>
            <strong>{`${maxHour?.hour ?? 0}`.padStart(2, "0")}:00</strong>
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
              onChange={(event) => onCustomStart(event.target.value)}
            />
          </label>
          <label>
            <span>{language === "zh" ? "结束日期" : "End date"}</span>
            <input
              type="date"
              value={customEnd}
              min={customStart}
              max={todayIso()}
              onChange={(event) => onCustomEnd(event.target.value)}
            />
          </label>
          <span className="fine-print">
            {language === "zh"
              ? "快速查询默认最近两年；更早数据可按日期查看。"
              : "Quick queries cover the last two years; older data remains date-addressable."}
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
                <MetricLabel index="A—01">{t.trends.daily}</MetricLabel>
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
              <MetricLabel index="A—02">{t.trends.hour}</MetricLabel>
              <span className="mono-label">00 / 23</span>
            </div>
            <div className="hour-bars">
              {stats.hourly.map((point) => {
                const max = Math.max(1, ...stats.hourly.map((item) => item.events));
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

function SettingsPage({
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
  language: "zh" | "en";
  t: ReturnType<typeof dictionary>;
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
  return (
    <div className="page settings-page">
      <SectionHeading
        kicker="05 / CONTROL"
        title={t.settings.title}
        subtitle={t.settings.subtitle}
        action={<span className="beta-badge">{t.settings.beta}</span>}
      />
      <div className="settings-grid">
        <section className="setting-block paper-card">
          <MetricLabel index="A—01">{t.settings.capture}</MetricLabel>
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
              </p>
            </div>
            <button className="outline-button" type="button" onClick={onTogglePause}>
              {status.status === "paused" ? <Play size={14} /> : <Pause size={14} />}
              {status.status === "paused" ? t.actions.resume : t.actions.pause}
            </button>
          </div>
          {status.status === "permission_required" && (
            <button className="primary-button" type="button" onClick={onGrant}>
              {t.actions.grant}
            </button>
          )}
          {status.demo_mode ? (
            <button className="text-button" type="button" onClick={onLeaveDemo}>
              {t.actions.real}
            </button>
          ) : (
            <button className="text-button" type="button" onClick={onDemo}>
              {t.actions.demo}
            </button>
          )}
        </section>

        <section className="setting-block paper-card">
          <MetricLabel index="A—02">{t.settings.appearance}</MetricLabel>
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
          <MetricLabel index="B—01">{t.settings.behavior}</MetricLabel>
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
            {navigator.platform.includes("Mac")
              ? "⌘ ⇧ P / ⌘ ⇧ T"
              : "Ctrl ⇧ P / Ctrl ⇧ T"}{" "}
            · {language === "zh" ? "首版可关闭，不可自定义" : "disableable, not remappable in v1"}
          </p>
        </section>

        <section className="setting-block paper-card">
          <MetricLabel index="B—02">{t.settings.privacy}</MetricLabel>
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
          <MetricLabel index="C—01">{t.settings.demo}</MetricLabel>
          <p className="setting-copy">{t.settings.demoBody}</p>
          <button className="outline-button" type="button" onClick={onDemo}>
            <Mouse size={14} />
            {t.actions.demo}
          </button>
        </section>

        <section className="setting-block paper-card">
          <MetricLabel index="C—02">{t.settings.exportCenter}</MetricLabel>
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
          <MetricLabel index="D—01">{t.settings.danger}</MetricLabel>
          <p className="setting-copy">{t.settings.dangerBody}</p>
          {clearConfirm ? (
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

function LoadingDesk() {
  return (
    <div className="loading-desk" aria-label="Loading statistics">
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
