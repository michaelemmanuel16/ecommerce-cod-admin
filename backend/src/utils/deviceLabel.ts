/** "Chrome on macOS" from a User-Agent header. Order matters: Edge and Opera also say Chrome, Chrome also says Safari. */
export function deviceLabel(userAgent: string | undefined | null): string {
  if (!userAgent) return 'Unknown device';
  const ua = userAgent;

  const browser =
    /Edg(e|A|iOS)?\//.test(ua) ? 'Edge' :
    /OPR\/|Opera/.test(ua) ? 'Opera' :
    /SamsungBrowser/.test(ua) ? 'Samsung Internet' :
    /Firefox|FxiOS/.test(ua) ? 'Firefox' :
    /Chrome|CriOS/.test(ua) ? 'Chrome' :
    /Safari/.test(ua) ? 'Safari' :
    null;

  const os =
    /Android/.test(ua) ? 'Android' :
    /iPhone|iPad|iPod/.test(ua) ? 'iOS' :
    /Windows/.test(ua) ? 'Windows' :
    /Mac OS X|Macintosh/.test(ua) ? 'macOS' :
    /CrOS/.test(ua) ? 'ChromeOS' :
    /Linux/.test(ua) ? 'Linux' :
    null;

  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? 'Unknown device';
}
