import { jest } from '@jest/globals';

/**
 * In-memory stand-in for the shared Redis client (middleware/cache.middleware). Import this module before the
 * code under test. Plain functions, not jest.fn: the jest config resets mock implementations before each test.
 * Set `fakeRedis.down = true` to make every command fail.
 */
export const fakeRedis = {
  store: new Map<string, string>(),
  down: false,
  reset() { this.store.clear(); this.down = false; },
  async guard() { if (this.down) throw new Error('redis down'); },
  async get(key: string) { await this.guard(); return this.store.get(key) ?? null; },
  async set(key: string, value: string, ...args: unknown[]) {
    await this.guard();
    if (args.includes('NX') && this.store.has(key)) return null;
    this.store.set(key, value);
    return 'OK';
  },
  async del(key: string) { await this.guard(); return this.store.delete(key) ? 1 : 0; },
  /** Only the lock release script: delete the key when it holds the token. */
  async eval(_script: string, _n: number, key: string, token: string) {
    await this.guard();
    if (this.store.get(key) !== token) return 0;
    this.store.delete(key);
    return 1;
  },
};

jest.mock('../../middleware/cache.middleware', () => ({
  __esModule: true,
  redis: {
    get: (...a: [string]) => fakeRedis.get(...a),
    set: (...a: [string, string]) => fakeRedis.set(...a),
    del: (...a: [string]) => fakeRedis.del(...a),
    eval: (...a: [string, number, string, string]) => fakeRedis.eval(...a),
  },
}));
