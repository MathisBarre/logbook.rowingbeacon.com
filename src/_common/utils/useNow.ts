import { useEffect, useState } from "react";

const MINUTE = 60 * 1000;

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;

/** One timer for every component: it ticks on each minute change. */
const scheduleNextTick = () => {
  if (timer !== undefined) return;
  timer = setTimeout(
    () => {
      timer = undefined;
      listeners.forEach((listener) => listener());
      if (listeners.size > 0) scheduleNextTick();
    },
    MINUTE - (Date.now() % MINUTE) + 50
  );
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  scheduleNextTick();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
};

/** The current time, refreshed every minute. */
export const useNow = () => {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    setNow(new Date());
    return subscribe(() => setNow(new Date()));
  }, []);

  return now;
};
