import { useCallback, useEffect, useRef, useState } from "react";
import {
  checkForUpdate,
  installPendingUpdate,
  relaunchApp,
} from "../lib/ipc";
import {
  AUTO_CHECK_DELAY_MS,
  type UpdatePhase,
  readLastUpdateCheck,
  relativeCheckTime,
  shouldAutoCheck,
  updateErrorDetail,
  writeLastUpdateCheck,
} from "../lib/updater";
import { resolveLanguage } from "../lib/format";
import { dictionary } from "../i18n";
import type { AppSettings } from "../types";

export function useUpdater(
  settings: AppSettings,
  ready: boolean,
  notify: (message: string) => void,
) {
  const [phase, setPhase] = useState<UpdatePhase>({ kind: "idle" });
  const [lastChecked, setLastChecked] = useState<number | null>(() =>
    readLastUpdateCheck(),
  );
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const availableVersionRef = useRef<string | null>(null);
  const checkUpdatesRef = useRef(settings.check_updates);
  checkUpdatesRef.current = settings.check_updates;
  const checking = useRef(false);
  const phaseRef = useRef(phase);
  const mounted = useRef(true);
  const language = resolveLanguage(settings.language);
  const t = dictionary(language);
  phaseRef.current = phase;
  const setUpdatePhase = useCallback((next: UpdatePhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const check = useCallback(
    async ({ manual }: { manual: boolean }) => {
      if (
        checking.current ||
        phaseRef.current.kind === "downloading" ||
        phaseRef.current.kind === "ready"
      ) {
        return;
      }
      checking.current = true;
      setUpdatePhase({ kind: "checking" });
      try {
        const result = await checkForUpdate(manual);
        if (result.kind === "unavailable") {
          setUpdatePhase({ kind: "idle" });
          return;
        }
        const now = Date.now();
        writeLastUpdateCheck(now);
        if (!mounted.current) {
          return;
        }
        setLastChecked(now);
        if (result.kind === "available") {
          const { update } = result;
          availableVersionRef.current = update.version;
          setDismissedVersion(null);
          setNotesOpen(false);
          setUpdatePhase({
            kind: "available",
            version: update.version,
            notes: update.notes,
            date: update.date,
          });
        } else {
          setUpdatePhase({ kind: "upToDate" });
        }
      } catch (cause) {
        if (!mounted.current) {
          return;
        }
        // Failed attempts still count toward the daily automatic-check limit,
        // so an offline machine does not retry every hour.
        const now = Date.now();
        writeLastUpdateCheck(now);
        setLastChecked(now);
        const detail = updateErrorDetail(cause);
        setUpdatePhase({ kind: "error", detail });
        if (manual) {
          notify(t.updates.failedToast);
        }
      } finally {
        checking.current = false;
      }
    },
    [notify, setUpdatePhase, t],
  );

  const autoCheckBlocked = phase.kind === "downloading" || phase.kind === "ready";
  useEffect(() => {
    if (!ready || !settings.check_updates || autoCheckBlocked) {
      return;
    }
    let timer: number | null = null;
    const schedule = () => {
      if (shouldAutoCheck({ check_updates: checkUpdatesRef.current })) {
        timer = window.setTimeout(() => void check({ manual: false }), AUTO_CHECK_DELAY_MS);
      }
    };
    schedule();
    const interval = window.setInterval(schedule, 60 * 60 * 1000);
    return () => {
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      window.clearInterval(interval);
    };
  }, [autoCheckBlocked, check, ready, settings.check_updates]);

  const install = useCallback(async () => {
    if (phase.kind !== "available") {
      return;
    }
    setUpdatePhase({ kind: "downloading", progress: 0 });
    try {
      await installPendingUpdate((progress) => {
        if (mounted.current) {
          setUpdatePhase({ kind: "downloading", progress });
        }
      });
      if (mounted.current) {
        setUpdatePhase({ kind: "ready" });
      }
    } catch (cause) {
      if (!mounted.current) {
        return;
      }
      setUpdatePhase({ kind: "error", detail: updateErrorDetail(cause) });
      notify(t.updates.installFailed);
    }
  }, [notify, phase, setUpdatePhase, t]);

  const restart = useCallback(async () => {
    try {
      await relaunchApp();
    } catch {
      notify(t.errors.generic);
    }
  }, [notify, t]);

  const dismiss = useCallback(() => {
    if (phase.kind === "available" || phase.kind === "downloading" || phase.kind === "ready") {
      setDismissedVersion(availableVersionRef.current);
    }
  }, [phase]);

  return {
    phase,
    lastChecked,
    notesOpen,
    setNotesOpen,
    check,
    install,
    restart,
    dismiss,
    availableVersion: availableVersionRef.current,
    lastCheckedLabel: relativeCheckTime(lastChecked, t),
    bannerVisible:
      (phase.kind === "available" ||
        phase.kind === "downloading" ||
        phase.kind === "ready") &&
      dismissedVersion !== availableVersionRef.current,
  };
}
