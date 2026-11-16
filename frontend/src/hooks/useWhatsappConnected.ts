import { useEffect, useState } from 'react';
import { messagesService } from '../services/messages.service';

let cached: { value: boolean; at: number } | null = null;
let inflight: Promise<boolean | null> | null = null;
const TTL_MS = 60_000;

/** One shared read per minute, however many buttons ask. null: the answer failed, so the callers do not block the rep (the send says it). */
function read(): Promise<boolean | null> {
  if (cached && Date.now() - cached.at < TTL_MS) return Promise.resolve(cached.value);
  inflight ??= messagesService.whatsappConnected().then(
    (value) => { cached = { value, at: Date.now() }; return value; },
    () => null,
  ).finally(() => { inflight = null; });
  return inflight;
}

/** Is a WhatsApp connection set up and on for this store? null while it loads or when it could not be read. */
export function useWhatsappConnected(): boolean | null {
  const [connected, setConnected] = useState<boolean | null>(cached && Date.now() - cached.at < TTL_MS ? cached.value : null);
  useEffect(() => {
    let live = true;
    void read().then((v) => { if (live) setConnected(v); });
    return () => { live = false; };
  }, []);
  return connected;
}

/** Test hook: forget the cached answer. */
export const resetWhatsappConnected = (): void => { cached = null; inflight = null; };
