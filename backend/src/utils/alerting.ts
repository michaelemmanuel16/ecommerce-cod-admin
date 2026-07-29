import logger from './logger';

/**
 * Route a critical operational event to on-call.
 *
 * Always logs at error level; when ALERT_WEBHOOK_URL is set (a Slack / generic
 * incoming webhook) it ALSO POSTs a compact payload so the event pages a human,
 * not just a log file nobody watches. Fire-safe: a failed page never throws back
 * into the caller — the error log is the guaranteed fallback.
 *
 * MAN-91: the primary caller is the `auth.null_tenant_context` tripwire — the
 * signal that a token was about to be minted with no active store, which is the
 * fail-open crux of the tenant-scoping Prisma extension. That event must page,
 * not merely log.
 */
export async function pageOnCall(event: string, context: Record<string, unknown> = {}): Promise<void> {
  logger.error(`[oncall.page] ${event}`, context);

  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return; // no pager configured — the error log above is the fallback

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `:rotating_light: ${event}`,
        event,
        context,
        service: 'ecommerce-cod-api',
        env: process.env.NODE_ENV ?? 'unknown',
      }),
    });
  } catch (err: any) {
    // A paging failure must not break the caller's path; the event is already
    // in the error log. Record that delivery failed and move on.
    logger.error('[oncall.page] failed to deliver alert', { event, error: err?.message });
  }
}
