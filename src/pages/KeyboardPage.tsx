import { useEffect, useState } from "react";
import { KeyboardHeatmap } from "../components/Keyboard";
import { MetricLabel, SectionHeading } from "../components/Primitives";
import type { Dictionary } from "../i18n";
import { compactNumber, type Language } from "../lib/format";
import { liveBus } from "../lib/liveBus";
import type { KeyCount, StatsSnapshot } from "../types";

/** Keys pressed since this page opened, and the most recent one. */
function useSession() {
  const [session, setSession] = useState({ presses: 0, last: null as KeyCount | null });
  useEffect(
    () =>
      liveBus.subscribe((pulse) => {
        if (pulse.presses.length === 0) {
          return;
        }
        const added = pulse.presses.reduce((sum, key) => sum + key.count, 0);
        setSession((previous) => ({
          presses: previous.presses + added,
          last: pulse.presses[pulse.presses.length - 1],
        }));
      }),
    [],
  );
  return session;
}

export function KeyboardPage({
  stats,
  language,
  t,
  live,
}: {
  stats: StatsSnapshot;
  language: Language;
  t: Dictionary;
  live: boolean;
}) {
  const session = useSession();
  const topKey = stats.keys[0];
  return (
    <div className="page">
      <SectionHeading title={t.keyboard.title} subtitle={t.keyboard.subtitle} />
      <section className="stat-row">
        <Stat label={t.overview.keys} value={compactNumber(stats.totals.key_presses, language)} />
        <Stat
          label={t.keyboard.shortcutShare}
          value={`${(stats.totals.shortcut_ratio * 100).toFixed(1)}%`}
        />
        <Stat label={t.keyboard.topKey} value={topKey?.label ?? "—"} />
        <Stat label={t.keyboard.session} value={compactNumber(session.presses, language)} accent />
      </section>
      <section className="key-terrain paper-card">
        <div className="card-heading">
          <div>
            <MetricLabel>{t.keyboard.heatmap}</MetricLabel>
            <p>{live ? t.keyboard.hint : t.keyboard.modifierNote}</p>
          </div>
          <div className="key-terrain-side">
            <div className="last-key-box" aria-live="polite">
              <span>{t.keyboard.lastKey}</span>
              <strong key={session.presses} className="last-key">
                {session.last?.label ?? "—"}
              </strong>
            </div>
            {live && (
              <span className="live-badge">
                <i aria-hidden="true" />
                {t.keyboard.live}
              </span>
            )}
          </div>
        </div>
        <KeyboardHeatmap keys={stats.keys} language={language} live={live} />
        <div className="heat-legend">
          <span>{language === "zh" ? "少" : "Fewer"}</span>
          <i />
          <span>{language === "zh" ? "多" : "More"}</span>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`stat paper-card${accent ? " is-accent" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
