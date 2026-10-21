/**
 * M2-T06: rate limit values (F-1305). Counted in Redis, one place to change them.
 * Chat itself is built in M11; its limits live here so the limiter is ready.
 */
export const RATE_LIMITS = {
  mcp: {
    perKeyPerMinute: 30,
    perTenantPerMinute: 300,
    windowSeconds: 60,
  },
  chat: {
    perUserMessages: 20,
    perUserWindowSeconds: 15 * 60,
    // GUESS: the plan names a daily cap per tenant but no number. Config only until M11.
    perTenantPerDay: 1000,
    dayWindowSeconds: 24 * 60 * 60,
  },
} as const;
