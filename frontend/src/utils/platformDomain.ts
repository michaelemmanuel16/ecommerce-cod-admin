const PLATFORM_DOMAIN = import.meta.env.VITE_PLATFORM_DOMAIN || 'platform.codadminpro.com';

export function isPlatformDomain(): boolean {
  return window.location.hostname === PLATFORM_DOMAIN;
}

/**
 * Where the platform admin dashboard lives, depending on which domain we're on.
 * - platform.codadminpro.com → '/'   (platform subdomain has its own router tree)
 * - codadminpro.com          → '/platform'  (platform tree mounted under /platform)
 */
export function platformDashboardPath(): string {
  return isPlatformDomain() ? '/' : '/platform';
}

/**
 * Where the platform admin login lives.
 * - platform.codadminpro.com → '/login'
 * - codadminpro.com          → '/platform/login'
 */
export function platformLoginPath(): string {
  return isPlatformDomain() ? '/login' : '/platform/login';
}

/**
 * Build a path inside the platform admin tree, prefixed correctly per domain.
 *   platformPath('tenants')        → '/tenants' or '/platform/tenants'
 *   platformPath(`tenants/${id}`)  → '/tenants/123' or '/platform/tenants/123'
 *   platformPath('')               → '/' or '/platform'
 */
export function platformPath(suffix: string): string {
  const cleaned = suffix.replace(/^\/+/, '');
  if (isPlatformDomain()) {
    return cleaned ? `/${cleaned}` : '/';
  }
  return cleaned ? `/platform/${cleaned}` : '/platform';
}
