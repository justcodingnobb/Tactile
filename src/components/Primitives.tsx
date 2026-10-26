import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { Language } from "../lib/format";
import { formatRatio } from "../lib/format";

export function SectionHeading({
  kicker,
  title,
  subtitle,
  action,
}: {
  kicker?: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <header className="section-heading">
      <div>
        {kicker && <p className="eyebrow">{kicker}</p>}
        <h1>{title}</h1>
        {subtitle && <p className="section-subtitle">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

export function Delta({
  value,
  language,
}: {
  value: number | null;
  language: Language;
}) {
  const tone = value === null ? "flat" : value > 0 ? "up" : value < 0 ? "down" : "flat";
  const Icon = tone === "up" ? ArrowUpRight : tone === "down" ? ArrowDownRight : Minus;
  return (
    <span className={`delta delta-${tone}`}>
      <Icon size={12} strokeWidth={2.2} />
      {value === null
        ? language === "zh"
          ? "暂无对比"
          : "No baseline"
        : formatRatio(value)}
    </span>
  );
}

export function MetricLabel({
  index,
  children,
}: {
  index: string;
  children: ReactNode;
}) {
  return (
    <p className="metric-label">
      <span>{index}</span>
      {children}
    </p>
  );
}

export function EmptyState({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <div className="empty-state">
      <span className="empty-cross" aria-hidden="true" />
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}

export function StatusDot({ status }: { status: string }) {
  return <span className={`status-dot status-${status}`} aria-hidden="true" />;
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`toggle ${checked ? "is-on" : ""}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          role="radio"
          aria-checked={value === option.value}
          className={value === option.value ? "is-active" : ""}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
