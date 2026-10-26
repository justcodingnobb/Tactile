import { useEffect, useRef } from "react";
import type { Heatmap } from "../types";
import type { Language } from "../lib/format";
import { compactNumber } from "../lib/format";

export function ClickHeatmapCanvas({
  heatmap,
  language,
}: {
  heatmap: Heatmap;
  language: Language;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));
      const context = canvas.getContext("2d");
      if (!context) {
        return;
      }
      context.scale(ratio, ratio);
      const width = rect.width;
      const height = rect.height;
      const cellWidth = width / heatmap.columns;
      const cellHeight = height / heatmap.rows;
      context.clearRect(0, 0, width, height);
      const background = getComputedStyle(document.documentElement)
        .getPropertyValue("--heat-bg")
        .trim();
      context.fillStyle = background || "#ece9df";
      context.fillRect(0, 0, width, height);
      const max = Math.max(1, heatmap.max_value);
      heatmap.cells.forEach((value, index) => {
        const column = index % heatmap.columns;
        const row = Math.floor(index / heatmap.columns);
        const intensity = Math.pow(value / max, 0.62);
        if (intensity <= 0.01) {
          return;
        }
        context.fillStyle =
          intensity > 0.68
            ? `rgba(255, 90, 31, ${0.35 + intensity * 0.65})`
            : `rgba(216, 255, 62, ${0.2 + intensity * 0.72})`;
        const inset = Math.max(1, cellWidth * 0.07);
        context.fillRect(
          column * cellWidth + inset,
          row * cellHeight + inset,
          Math.max(1, cellWidth - inset * 2),
          Math.max(1, cellHeight - inset * 2),
        );
      });
      context.strokeStyle = "rgba(255,255,255,0.15)";
      context.lineWidth = 1;
      for (let column = 1; column < heatmap.columns; column += 1) {
        context.beginPath();
        context.moveTo(column * cellWidth, 0);
        context.lineTo(column * cellWidth, height);
        context.stroke();
      }
      for (let row = 1; row < heatmap.rows; row += 1) {
        context.beginPath();
        context.moveTo(0, row * cellHeight);
        context.lineTo(width, row * cellHeight);
        context.stroke();
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [heatmap]);

  return (
    <div className="click-heatmap">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`${compactNumber(heatmap.filtered_total, language)} clicks distributed across a ${heatmap.columns} by ${heatmap.rows} main-display grid`}
      />
      <span className="heatmap-corner top-left">0,0</span>
      <span className="heatmap-corner top-right">{heatmap.columns - 1},0</span>
      <span className="heatmap-corner bottom-left">0,{heatmap.rows - 1}</span>
    </div>
  );
}
