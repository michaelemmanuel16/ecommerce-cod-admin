import { useAuthStore } from '../../stores/authStore';

/**
 * Per-user view settings kept in localStorage (F-307, F-310). Every read and write is wrapped, because storage can
 * be blocked or full: the page then works with the defaults and forgets the choice on reload.
 */
const key = (name: string): string => `codadmin.orders.${name}.${useAuthStore.getState().user?.id ?? 'anon'}`;

export function readPref<T>(name: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key(name));
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writePref(name: string, value: unknown): void {
  try {
    localStorage.setItem(key(name), JSON.stringify(value));
  } catch {
    // storage blocked or full: keep the choice for this visit only
  }
}
