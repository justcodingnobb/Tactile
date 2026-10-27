import { useCallback, useEffect, useRef, useState } from "react";

const TOAST_MS = 3200;

export function useToast() {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const show = useCallback((next: string) => {
    setMessage(next);
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
    }
    timer.current = window.setTimeout(() => setMessage(null), TOAST_MS);
  }, []);
  useEffect(
    () => () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
      }
    },
    [],
  );
  return { message, show };
}

export function Toast({ message }: { message: string | null }) {
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {message && <div className="toast">{message}</div>}
    </div>
  );
}
