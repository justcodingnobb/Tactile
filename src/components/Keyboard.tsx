import type { KeyCount } from "../types";
import type { Language } from "../lib/format";
import { compactNumber } from "../lib/format";

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
    { id: "shift-right", label: "SHIFT", width: 2.7 },
  ],
  [
    { id: "control", label: "CTRL", width: 1.45 },
    { id: "meta", label: "CMD", width: 1.45 },
    { id: "alt", label: "OPT", width: 1.45 },
    { id: "space", label: "", width: 6.2 },
    { id: "alt-right", label: "OPT", width: 1.45 },
    { id: "meta-right", label: "CMD", width: 1.45 },
    { id: "menu", label: "MENU", width: 1.2 },
    { id: "control-right", label: "CTRL", width: 1.6 },
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
  [
    { id: "arrow-left", label: "←" },
    { id: "arrow-down", label: "↓" },
    { id: "arrow-right", label: "→" },
  ],
  [{ id: "arrow-up", label: "↑" }],
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
    { id: "enter", label: "ENTER" },
  ],
  [
    { id: "numpad1", label: "1" },
    { id: "numpad2", label: "2" },
    { id: "numpad3", label: "3" },
    { id: "enter", label: "" },
  ],
  [
    { id: "numpad0", label: "0", width: 2 },
    { id: "numpad_decimal", label: "." },
    { id: "enter", label: "" },
  ],
];

const keyAliases: Record<string, string[]> = {
  control: ["control", "control-left", "ctrl"],
  "control-right": ["control-right"],
  meta: ["meta", "meta-left", "command", "cmd"],
  "meta-right": ["meta-right", "command-right"],
  alt: ["alt", "option"],
  "alt-right": ["alt-right", "option-right"],
  shift: ["shift", "shift-left"],
  "shift-right": ["shift-right"],
  escape: ["escape", "esc"],
  "arrow-left": ["arrow_left", "arrow-left", "left"],
  "arrow-right": ["arrow_right", "arrow-right", "right"],
  "arrow-up": ["arrow_up", "arrow-up", "up"],
  "arrow-down": ["arrow_down", "arrow-down", "down"],
  backquote: ["backquote", "`"],
  minus: ["minus", "-"],
  equal: ["equal", "="],
  bracket_left: ["bracket_left", "["],
  bracket_right: ["bracket_right", "]"],
  semicolon: ["semicolon", ";"],
  quote: ["quote", "'"],
  backslash: ["backslash", "\\"],
  comma: ["comma", ","],
  period: ["period", "."],
  slash: ["slash", "/"],
  delete: ["delete"],
  insert: ["insert"],
  home: ["home"],
  end: ["end"],
  pageup: ["pageup", "page_up"],
  pagedown: ["pagedown", "page_down"],
  printscreen: ["printscreen", "print_screen"],
  scrolllock: ["scrolllock", "scroll_lock"],
  pause: ["pause", "break"],
  numlock: ["numlock", "num_lock"],
  numpad_divide: ["numpad_divide"],
  numpad_multiply: ["numpad_multiply"],
  numpad_minus: ["numpad_minus"],
  numpad_plus: ["numpad_plus"],
  numpad_decimal: ["numpad_decimal"],
  numpad0: ["numpad0"],
  numpad1: ["numpad1"],
  numpad2: ["numpad2"],
  numpad3: ["numpad3"],
  numpad4: ["numpad4"],
  numpad5: ["numpad5"],
  numpad6: ["numpad6"],
  numpad7: ["numpad7"],
  numpad8: ["numpad8"],
  numpad9: ["numpad9"],
  backspace: ["backspace"],
  enter: ["enter", "return"],
  space: ["space"],
};

export function KeyboardHeatmap({
  keys,
  language,
}: {
  keys: KeyCount[];
  language: Language;
}) {
  const counts = new Map(keys.map((key) => [key.key_id.toLowerCase(), key.count]));
  const lookup = (id: string) => {
    const aliases = keyAliases[id] ?? [id];
    return aliases.reduce((sum, alias) => sum + (counts.get(alias) ?? 0), 0);
  };
  const max = Math.max(1, ...keys.map((key) => key.count));

  const renderRow = (row: KeySpec[], keyPrefix: string) => {
    const total = row.reduce((sum, key) => sum + (key.width ?? 1), 0);
    return (
      <div
        className="key-row"
        key={keyPrefix}
        style={{ "--key-count": total } as React.CSSProperties}
      >
        {row.map((key, index) => {
          const count = lookup(key.id);
          const intensity = count / max;
          return (
            <button
              className="keycap"
              type="button"
              key={`${keyPrefix}-${key.id}-${index}`}
              style={
                {
                  "--key-width": key.width ?? 1,
                  "--heat": intensity,
                } as React.CSSProperties
              }
              aria-label={`${key.id}: ${count} ${language === "zh" ? "次" : "presses"}`}
              title={`${key.id.toUpperCase()} · ${compactNumber(count, language)}`}
            >
              {key.secondary && <span className="key-secondary">{key.secondary}</span>}
              <span>{key.label}</span>
              <small>{count > 0 ? compactNumber(count, language) : ""}</small>
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div className="keyboard-heatmap">
      <div className="keyboard-main">
        <div className="function-row">
          {renderRow(functionKeys, "function")}
        </div>
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
