import { generateApiKey } from './crypto';

// In-memory OAuth state store (state -> payload). Used for the CSRF state of the WhatsApp and
// Meta Ads logins and for the short-lived Meta Ads "pick accounts" session.
const store = new Map<string, { payload: unknown; expiresAt: number }>();
const TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ENTRIES = 100;

/** Store `payload` under a new random state and return the state. */
export function createOAuthState(payload: unknown): string {
  // Evict oldest entries if store is full
  if (store.size >= MAX_ENTRIES) {
    const oldestKey = store.keys().next().value;
    if (oldestKey) store.delete(oldestKey);
  }
  const state = generateApiKey();
  store.set(state, { payload, expiresAt: Date.now() + TTL_MS });
  return state;
}

/** Read a state without removing it (null when unknown or expired). */
export function peekOAuthState<T>(state: string): T | null {
  const entry = store.get(state);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    store.delete(state);
    return null;
  }
  return entry.payload as T;
}

/** Read and remove a state in one step, so it cannot be replayed (null when unknown or expired). */
export function consumeOAuthState<T>(state: string): T | null {
  const payload = peekOAuthState<T>(state);
  store.delete(state);
  return payload;
}

/** Drop expired entries. */
export function sweepOAuthState(): void {
  const now = Date.now();
  for (const [key, val] of store) {
    if (val.expiresAt < now) store.delete(key);
  }
}
