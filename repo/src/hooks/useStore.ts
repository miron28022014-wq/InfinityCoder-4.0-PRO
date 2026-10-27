import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getState, subscribe, type AppState } from "../store";

/**
 * Subscribe to a slice of the store.
 *
 * Selectors must return a stable value for unchanged state — for objects pass
 * `isEqual`, otherwise every store change re-renders every subscriber.
 */
export function useStore<T>(
  selector: (s: AppState) => T,
  isEqual: (a: T, b: T) => boolean = Object.is
): T {
  const cache = useRef<{ value: T; has: boolean }>({ value: undefined as never, has: false });

  const getSnapshot = useCallback(() => {
    const next = selector(getState());
    if (cache.current.has && isEqual(cache.current.value, next)) return cache.current.value;
    cache.current = { value: next, has: true };
    return next;
  }, [selector, isEqual]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Shallow array comparison, handy for list selectors. */
export const shallowArray = <T,>(a: readonly T[], b: readonly T[]): boolean =>
  a === b || (a.length === b.length && a.every((x, i) => Object.is(x, b[i])));

export const shallow = <T extends object>(a: T, b: T): boolean => {
  if (Object.is(a, b)) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a) as Array<keyof T>;
  const kb = Object.keys(b) as Array<keyof T>;
  if (ka.length !== kb.length) return false;
  return ka.every(k => Object.is(a[k], b[k]));
};

/** Live elapsed milliseconds since a timestamp; only ticks while `running`. */
export function useElapsed(since: number | undefined, running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running || !since) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [running, since]);
  return since ? now - since : 0;
}

/** Media query hook (used for the compact layout). */
export function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} мс`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} с`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} КБ`;
  return `${(n / 1024 / 1024).toFixed(1)} МБ`;
}
