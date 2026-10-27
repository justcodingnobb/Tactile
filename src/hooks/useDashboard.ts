import { useCallback, useEffect, useRef, useState } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { makeEmptyStats } from "../lib/demo";
import { applyPulse, hasCounts } from "../lib/live";
import { liveBus } from "../lib/liveBus";
import {
  emptyHeatmap,
  getDashboard,
  onLivePulse,
  onStatsFlushed,
  setLiveEnabled,
} from "../lib/ipc";
import { todayIso } from "../lib/format";
import type { Heatmap, LivePulse, StatsRequest, StatsSnapshot } from "../types";

/** Re-query after a flush at most this often; live pulses fill the gap. */
const FLUSH_REFRESH_MS = 10_000;
const DAY_CHECK_MS = 60_000;
/** Pulses kept for re-application after a refresh; bounded for long sessions. */
const PULSE_BUFFER_LIMIT = 2_000;

interface View {
  stats: StatsSnapshot;
  heatmap: Heatmap;
}

/** Subscribes to a Tauri event for the lifetime of the component. */
function useSubscription(subscribe: () => Promise<UnlistenFn>) {
  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    subscribe()
      .then((fn) => (disposed ? fn() : (unlisten = fn)))
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [subscribe]);
}

/**
 * Loads statistics for `request` and keeps them current:
 * - live pulses are merged immediately (and fanned out for animation),
 * - stored data is re-queried after flushes, on focus and when the day rolls,
 * - pulses received while a query is in flight are re-applied to its result,
 *   using `live_seq` so nothing is counted twice.
 */
export function useDashboard(request: StatsRequest, reloadKey: string) {
  const [view, setView] = useState<View>(() => ({
    stats: makeEmptyStats(),
    heatmap: emptyHeatmap(),
  }));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const baseSeq = useRef(0);
  const buffer = useRef<LivePulse[]>([]);
  const generation = useRef(0);
  const lastRefresh = useRef(0);
  const pendingRefresh = useRef<number | null>(null);
  const requestRef = useRef(request);
  requestRef.current = request;

  const refresh = useCallback(async () => {
    const current = ++generation.current;
    lastRefresh.current = Date.now();
    try {
      const dashboard = await getDashboard(requestRef.current);
      if (current !== generation.current) {
        return;
      }
      baseSeq.current = dashboard.live_seq;
      buffer.current = buffer.current.filter((pulse) => pulse.seq > dashboard.live_seq);
      let next: View = { stats: dashboard.stats, heatmap: dashboard.heatmap };
      for (const pulse of buffer.current) {
        next = applyPulse(next.stats, next.heatmap, pulse, dashboard.live_seq) ?? next;
      }
      setView(next);
      setError(null);
    } catch (cause) {
      if (current === generation.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (current === generation.current) {
        setLoading(false);
      }
    }
  }, []);

  const scheduleRefresh = useCallback(() => {
    if (pendingRefresh.current !== null) {
      return;
    }
    const wait = Math.max(0, FLUSH_REFRESH_MS - (Date.now() - lastRefresh.current));
    pendingRefresh.current = window.setTimeout(() => {
      pendingRefresh.current = null;
      if (document.visibilityState === "visible") {
        void refresh();
      }
    }, wait);
  }, [refresh]);

  // Reload whenever the range or data source changes.
  const requestKey = JSON.stringify(request);
  useEffect(() => {
    buffer.current = [];
    void refresh();
  }, [requestKey, reloadKey, refresh]);

  useEffect(
    () => () => {
      if (pendingRefresh.current !== null) {
        window.clearTimeout(pendingRefresh.current);
      }
    },
    [],
  );

  const onPulse = useCallback(
    () =>
      onLivePulse((pulse) => {
        liveBus.emit(pulse);
        if (!hasCounts(pulse)) {
          return;
        }
        buffer.current.push(pulse);
        if (buffer.current.length > PULSE_BUFFER_LIMIT) {
          buffer.current.splice(0, buffer.current.length - PULSE_BUFFER_LIMIT);
        }
        setView((previous) =>
          applyPulse(previous.stats, previous.heatmap, pulse, baseSeq.current) ?? previous,
        );
      }),
    [],
  );
  useSubscription(onPulse);
  const onFlushed = useCallback(() => onStatsFlushed(scheduleRefresh), [scheduleRefresh]);
  useSubscription(onFlushed);

  // Live pulses only while visible; catch up when the window comes back.
  useEffect(() => {
    const sync = () => {
      const visible = document.visibilityState === "visible";
      void setLiveEnabled(visible).catch(() => undefined);
      if (visible) {
        void refresh();
      }
    };
    void setLiveEnabled(document.visibilityState === "visible").catch(() => undefined);
    document.addEventListener("visibilitychange", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      void setLiveEnabled(false).catch(() => undefined);
    };
  }, [refresh]);

  // Preset ranges move at midnight.
  useEffect(() => {
    let day = todayIso();
    const timer = window.setInterval(() => {
      const today = todayIso();
      if (today !== day) {
        day = today;
        void refresh();
      }
    }, DAY_CHECK_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return { ...view, loading, error, refresh };
}
