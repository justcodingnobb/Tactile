import type { LivePulse } from "../types";

type Listener = (pulse: LivePulse) => void;

const listeners = new Set<Listener>();

/**
 * Fan-out for live pulses. Visual consumers (keyboard animation) subscribe
 * here directly so a keystroke does not re-render the whole app.
 */
export const liveBus = {
  emit(pulse: LivePulse) {
    for (const listener of listeners) {
      listener(pulse);
    }
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
