/** Midnight UTC of the day `d` falls on (the value of a Postgres DATE column). */
export const startOfUtcDay = (d: Date = new Date()): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
