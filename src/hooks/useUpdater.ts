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
  updateErrorMessage,
  writeLastUpdateCheck,
} from "../lib/updater";
import { resolveLanguage } from "../lib/format";
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
  const mounted = useRef(true);
  const language = resolveLanguage(settings.language);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const check = useCallback(
    async ({ manual }: { manual: boolean }) => {
      if (checking.current) {
        return;
      }
      checking.current = true;
      setPhase({ kind: "checking" });
      try {
        const result = await checkForUpdate(manual);
        if (result.kind === "unavailable") {
          setPhase({ kind: "idle" });
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
          setPhase({
            kind: "available",
            version: update.version,
            notes: update.notes,
            date: update.date,
          });
        } else {
          setPhase({ kind: "upToDate" });
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
        const message = updateErrorMessage(cause);
        setPhase({ kind: "error", message });
        if (manual) {
          notify(message);
        }
      } finally {
        checking.current = false;
      }
    },
    [notify],
  );

  useEffect(() => {
    if (!ready || !settings.check_updates) {
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
  }, [check, ready, settings.check_updates]);

  const install = useCallback(async () => {
    if (phase.kind !== "available") {
      return;
    }
    setPhase({ kind: "downloading", progress: 0 });
    try {
      await installPendingUpdate((progress) => {
        if (mounted.current) {
          setPhase({ kind: "downloading", progress });
        }
      });
      if (mounted.current) {
        setPhase({ kind: "ready" });
      }
    } catch (cause) {
      if (!mounted.current) {
        return;
      }
      const message = updateErrorMessage(cause);
      setPhase({ kind: "error", message });
      notify(message);
    }
  }, [notify, phase]);

  const restart = useCallback(async () => {
    try {
      await relaunchApp();
    } catch (cause) {
      notify(updateErrorMessage(cause));
    }
  }, [notify]);

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
    lastCheckedLabel: relativeCheckTime(lastChecked, language),
    bannerVisible:
      (phase.kind === "available" ||
        phase.kind === "downloading" ||
        phase.kind === "ready") &&
      dismissedVersion !== availableVersionRef.current,
  };
}
