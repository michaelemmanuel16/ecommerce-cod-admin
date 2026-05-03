/**
 * Auto-derive `https://platform.<host>` from FRONTEND_URL so a missing
 * PLATFORM_URL env doesn't silently break platform.<apex> logins. Returns
 * null for localhost or when the frontend is already on a platform.* host.
 */
export function derivePlatformOrigin(frontendUrl: string): string | null {
  try {
    const url = new URL(frontendUrl);
    if (!url.hostname || url.hostname === 'localhost' || url.hostname.startsWith('platform.')) {
      return null;
    }
    return `${url.protocol}//platform.${url.hostname}`;
  } catch {
    return null;
  }
}
