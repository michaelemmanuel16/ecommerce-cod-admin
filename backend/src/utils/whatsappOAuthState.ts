import Redis from 'ioredis';
import { generateApiKey } from './crypto';
import { encryptString, decryptString } from './providerCrypto';

/**
 * WhatsApp OAuth state in Redis (M9-T27), so a login that started before a restart still finishes after it.
 * - the CSRF state: `wa-oauth:state:<tenantId>:<userId>:<random>`, 10 minutes, used once. The state string handed to Meta is
 *   `<tenantId>.<userId>.<random>`: the callback has no login, so the tenant and user come back from it.
 * - the pending login (the long token and the phone numbers to choose from): `wa-oauth:pending:<tenantId>:<userId>`,
 *   10 minutes. The token is stored encrypted.
 * A missing or expired state is a null: the callback sends the user back to Connections with `?error=start_again`.
 */

export const OAUTH_STATE_TTL_SECONDS = 10 * 60;

export interface PendingWhatsappLogin {
  accessToken: string;
  oauthTokenExpiry: string;
  oauthUserId: string;
  phones: unknown[];
}

const stateKey = (tenantId: string, userId: number, random: string) => `wa-oauth:state:${tenantId}:${userId}:${random}`;
const pendingKey = (tenantId: string, userId: number) => `wa-oauth:pending:${tenantId}:${userId}`;

export function makeWhatsappOAuthStore(redis: Redis) {
  return {
    /** A new state for this tenant and user. */
    async createState(tenantId: string, userId: number): Promise<string> {
      const random = generateApiKey();
      await redis.set(stateKey(tenantId, userId, random), '1', 'EX', OAUTH_STATE_TTL_SECONDS);
      return `${tenantId}.${userId}.${random}`;
    },

    /** Check and remove a state in one step (no replay). The tenant and user it was made for, or null when unknown or expired. */
    async consumeState(state: string): Promise<{ tenantId: string; userId: number } | null> {
      const match = /^([^.]+)\.(\d+)\.([A-Za-z0-9_-]+)$/.exec(state);
      if (!match) return null;
      const [, tenantId, user, random] = match;
      const userId = Number(user);
      const found = await redis.getdel(stateKey(tenantId, userId, random));
      return found ? { tenantId, userId } : null;
    },

    async savePending(tenantId: string, userId: number, pending: PendingWhatsappLogin): Promise<void> {
      const value = JSON.stringify({ ...pending, accessToken: encryptString(pending.accessToken) });
      await redis.set(pendingKey(tenantId, userId), value, 'EX', OAUTH_STATE_TTL_SECONDS);
    },

    async getPending(tenantId: string, userId: number): Promise<PendingWhatsappLogin | null> {
      const raw = await redis.get(pendingKey(tenantId, userId));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return { ...parsed, accessToken: decryptString(parsed.accessToken) as string };
    },

    async deletePending(tenantId: string, userId: number): Promise<void> {
      await redis.del(pendingKey(tenantId, userId));
    },
  };
}

export type WhatsappOAuthStore = ReturnType<typeof makeWhatsappOAuthStore>;

let shared: { redis: Redis; store: WhatsappOAuthStore } | null = null;

/** The store on the app's own Redis connection, made on first use. */
export function whatsappOAuthStore(): WhatsappOAuthStore {
  if (!shared) {
    const redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD,
      maxRetriesPerRequest: 2,
    });
    redis.on('error', () => { /* a failed command rejects and the caller answers; no unhandled error event */ });
    shared = { redis, store: makeWhatsappOAuthStore(redis) };
  }
  return shared.store;
}

export async function closeWhatsappOAuthStore(): Promise<void> {
  if (shared) { await shared.redis.quit().catch(() => undefined); shared = null; }
}
