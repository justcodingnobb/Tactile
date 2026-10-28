import { TRANSLATIONS } from "./i18n.js";
import { APP_VERSION } from "./version.js";

const KEY_LABELS = {
  Space: "SPACE",
  Enter: "ENTER",
  Backspace: "DELETE",
  Tab: "TAB",
  Escape: "ESC",
  ShiftLeft: "SHIFT",
  ShiftRight: "SHIFT",
  ControlLeft: "CTRL",
  ControlRight: "CTRL",
  AltLeft: "ALT",
  AltRight: "ALT",
  MetaLeft: "CMD",
  MetaRight: "CMD",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

const HEATMAP_NAV_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);

export function keyLabel(code, fallback = "") {
  if (KEY_LABELS[code]) {
    return KEY_LABELS[code];
  }
  if (code.startsWith("Key")) {
    return code.slice(3);
  }
  if (code.startsWith("Digit")) {
    return code.slice(5);
  }
  if (fallback.length === 1) {
    return fallback.toUpperCase();
  }
  return fallback || code || "—";
}

export function initLanding(doc = document, win = window) {
  const root = doc.querySelector("[data-landing]");
  if (!root) {
    return () => {};
  }

  let pressCount = 0;
  const timers = new Set();
  const heatmap = root.querySelector("[data-heatmap]");
  const heatmapTotal = root.querySelector("[data-heatmap-total]");
  const themeOptions = root.querySelector("[data-theme-options]");
  const themeButtons = [...root.querySelectorAll("[data-theme-value]")];
  const languageOptions = root.querySelector("[data-language-options]");
  const languageButtons = [...root.querySelectorAll("[data-language-value]")];
  const themeColor = doc.querySelector('meta[name="theme-color"]');
  const versionElements = [...doc.querySelectorAll("[data-app-version]")];
  let heatmapCells = [];
  let heatmapMax = 1;
  let heatmapClicks = 0;
  let language = "zh";

  versionElements.forEach((element) => {
    element.textContent = APP_VERSION;
  });

  const validLanguages = new Set(Object.keys(TRANSLATIONS));
  try {
    const storedLanguage = win.localStorage.getItem("tactile-language");
    if (validLanguages.has(storedLanguage)) {
      language = storedLanguage;
    }
  } catch {
    // Use Chinese when storage is unavailable.
  }

  const translate = (key) =>
    TRANSLATIONS[language]?.[key] ?? TRANSLATIONS.zh[key] ?? key;

  const updateHeatmapTotal = () => {
    if (heatmapTotal) {
      heatmapTotal.value = String(heatmapClicks);
      heatmapTotal.textContent = heatmapClicks.toLocaleString(
        language === "en" ? "en-US" : "zh-CN",
      );
    }
  };

  const paintHeatmapCell = (cell) => {
    const count = Number(cell.dataset.count || 0);
    const strength = Math.min(1, 0.12 + (count / heatmapMax) * 0.88);
    cell.style.setProperty("--heat", `${Math.round(strength * 100)}%`);
    cell.setAttribute(
      "aria-label",
      translate("heatmap.cellLabel")
        .replace("{column}", String(Number(cell.dataset.column) + 1))
        .replace("{row}", String(Number(cell.dataset.row) + 1))
        .replace("{count}", String(count)),
    );
  };

  const applyLanguage = (nextLanguage) => {
    if (!validLanguages.has(nextLanguage)) {
      return;
    }
    language = nextLanguage;
    doc.documentElement.lang = translate("htmlLang");
    doc.documentElement.dataset.language = language;

    doc.querySelectorAll("[data-i18n]").forEach((element) => {
      element.textContent = translate(element.dataset.i18n);
    });
    doc.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
      element.setAttribute(
        "aria-label",
        translate(element.dataset.i18nAriaLabel),
      );
    });
    doc.querySelectorAll("[data-i18n-meta]").forEach((element) => {
      element.setAttribute("content", translate(element.dataset.i18nMeta));
    });

    const structuredData = doc.querySelector("#structured-data");
    if (structuredData) {
      const schema = JSON.parse(structuredData.textContent);
      schema.description = translate("structuredDescription");
      structuredData.textContent = JSON.stringify(schema, null, 2);
    }

    languageButtons.forEach((button) => {
      const selected = button.dataset.languageValue === language;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-checked", String(selected));
      button.tabIndex = selected ? 0 : -1;
    });

    updateHeatmapTotal();
    heatmapCells.forEach(paintHeatmapCell);
  };

  const selectLanguage = (nextLanguage) => {
    if (!validLanguages.has(nextLanguage)) {
      return;
    }
    applyLanguage(nextLanguage);
    try {
      win.localStorage.setItem("tactile-language", language);
    } catch {
      // Keep the in-memory language even if persistence is blocked.
    }
  };

  const onLanguageClick = (event) => {
    const button = event.target.closest?.("[data-language-value]");
    if (!button || !languageOptions?.contains(button)) {
      return;
    }
    selectLanguage(button.dataset.languageValue);
  };

  const onLanguageKeyDown = (event) => {
    const currentButton = event.target.closest?.("[data-language-value]");
    if (!currentButton || !languageOptions?.contains(currentButton)) {
      return;
    }
    const currentIndex = languageButtons.indexOf(currentButton);
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % languageButtons.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex =
        (currentIndex - 1 + languageButtons.length) % languageButtons.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = languageButtons.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    selectLanguage(languageButtons[nextIndex].dataset.languageValue);
    languageButtons[nextIndex].focus();
  };

  applyLanguage(language);
  languageOptions?.addEventListener("click", onLanguageClick);
  languageOptions?.addEventListener("keydown", onLanguageKeyDown);

  const onHeatmapClick = (event) => {
    const cell = event.target.closest?.("[data-heatmap-cell]");
    if (!cell || !heatmap?.contains(cell)) {
      return;
    }
    const nextCount = Number(cell.dataset.count || 0) + 1;
    cell.dataset.count = String(nextCount);
    heatmapClicks += 1;
    heatmapMax = Math.max(heatmapMax, nextCount);
    heatmapCells.forEach(paintHeatmapCell);
    updateHeatmapTotal();
  };

  const onHeatmapKeyDown = (event) => {
    const cell = event.target.closest?.("[data-heatmap-cell]");
    if (!cell || !heatmap?.contains(cell)) {
      return;
    }
    const directions = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const direction = directions[event.key];
    if (!direction) {
      return;
    }
    event.preventDefault();
    const columns = Number(heatmap.dataset.columns || 24);
    const rows = Number(heatmap.dataset.rows || 16);
    const column = Number(cell.dataset.column);
    const row = Number(cell.dataset.row);
    const nextColumn = (column + direction[0] + columns) % columns;
    const nextRow = (row + direction[1] + rows) % rows;
    const nextCell = heatmapCells[nextRow * columns + nextColumn];
    heatmapCells.forEach((item) => {
      item.tabIndex = -1;
    });
    nextCell.tabIndex = 0;
    nextCell.focus();
  };

  if (heatmap) {
    const columns = Math.max(1, Number(heatmap.dataset.columns || 24));
    const rows = Math.max(1, Number(heatmap.dataset.rows || 16));
    const centerX = columns * 0.42;
    const centerY = rows * 0.48;
    heatmap.replaceChildren();
    heatmap.style.setProperty("--columns", String(columns));
    heatmap.style.setProperty("--rows", String(rows));

    heatmapCells = Array.from({ length: columns * rows }, (_, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const distance = Math.hypot(column - centerX, row - centerY);
      const count = Math.max(0, Math.round(18 - distance * 2.7 - (index % 5)));
      const cell = doc.createElement("button");
      cell.type = "button";
      cell.className = "heatmap-cell";
      cell.dataset.heatmapCell = "";
      cell.dataset.column = String(column);
      cell.dataset.row = String(row);
      cell.dataset.count = String(count);
      cell.tabIndex = index === 0 ? 0 : -1;
      heatmapClicks += count;
      heatmapMax = Math.max(heatmapMax, count);
      return cell;
    });

    heatmap.append(...heatmapCells);
    heatmapCells.forEach(paintHeatmapCell);
    heatmap.addEventListener("click", onHeatmapClick);
    heatmap.addEventListener("keydown", onHeatmapKeyDown);
    updateHeatmapTotal();
  }

  const validThemeModes = new Set(["light", "dark", "system"]);
  let themeMode = "system";
  try {
    const storedTheme = win.localStorage.getItem("tactile-theme");
    if (validThemeModes.has(storedTheme)) {
      themeMode = storedTheme;
    }
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
  const systemTheme = win.matchMedia?.("(prefers-color-scheme: dark)");
  let systemPrefersDark = Boolean(systemTheme?.matches);

  const resolveTheme = () => {
    if (themeMode === "system") {
      return systemPrefersDark ? "dark" : "light";
    }
    return themeMode;
  };

  const applyTheme = () => {
    const resolvedTheme = resolveTheme();
    doc.documentElement.dataset.theme = resolvedTheme;
    doc.documentElement.dataset.themeMode = themeMode;
    if (themeColor) {
      themeColor.content = resolvedTheme === "dark" ? "#171713" : "#ece9df";
    }
    themeButtons.forEach((button) => {
      const selected = button.dataset.themeValue === themeMode;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-checked", String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
  };

  const onSystemThemeChange = (event) => {
    systemPrefersDark = event.matches;
    applyTheme();
  };

  const selectTheme = (nextMode) => {
    if (!validThemeModes.has(nextMode)) {
      return;
    }
    themeMode = nextMode;
    applyTheme();
    try {
      win.localStorage.setItem("tactile-theme", themeMode);
    } catch {
      // Keep the in-memory theme even if persistence is blocked.
    }
  };

  const onThemeClick = (event) => {
    const button = event.target.closest?.("[data-theme-value]");
    if (!button || !themeOptions?.contains(button)) {
      return;
    }
    selectTheme(button.dataset.themeValue);
  };

  const onThemeKeyDown = (event) => {
    const currentButton = event.target.closest?.("[data-theme-value]");
    if (!currentButton || !themeOptions?.contains(currentButton)) {
      return;
    }
    const currentIndex = themeButtons.indexOf(currentButton);
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % themeButtons.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + themeButtons.length) % themeButtons.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = themeButtons.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    selectTheme(themeButtons[nextIndex].dataset.themeValue);
    themeButtons[nextIndex].focus();
  };

  applyTheme();
  themeOptions?.addEventListener("click", onThemeClick);
  themeOptions?.addEventListener("keydown", onThemeKeyDown);
  systemTheme?.addEventListener?.("change", onSystemThemeChange);

  const onKeyDown = (event) => {
    if (
      HEATMAP_NAV_KEYS.has(event.code || event.key) &&
      event.target?.closest?.("[data-heatmap]")
    ) {
      return;
    }
    const label = keyLabel(event.code, event.key);
    const keyElement = [...root.querySelectorAll("[data-code]")].find(
      (element) => element.dataset.code === event.code,
    );
    const labelElement = root.querySelector("[data-key-label]");
    const countElement = root.querySelector("[data-key-count]");

    pressCount += 1;
    if (labelElement) {
      labelElement.textContent = label;
    }
    if (countElement) {
      countElement.textContent = String(pressCount);
    }
    if (keyElement) {
      keyElement.classList.add("is-lit");
      const timer = win.setTimeout(() => {
        keyElement.classList.remove("is-lit");
        timers.delete(timer);
      }, 180);
      timers.add(timer);
    }
  };

  win.addEventListener("keydown", onKeyDown);

  return () => {
    win.removeEventListener("keydown", onKeyDown);
    heatmap?.removeEventListener("click", onHeatmapClick);
    heatmap?.removeEventListener("keydown", onHeatmapKeyDown);
    themeOptions?.removeEventListener("click", onThemeClick);
    themeOptions?.removeEventListener("keydown", onThemeKeyDown);
    languageOptions?.removeEventListener("click", onLanguageClick);
    languageOptions?.removeEventListener("keydown", onLanguageKeyDown);
    systemTheme?.removeEventListener?.("change", onSystemThemeChange);
    timers.forEach((timer) => win.clearTimeout(timer));
    timers.clear();
  };
}

if (typeof document !== "undefined" && document.querySelector("[data-landing]")) {
  initLanding();
}
