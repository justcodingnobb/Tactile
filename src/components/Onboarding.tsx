import { ShieldCheck, WifiOff } from "lucide-react";
import type { Dictionary } from "../i18n";
import type { Language } from "../lib/format";

export function Onboarding({
  t,
  language,
  platform,
  onBegin,
  onDemo,
  onGrant,
}: {
  t: Dictionary;
  language: Language;
  platform: string;
  onBegin: () => void;
  onDemo: () => void;
  onGrant: () => void;
}) {
  return (
    <div className="onboarding">
      <section className="onboarding-hero">
        <p className="eyebrow">{t.onboarding.kicker}</p>
        <h1>{t.onboarding.title}</h1>
        <p className="onboarding-lede">{t.onboarding.body}</p>
        <div className="onboarding-actions">
          <button className="primary-button" type="button" onClick={onBegin}>
            {t.onboarding.begin}
          </button>
          <button className="text-button" type="button" onClick={onDemo}>
            {t.onboarding.viewDemo}
          </button>
        </div>
      </section>
      <aside className="onboarding-cards">
        <article>
          <div className="onboarding-icon"><ShieldCheck size={22} /></div>
          <p className="eyebrow">01 / PRIVACY</p>
          <h2>No account. No cloud.</h2>
          <p>
            {language === "zh"
              ? "数据只进入当前账户的本地数据库。无账号、无使用遥测、无设备共享。"
              : "Data goes only to this account's local database. No account, usage telemetry, or device sync."}
          </p>
        </article>
        <article>
          <div className="onboarding-icon"><WifiOff size={22} /></div>
          <p className="eyebrow">02 / NETWORK</p>
          <h2>Quiet by design.</h2>
          <p>
            {language === "zh"
              ? "当前测试版完全离线运行，不发送统计、账号、设备或使用数据。"
              : "This beta runs fully offline and sends no statistics, account, device, or usage data."}
          </p>
        </article>
        <article className="onboarding-permission">
          <p className="eyebrow">
            {platform.includes("Mac") ? t.onboarding.permissionTitle : t.onboarding.windowsTitle}
          </p>
          <p>
            {platform.includes("Mac")
              ? t.onboarding.permissionBody
              : t.onboarding.windowsBody}
          </p>
          {platform.includes("Mac") && (
            <button className="outline-button" type="button" onClick={onGrant}>
              {t.actions.grant}
            </button>
          )}
        </article>
      </aside>
    </div>
  );
}
