// The product banner must live on our own image storage (F-418). The server refuses any other host on save and sends
// the storage host with the form; the public page checks it again before it loads the image.

/** True when `url` is an https address on `storageHost`. False when either is missing. */
export function isStorageUrl(url: string | undefined | null, storageHost: string | undefined | null): boolean {
  if (!url || !storageHost) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.host.toLowerCase() === storageHost.toLowerCase();
  } catch {
    return false;
  }
}
