/** How long message log rows are kept, and how old a message a status event may still touch. */
export const MESSAGE_LOG_RETENTION_DAYS = parseInt(process.env.MESSAGE_LOG_RETENTION_DAYS || '90', 10);

/** A status event that arrives before the send call returns waits this long for its row. */
export const PENDING_EVENT_TTL_MS = 60 * 60 * 1000;
