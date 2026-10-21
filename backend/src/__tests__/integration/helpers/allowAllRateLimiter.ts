/**
 * Stand-in for src/mcp/rateLimiter that allows every call. Use it as
 *   jest.mock('../../mcp/rateLimiter', () => require('./helpers/allowAllRateLimiter').allowAllRateLimiter());
 * A plain function: resetMocks would wipe a jest.fn.
 */
export const allowAllRateLimiter = () => ({
  checkMcp: async () => ({ allowed: true, limit: 30, remaining: 29, retryAfterSeconds: 0 }),
});
