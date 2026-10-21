/** Email domain reserved for per-tenant system users (kind = system). Normal users cannot use it. */
export const SYSTEM_EMAIL_DOMAIN = 'system.codadmin.internal';

export function isReservedSystemEmail(email: unknown): boolean {
  return typeof email === 'string' && email.trim().toLowerCase().endsWith(`@${SYSTEM_EMAIL_DOMAIN}`);
}
