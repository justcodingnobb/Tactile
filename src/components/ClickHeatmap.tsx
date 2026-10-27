import { useEffect, useMemo, useRef, useState } from "react";
import type { Heatmap } from "../types";
import type { Language } from "../lib/format";
import { compactNumber } from "../lib/format";

/** Warm sequential ramp; stops are [position, r, g, b]. */
const RAMP: Array<[number, number, number, number]> = [
  [0, 46, 44, 38],
  [0.25, 120, 54, 34],
  [0.55, 230, 92, 40],
  [0.8, 255, 168, 72],
  [1, 255, 236, 170],
];
/** Blur radius in cells; spreads each cell into its neighbours. */
const BLUR_CELLS = 0.9;
const GAMMA = 0.55;

function rampColor(t: number): [number, number, number] {
  const value = Math.min(1, Math.max(0, t));
  for (let index = 1; index < RAMP.length; index += 1) {
    const [end, r1, g1, b1] = RAMP[index];
    if (value <= end) {
      const [start, r0, g0, b0] = RAMP[index - 1];
      const mix = (value - start) / (end - start || 1);
      return [r0 + (r1 - r0) * mix, g0 + (g1 - g0) * mix, b0 + (b1 - b0) * mix];
    }
  }
  const [, r, g, b] = RAMP[RAMP.length - 1];
  return [r, g, b];
}

/** Renders the coarse grid into a small bitmap, then lets the canvas smooth it. */
function paint(canvas: HTMLCanvasElement, heatmap: Heatmap) {
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) {
    return;
  }
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * ratio);
  canvas.height = Math.round(rect.height * ratio);
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }
  const { columns, rows, cells } = heatmap;
  const source = document.createElement("canvas");
  source.width = columns;
  source.height = rows;
  const sourceContext = source.getContext("2d");
  if (!sourceContext || typeof sourceContext.createImageData !== "function") {
    return;
  }
  const image = sourceContext.createImageData(columns, rows);
  const max = Math.max(1, heatmap.max_value);
  for (let index = 0; index < columns * rows; index += 1) {
    const t = Math.pow((cells[index] ?? 0) / max, GAMMA);
    const [r, g, b] = rampColor(t);
    image.data.set([r, g, b, t > 0 ? 255 : 0], index * 4);
  }
  sourceContext.putImageData(image, 0, 0);
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  const [r, g, b] = rampColor(0);
  context.fillStyle = `rgb(${r}, ${g}, ${b})`;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  const blur = (canvas.width / columns) * BLUR_CELLS;
  context.filter = `blur(${blur}px)`;
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  context.filter = "none";
}

export function ClickHeatmapCanvas({
  heatmap,
  language,
  compact = false,
}: {
  heatmap: Heatmap;
  language: Language;
  compact?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<{ column: number; row: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => paint(canvas, heatmap));
    };
    schedule();
    const observer = new ResizeObserver(schedule);
    observer.observe(canvas);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [heatmap]);

  const hoverCount = hover ? (heatmap.cells[hover.row * heatmap.columns + hover.column] ?? 0) : 0;
  const share = useMemo(
    () => (heatmap.filtered_total > 0 ? hoverCount / heatmap.filtered_total : 0),
    [hoverCount, heatmap.filtered_total],
  );
  const empty = heatmap.filtered_total === 0;

  return (
    <div className={`click-heatmap${compact ? " is-compact" : ""}`}>
      <div className="click-heatmap-screen">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={
            language === "zh"
              ? `主屏点击热区，共 ${compactNumber(heatmap.filtered_total, language)} 次点击`
              : `Main display click heatmap, ${compactNumber(heatmap.filtered_total, language)} clicks`
          }
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const column = Math.floor(((event.clientX - rect.left) / rect.width) * heatmap.columns);
            const row = Math.floor(((event.clientY - rect.top) / rect.height) * heatmap.rows);
            setHover({
              column: Math.min(heatmap.columns - 1, Math.max(0, column)),
              row: Math.min(heatmap.rows - 1, Math.max(0, row)),
            });
          }}
          onMouseLeave={() => setHover(null)}
        />
        {hover && !empty && (
          <span
            className="heatmap-cursor"
            style={{
              left: `${(hover.column / heatmap.columns) * 100}%`,
              top: `${(hover.row / heatmap.rows) * 100}%`,
              width: `${100 / heatmap.columns}%`,
              height: `${100 / heatmap.rows}%`,
            }}
          />
        )}
        {empty && (
          <span className="heatmap-empty">
            {language === "zh" ? "还没有点击记录" : "No clicks recorded yet"}
          </span>
        )}
      </div>
      {!compact && (
        <div className="heatmap-footer">
          <div className="heatmap-scale" aria-hidden="true">
            <span>{language === "zh" ? "少" : "Fewer"}</span>
            <i />
            <span>{language === "zh" ? "多" : "More"}</span>
          </div>
          <span className="heatmap-readout" aria-live="polite">
            {hover && !empty
              ? `${compactNumber(hoverCount, language)} · ${(share * 100).toFixed(1)}%`
              : language === "zh"
                ? "悬停查看区域点击数"
                : "Hover to see clicks per area"}
          </span>
        </div>
      )}
    </div>
  );
}
