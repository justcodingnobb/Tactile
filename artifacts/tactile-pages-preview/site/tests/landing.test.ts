// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { initLanding } from "../assets/main.js";
import { TRANSLATIONS } from "../assets/i18n.js";
import { APP_VERSION } from "../assets/version.js";

describe("landing demo", () => {
  let systemDark = false;
  let systemThemeListener: ((event: MediaQueryListEvent) => void) | undefined;

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-theme-mode");
    document.head.querySelector('meta[name="theme-color"]')?.remove();
    document.head.querySelector("title")?.remove();
    document.head.querySelector('meta[name="description"]')?.remove();
    document.head.querySelector("#structured-data")?.remove();
    document.head.insertAdjacentHTML(
      "beforeend",
      `
        <meta name="theme-color" content="#ece9df" />
        <meta name="description" data-i18n-meta="metaDescription" content="" />
        <title data-i18n="pageTitle">指痕 Tactile — 只记节奏，不记文字</title>
        <script type="application/ld+json" id="structured-data">
          {"@context":"https://schema.org","@type":"SoftwareApplication","description":"zh"}
        </script>
      `,
    );
    systemDark = false;
    systemThemeListener = undefined;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn((query: string) => ({
        matches: query === "(prefers-color-scheme: dark)" && systemDark,
        media: query,
        addEventListener: vi.fn((event: string, listener: (event: MediaQueryListEvent) => void) => {
          if (event === "change") {
            systemThemeListener = listener;
          }
        }),
        removeEventListener: vi.fn(),
      })),
    });
    document.body.innerHTML = `
      <main data-landing>
        <kbd data-code="KeyA">A</kbd>
        <output data-key-label>—</output>
        <output data-key-count>0</output>
        <div data-heatmap data-columns="4" data-rows="4"></div>
        <output data-heatmap-total>0</output>
        <span data-app-version>0.0.0</span>
        <span data-i18n="hero.download">下载 Beta</span>
        <div data-theme-options role="radiogroup" aria-label="页面主题">
          <button type="button" role="radio" data-theme-value="light" aria-checked="false">
            亮
          </button>
          <button type="button" role="radio" data-theme-value="dark" aria-checked="false">
            暗
          </button>
          <button type="button" role="radio" data-theme-value="system" aria-checked="true">
            跟随系统
          </button>
        </div>
        <div data-language-options role="radiogroup" aria-label="页面语言">
          <button
            class="is-active"
            type="button"
            role="radio"
            data-language-value="zh"
            aria-checked="true"
            tabindex="0"
          >
            中文
          </button>
          <button
            type="button"
            role="radio"
            data-language-value="en"
            aria-checked="false"
            tabindex="-1"
          >
            EN
          </button>
        </div>
      </main>
    `;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lights the pressed key and updates the live key readout", () => {
    const cleanup = initLanding(document, window);
    const key = document.querySelector<HTMLElement>('[data-code="KeyA"]')!;

    window.dispatchEvent(
      new KeyboardEvent("keydown", { code: "KeyA", key: "a", bubbles: true }),
    );

    expect(key.classList.contains("is-lit")).toBe(true);
    expect(document.querySelector("[data-key-label]")?.textContent).toBe("A");
    expect(document.querySelector("[data-key-count]")?.textContent).toBe("1");

    vi.advanceTimersByTime(240);
    expect(key.classList.contains("is-lit")).toBe(false);
    cleanup();
  });

  it("adds a click to the selected heatmap cell", () => {
    const cleanup = initLanding(document, window);
    const heatmap = document.querySelector<HTMLElement>("[data-heatmap]")!;
    const cells = [...heatmap.querySelectorAll<HTMLButtonElement>("[data-heatmap-cell]")];
    const total = document.querySelector<HTMLOutputElement>("[data-heatmap-total]")!;
    const before = Number(total.value);
    const cellBefore = Number(cells[5].dataset.count);

    cells[5].click();

    expect(cells).toHaveLength(16);
    expect(Number(cells[5].dataset.count)).toBe(cellBefore + 1);
    expect(Number(total.value)).toBe(before + 1);
    expect(cells[5].style.getPropertyValue("--heat")).not.toBe("");
    cleanup();
  });

  it("reads and renders the project version from the generated site version", async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(process.cwd(), "package.json"), "utf8"),
    );
    const cleanup = initLanding(document, window);

    expect(APP_VERSION).toBe(packageJson.version);
    expect(document.querySelector("[data-app-version]")?.textContent).toBe(
      packageJson.version,
    );
    cleanup();
  });

  it("defaults to Chinese and switches the complete document to English", () => {
    const cleanup = initLanding(document, window);
    const zh = document.querySelector<HTMLButtonElement>(
      '[data-language-value="zh"]',
    )!;
    const en = document.querySelector<HTMLButtonElement>(
      '[data-language-value="en"]',
    )!;

    expect(document.documentElement.lang).toBe("zh-CN");
    expect(document.documentElement.dataset.language).toBe("zh");
    expect(document.title).toBe(TRANSLATIONS.zh.pageTitle);
    expect(document.querySelector('[data-i18n="hero.download"]')?.textContent).toBe(
      TRANSLATIONS.zh["hero.download"],
    );
    expect(zh.getAttribute("aria-checked")).toBe("true");

    en.click();

    expect(document.documentElement.lang).toBe("en");
    expect(document.documentElement.dataset.language).toBe("en");
    expect(document.title).toBe(TRANSLATIONS.en.pageTitle);
    expect(document.querySelector('[data-i18n="hero.download"]')?.textContent).toBe(
      TRANSLATIONS.en["hero.download"],
    );
    expect(
      document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content,
    ).toBe(TRANSLATIONS.en.metaDescription);
    expect(document.querySelector("#structured-data")?.textContent).toContain(
      TRANSLATIONS.en.structuredDescription,
    );
    expect(en.getAttribute("aria-checked")).toBe("true");
    expect(en.tabIndex).toBe(0);
    expect(zh.getAttribute("aria-checked")).toBe("false");
    expect(localStorage.getItem("tactile-language")).toBe("en");
    cleanup();
  });

  it("restores a saved language and supports arrow-key navigation", () => {
    localStorage.setItem("tactile-language", "en");
    const cleanup = initLanding(document, window);
    const zh = document.querySelector<HTMLButtonElement>(
      '[data-language-value="zh"]',
    )!;
    const en = document.querySelector<HTMLButtonElement>(
      '[data-language-value="en"]',
    )!;

    expect(document.documentElement.dataset.language).toBe("en");
    expect(en.getAttribute("aria-checked")).toBe("true");

    en.focus();
    en.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
    );

    expect(document.documentElement.dataset.language).toBe("zh");
    expect(zh.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(zh);
    expect(localStorage.getItem("tactile-language")).toBe("zh");
    cleanup();
  });

  it("keeps the Chinese and English dictionaries in sync", () => {
    expect(Object.keys(TRANSLATIONS.en).sort()).toEqual(
      Object.keys(TRANSLATIONS.zh).sort(),
    );
  });

  it("uses one tab stop and arrow keys inside the heatmap", () => {
    const cleanup = initLanding(document, window);
    const cells = [
      ...document.querySelectorAll<HTMLButtonElement>("[data-heatmap-cell]"),
    ];
    const tabStops = cells.filter((cell) => cell.tabIndex === 0);

    expect(tabStops).toHaveLength(1);
    cells[0].focus();
    cells[0].dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );

    expect(document.activeElement).toBe(cells[1]);
    expect(cells[1].tabIndex).toBe(0);
    expect(cells[0].tabIndex).toBe(-1);
    expect(document.querySelector("[data-key-count]")?.textContent).toBe("0");
    cleanup();
  });

  it("defaults to the system theme and marks the system option as selected", () => {
    const cleanup = initLanding(document, window);
    const system = document.querySelector<HTMLButtonElement>(
      '[data-theme-value="system"]',
    )!;

    expect(document.documentElement.dataset.themeMode).toBe("system");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(system.getAttribute("aria-checked")).toBe("true");
    expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content).toBe(
      "#ece9df",
    );
    expect(localStorage.getItem("tactile-theme")).toBeNull();
    cleanup();
  });

  it("resolves the system preference and follows later system changes", () => {
    systemDark = true;
    const cleanup = initLanding(document, window);
    const system = document.querySelector<HTMLButtonElement>(
      '[data-theme-value="system"]',
    )!;

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(system.getAttribute("aria-checked")).toBe("true");

    systemDark = false;
    systemThemeListener?.({ matches: false } as MediaQueryListEvent);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.dataset.themeMode).toBe("system");
    cleanup();
  });

  it("remembers an explicit light preference and ignores system changes", () => {
    const cleanup = initLanding(document, window);
    const light = document.querySelector<HTMLButtonElement>(
      '[data-theme-value="light"]',
    )!;

    light.click();
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.dataset.themeMode).toBe("light");
    expect(light.getAttribute("aria-checked")).toBe("true");
    expect(localStorage.getItem("tactile-theme")).toBe("light");

    systemDark = true;
    systemThemeListener?.({ matches: true } as MediaQueryListEvent);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.dataset.themeMode).toBe("light");
    cleanup();
  });

  it("remembers an explicit dark preference and ignores system changes", () => {
    const cleanup = initLanding(document, window);
    const dark = document.querySelector<HTMLButtonElement>(
      '[data-theme-value="dark"]',
    )!;

    dark.click();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.themeMode).toBe("dark");
    expect(dark.getAttribute("aria-checked")).toBe("true");
    expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content).toBe(
      "#171713",
    );
    expect(localStorage.getItem("tactile-theme")).toBe("dark");

    systemDark = false;
    systemThemeListener?.({ matches: false } as MediaQueryListEvent);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.themeMode).toBe("dark");
    cleanup();
  });

  it("returns to following the system after an explicit preference", () => {
    systemDark = true;
    const cleanup = initLanding(document, window);
    const system = document.querySelector<HTMLButtonElement>(
      '[data-theme-value="system"]',
    )!;
    const light = document.querySelector<HTMLButtonElement>(
      '[data-theme-value="light"]',
    )!;

    expect(document.documentElement.dataset.theme).toBe("dark");
    light.click();
    expect(document.documentElement.dataset.theme).toBe("light");

    system.click();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.themeMode).toBe("system");
    expect(system.getAttribute("aria-checked")).toBe("true");
    expect(localStorage.getItem("tactile-theme")).toBe("system");

    systemThemeListener?.({ matches: false } as MediaQueryListEvent);
    expect(document.documentElement.dataset.theme).toBe("light");
    cleanup();
  });

  it("supports arrow-key navigation in the theme radiogroup", () => {
    const cleanup = initLanding(document, window);
    const light = document.querySelector<HTMLButtonElement>(
      '[data-theme-value="light"]',
    )!;
    const dark = document.querySelector<HTMLButtonElement>(
      '[data-theme-value="dark"]',
    )!;

    light.focus();
    light.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );

    expect(document.documentElement.dataset.themeMode).toBe("dark");
    expect(dark.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(dark);
    cleanup();
  });

  it("ships a self-contained project-page document", async () => {
    const html = await readFile(resolve(process.cwd(), "site/index.html"), "utf8");
    const translationKeys = [
      ...html.matchAll(/data-i18n(?:-aria-label|-meta)?="([^"]+)"/g),
    ].map((match) => match[1]);

    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<html lang="zh-CN">');
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toContain('href="./assets/styles.css"');
    expect(html).toContain('src="./assets/main.js"');
    expect(html).toContain("https://github.com/justcodingnobb/Tactile/releases/latest");
    expect(html).toContain('id="privacy"');
    expect(html).toContain('id="download"');
    expect(html).toContain("data-heatmap");
    expect(html).toContain("data-theme-options");
    expect(html).toContain("data-language-options");
    expect(html).toContain('data-language-value="zh"');
    expect(html).toContain('data-language-value="en"');
    expect(html).toContain('data-theme-value="light"');
    expect(html).toContain('data-theme-value="dark"');
    expect(html).toContain('data-theme-value="system"');
    expect(html).toContain("跟随系统");
    expect(html.match(/data-app-version/g)).toHaveLength(2);
    expect(html).not.toContain("1.0.0-beta.5");
    expect(html).toContain('data-i18n="download.versionLabel"');
    expect(html).not.toContain("LATEST PUBLIC BETA ·");
    expect(html).not.toMatch(/黑色|白色|黑白/);
    expect(html).not.toMatch(/fonts\.googleapis|googletagmanager|google-analytics/i);
    expect(html).not.toMatch(/(?:src|href)="\/assets\//);
    expect(translationKeys.length).toBeGreaterThan(100);
    translationKeys.forEach((key) => {
      expect(TRANSLATIONS.zh).toHaveProperty(key);
      expect(TRANSLATIONS.en).toHaveProperty(key);
    });
  });

  it("deploys only the static site through GitHub Pages actions", async () => {
    const workflow = await readFile(
      resolve(process.cwd(), ".github/workflows/pages.yml"),
      "utf8",
    );

    expect(workflow).toContain("branches: [main]");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("pages: write");
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("uses: actions/deploy-pages@v4");
    expect(workflow).toContain("path: ./site");
    expect(workflow).not.toContain("npm ci");
  });
});
