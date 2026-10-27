import { memo, useEffect, useRef } from "react";
import type { KeyCount } from "../types";
import type { Language } from "../lib/format";
import { compactNumber } from "../lib/format";
import { liveBus } from "../lib/liveBus";

const IS_MAC = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
/** How long a key stays lit after release, so quick taps are visible. */
const RELEASE_HOLD_MS = 90;

interface KeySpec {
  id: string;
  label: string;
  width?: number;
  gapBefore?: number;
  secondary?: string;
}

const mainRows: KeySpec[][] = [
  [
    { id: "backquote", label: "~", secondary: "`" },
    { id: "1", label: "!", secondary: "1" },
    { id: "2", label: "@", secondary: "2" },
    { id: "3", label: "#", secondary: "3" },
    { id: "4", label: "$", secondary: "4" },
    { id: "5", label: "%", secondary: "5" },
    { id: "6", label: "^", secondary: "6" },
    { id: "7", label: "&", secondary: "7" },
    { id: "8", label: "*", secondary: "8" },
    { id: "9", label: "(", secondary: "9" },
    { id: "0", label: ")", secondary: "0" },
    { id: "minus", label: "_", secondary: "-" },
    { id: "equal", label: "+", secondary: "=" },
    { id: "backspace", label: "BACK", width: 2 },
  ],
  [
    { id: "tab", label: "TAB", width: 1.5 },
    { id: "q", label: "Q" },
    { id: "w", label: "W" },
    { id: "e", label: "E" },
    { id: "r", label: "R" },
    { id: "t", label: "T" },
    { id: "y", label: "Y" },
    { id: "u", label: "U" },
    { id: "i", label: "I" },
    { id: "o", label: "O" },
    { id: "p", label: "P" },
    { id: "bracket_left", label: "{", secondary: "[" },
    { id: "bracket_right", label: "}", secondary: "]" },
    { id: "backslash", label: "|", secondary: "\\", width: 1.5 },
  ],
  [
    { id: "capslock", label: "CAPS", width: 1.8 },
    { id: "a", label: "A" },
    { id: "s", label: "S" },
    { id: "d", label: "D" },
    { id: "f", label: "F" },
    { id: "g", label: "G" },
    { id: "h", label: "H" },
    { id: "j", label: "J" },
    { id: "k", label: "K" },
    { id: "l", label: "L" },
    { id: "semicolon", label: ":", secondary: ";" },
    { id: "quote", label: "\"", secondary: "'" },
    { id: "enter", label: "RETURN", width: 2.2 },
  ],
  [
    { id: "shift", label: "SHIFT", width: 2.3 },
    { id: "z", label: "Z" },
    { id: "x", label: "X" },
    { id: "c", label: "C" },
    { id: "v", label: "V" },
    { id: "b", label: "B" },
    { id: "n", label: "N" },
    { id: "m", label: "M" },
    { id: "comma", label: "<", secondary: "," },
    { id: "period", label: ">", secondary: "." },
    { id: "slash", label: "?", secondary: "/" },
    { id: "shift_right", label: "SHIFT", width: 2.7 },
  ],
  [
    { id: "fn", label: "FN", width: 1.25 },
    { id: "control", label: "CTRL", width: 1.25 },
    { id: "alt", label: IS_MAC ? "OPT" : "ALT", width: 1.25 },
    { id: "meta", label: IS_MAC ? "CMD" : "WIN", width: 1.5 },
    { id: "space", label: "SPACE", width: 5.5 },
    { id: "meta_right", label: IS_MAC ? "CMD" : "WIN", width: 1.5 },
    { id: "alt_right", label: IS_MAC ? "OPT" : "ALT", width: 1.25 },
    { id: "control_right", label: "CTRL", width: 1.5 },
  ],
];

const functionKeys: KeySpec[] = [
  { id: "escape", label: "ESC" },
  ...Array.from({ length: 12 }, (_, index) => ({
    id: `f${index + 1}`,
    label: `F${index + 1}`,
  })),
];

const editRows: KeySpec[][] = [
  [
    { id: "printscreen", label: "PRT" },
    { id: "scrolllock", label: "SCR" },
    { id: "pause", label: "PAU" },
  ],
  [
    { id: "insert", label: "INS" },
    { id: "home", label: "HOME" },
    { id: "pageup", label: "PGUP" },
  ],
  [
    { id: "delete", label: "DEL" },
    { id: "end", label: "END" },
    { id: "pagedown", label: "PGDN" },
  ],
  [{ id: "arrow_up", label: "↑" }],
  [
    { id: "arrow_left", label: "←" },
    { id: "arrow_down", label: "↓" },
    { id: "arrow_right", label: "→" },
  ],
];

const numpadRows: KeySpec[][] = [
  [
    { id: "numlock", label: "NUM" },
    { id: "numpad_divide", label: "/" },
    { id: "numpad_multiply", label: "*" },
    { id: "numpad_minus", label: "−" },
  ],
  [
    { id: "numpad7", label: "7" },
    { id: "numpad8", label: "8" },
    { id: "numpad9", label: "9" },
    { id: "numpad_plus", label: "+" },
  ],
  [
    { id: "numpad4", label: "4" },
    { id: "numpad5", label: "5" },
    { id: "numpad6", label: "6" },
    { id: "numpad_spacer", label: "" },
  ],
  [
    { id: "numpad1", label: "1" },
    { id: "numpad2", label: "2" },
    { id: "numpad3", label: "3" },
    { id: "numpad_enter", label: "ENT" },
  ],
  [
    { id: "numpad0", label: "0", width: 2 },
    { id: "numpad_decimal", label: "." },
    { id: "numpad_spacer", label: "" },
  ],
];

/** Older builds stored F-keys under their raw code; count both ids. */
const legacyIds: Record<string, string[]> = Object.fromEntries(
  Array.from({ length: 12 }, (_, index) => [
    `f${index + 1}`,
    [`f${index + 1}`, `key_${(0xf704 + index).toString(16)}`],
  ]),
);

function countFor(id: string, counts: Map<string, number>): number {
  const ids = legacyIds[id] ?? [id];
  return ids.reduce((sum, alias) => sum + (counts.get(alias) ?? 0), 0);
}

const Keycap = memo(function Keycap({
  spec,
  count,
  heat,
  language,
}: {
  spec: KeySpec;
  count: number;
  heat: number;
  language: Language;
}) {
  if (spec.id === "numpad_spacer") {
    return <span className="keycap is-spacer" aria-hidden="true" style={{ "--key-width": 1 } as React.CSSProperties} />;
  }
  const name = spec.label || spec.id;
  return (
    <span
      className="keycap"
      data-key={spec.id}
      role="img"
      style={{ "--key-width": spec.width ?? 1, "--heat": heat } as React.CSSProperties}
      aria-label={`${spec.id}: ${count} ${language === "zh" ? "次" : "presses"}`}
      title={`${name.toUpperCase()} · ${compactNumber(count, language)}`}
    >
      {spec.secondary && <span className="key-secondary">{spec.secondary}</span>}
      <span className="key-label">{spec.label}</span>
      <small>{count > 0 ? compactNumber(count, language) : ""}</small>
    </span>
  );
});

/**
 * Lights keys as they go down and up. Uses class toggles on the DOM so typing
 * fast never re-renders the keyboard; counts arrive through props separately.
 */
function useLiveHighlight(root: React.RefObject<HTMLDivElement | null>, enabled: boolean) {
  useEffect(() => {
    const element = root.current;
    if (!element || !enabled) {
      return;
    }
    const timers = new Map<string, number>();
    const caps = (id: string) =>
      element.querySelectorAll<HTMLElement>(`[data-key="${CSS.escape(id)}"]`);
    const press = (id: string) => {
      window.clearTimeout(timers.get(id));
      for (const cap of caps(id)) {
        cap.classList.remove("is-struck");
        // Restart the strike animation even for the same key pressed twice.
        void cap.offsetWidth;
        cap.classList.add("is-down", "is-struck");
      }
    };
    const release = (id: string) => {
      window.clearTimeout(timers.get(id));
      timers.set(
        id,
        window.setTimeout(() => {
          timers.delete(id);
          for (const cap of caps(id)) {
            cap.classList.remove("is-down");
          }
        }, RELEASE_HOLD_MS),
      );
    };
    const unsubscribe = liveBus.subscribe((pulse) => {
      pulse.down.forEach(press);
      pulse.up.forEach(release);
    });
    const clearAll = () => {
      for (const cap of element.querySelectorAll(".is-down")) {
        cap.classList.remove("is-down");
      }
    };
    window.addEventListener("blur", clearAll);
    return () => {
      unsubscribe();
      window.removeEventListener("blur", clearAll);
      timers.forEach((timer) => window.clearTimeout(timer));
      clearAll();
    };
  }, [root, enabled]);
}

export function KeyboardHeatmap({
  keys,
  language,
  live = false,
}: {
  keys: KeyCount[];
  language: Language;
  live?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  useLiveHighlight(root, live);
  const counts = new Map(keys.map((key) => [key.key_id.toLowerCase(), key.count]));
  const max = Math.max(1, ...counts.values());

  const renderRow = (row: KeySpec[], prefix: string) => {
    return (
      <div className="key-row" key={prefix}>
        {row.map((spec, index) => {
          const count = countFor(spec.id, counts);
          return (
            <Keycap
              key={`${prefix}-${spec.id}-${index}`}
              spec={spec}
              count={count}
              heat={Math.sqrt(count / max)}
              language={language}
            />
          );
        })}
      </div>
    );
  };

  return (
    <div className="keyboard-heatmap" ref={root}>
      <div className="keyboard-main">
        <div className="function-row">{renderRow(functionKeys, "function")}</div>
        {mainRows.map((row, index) => renderRow(row, `main-${index}`))}
      </div>
      <div className="keyboard-side">
        <div className="edit-cluster">
          {editRows.map((row, index) => renderRow(row, `edit-${index}`))}
        </div>
        <div className="numpad">
          {numpadRows.map((row, index) => renderRow(row, `num-${index}`))}
        </div>
      </div>
    </div>
  );
}
