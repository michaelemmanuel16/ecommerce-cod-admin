import { MCP_CONFIG } from './config';

/**
 * Simple in-process token bucket rate limiter for MCP tool calls.
 * Prevents LLM clients from flooding the database with rapid-fire queries.
 */
class TokenBucketRateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRatePerMs: number;

  constructor(maxCallsPerMinute: number) {
    this.maxTokens = maxCallsPerMinute;
    this.tokens = maxCallsPerMinute;
    this.lastRefill = Date.now();
    this.refillRatePerMs = maxCallsPerMinute / 60_000;
  }

  tryConsume(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRatePerMs);
    this.lastRefill = now;
  }
}

export const rateLimiter = new TokenBucketRateLimiter(MCP_CONFIG.rateLimit.maxCallsPerMinute);
