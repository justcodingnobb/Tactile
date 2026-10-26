import {
  ChartNoAxesCombined,
  Keyboard,
  MousePointer2,
  Settings2,
  Sparkles,
} from "lucide-react";
import type { AppSection } from "../types";
import type { Dictionary } from "../i18n";

const icons = {
  overview: Sparkles,
  mouse: MousePointer2,
  keyboard: Keyboard,
  trends: ChartNoAxesCombined,
  settings: Settings2,
};

export function Sidebar({
  section,
  onChange,
  t,
  demo,
}: {
  section: AppSection;
  onChange: (section: AppSection) => void;
  t: Dictionary;
  demo: boolean;
}) {
  const sections: AppSection[] = [
    "overview",
    "mouse",
    "keyboard",
    "trends",
    "settings",
  ];
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          <span />
          <span />
        </div>
        <div>
          <strong>TRAJECTORY</strong>
          <small>轨迹</small>
        </div>
      </div>
      <nav aria-label="Primary">
        {sections.map((item) => {
          const Icon = icons[item];
          return (
            <button
              key={item}
              type="button"
              className={section === item ? "is-active" : ""}
              onClick={() => onChange(item)}
              aria-current={section === item ? "page" : undefined}
            >
              <span className="nav-number">{t.navNumber[item]}</span>
              <Icon size={17} strokeWidth={1.8} />
              <span>{t.nav[item]}</span>
            </button>
          );
        })}
      </nav>
      <div className="sidebar-foot">
        {demo && <span className="demo-flag">{t.settings.demoData}</span>}
        <p>{t.brandEyebrow}</p>
        <span className="version">v0.1.0 · BETA</span>
      </div>
    </aside>
  );
}
