/** Ask again every 5 seconds while the payment is pending, for up to 5 minutes (F-403). */
export const POLL_MS = 5_000;
export const POLL_LIMIT_MS = 5 * 60_000;
/** After a confirmed payment with a thank-you page, wait this long before leaving. */
export const REDIRECT_DELAY_MS = 2_000;
