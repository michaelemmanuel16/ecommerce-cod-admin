/** True when `name` is an IANA time zone the runtime knows, such as Africa/Accra. */
export function isValidTimeZone(name: unknown): name is string {
  if (typeof name !== 'string' || (!name.includes('/') && name !== 'UTC')) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: name });
    return true;
  } catch {
    return false;
  }
}
