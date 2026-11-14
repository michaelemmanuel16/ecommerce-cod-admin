/**
 * Outbound HTTP for the workflow `http_request` action (M9-T21).
 *
 * The URL is user input, so every request is checked before it leaves the server:
 * - only `http` and `https`
 * - the host is resolved first; a private, loopback, link-local, CGNAT, metadata, multicast or reserved
 *   address (IPv4 or IPv6) refuses the call
 * - the connection goes to the address that was checked (no second DNS lookup, so no DNS rebinding)
 * - at most 3 redirects, each one checked the same way
 * - 10 second limit for the whole call, response body cut at 10 KB
 * No dependency: node `http`/`https` and `dns`.
 */
import dns from 'dns';
import http from 'http';
import https from 'https';
import net from 'net';

export const HTTP_TIMEOUT_MS = 10_000;
export const MAX_REDIRECTS = 3;
export const MAX_BODY_BYTES = 10 * 1024;
export const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
type Method = typeof ALLOWED_METHODS[number];

/** A call that was refused or failed. `message` is safe to show in the run history. */
export class HttpRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HttpRequestError';
  }
}

// ---- address classes ----

const V4_BLOCKED: Array<[string, number, string]> = [
  ['0.0.0.0', 8, 'this-network'],
  ['10.0.0.0', 8, 'private'],
  ['100.64.0.0', 10, 'carrier-grade NAT'],
  ['127.0.0.0', 8, 'loopback'],
  ['169.254.0.0', 16, 'link-local or cloud metadata'],
  ['172.16.0.0', 12, 'private'],
  ['192.0.0.0', 24, 'reserved'],
  ['192.0.2.0', 24, 'documentation'],
  ['192.168.0.0', 16, 'private'],
  ['198.18.0.0', 15, 'benchmarking'],
  ['198.51.100.0', 24, 'documentation'],
  ['203.0.113.0', 24, 'documentation'],
  ['224.0.0.0', 4, 'multicast'],
  ['240.0.0.0', 4, 'reserved'],
];

function v4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => acc * 256 + Number(part), 0);
}

function v4Reason(ip: string): string | null {
  const n = v4ToInt(ip);
  for (const [base, bits, reason] of V4_BLOCKED) {
    const size = 2 ** (32 - bits);
    const start = v4ToInt(base);
    if (n >= start && n < start + size) return reason;
  }
  return null;
}

/** Eight 16-bit groups of an IPv6 address, or null when it does not parse. Handles `::`, a dotted IPv4 tail and a zone id. */
function parseV6(input: string): number[] | null {
  let text = input.split('%')[0].toLowerCase();
  const dotted = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    if (!net.isIPv4(dotted[1])) return null;
    const n = v4ToInt(dotted[1]);
    text = text.slice(0, -dotted[1].length) + ((n >>> 16) & 0xffff).toString(16) + ':' + (n & 0xffff).toString(16);
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

function embeddedV4(hi: number, lo: number): string {
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

function v6Reason(ip: string): string | null {
  const g = parseV6(ip);
  if (!g) return 'not a valid address';
  const allZeroTo = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (allZeroTo(7) && g[7] === 0) return 'unspecified';
  if (allZeroTo(7) && g[7] === 1) return 'loopback';
  // IPv4-mapped (::ffff:a.b.c.d) and the deprecated IPv4-compatible (::a.b.c.d): judge the IPv4 inside
  if (allZeroTo(5) && (g[5] === 0xffff || g[5] === 0)) return v4Reason(embeddedV4(g[6], g[7])) ?? (g[5] === 0 ? 'reserved' : null);
  // NAT64 64:ff9b::/96 and 6to4 2002::/16 carry an IPv4 address
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return v4Reason(embeddedV4(g[6], g[7]));
  if (g[0] === 0x2002) return v4Reason(embeddedV4(g[1], g[2]));
  if ((g[0] & 0xfe00) === 0xfc00) return 'private (fc00::/7)';
  if ((g[0] & 0xffc0) === 0xfe80) return 'link-local';
  if ((g[0] & 0xff00) === 0xff00) return 'multicast';
  if (g[0] === 0x2001 && g[1] === 0x0db8) return 'documentation';
  return null;
}

/** Why an IP address may not be called, or null when it is a public address. */
export function blockedAddressReason(ip: string): string | null {
  const bare = ip.replace(/^\[|\]$/g, '');
  if (net.isIPv4(bare)) return v4Reason(bare);
  if (net.isIPv6(bare)) return v6Reason(bare);
  return 'not a valid address';
}

// ---- resolve + request ----

export interface ResolvedAddress { address: string; family: 4 | 6 }
export type LookupFn = (hostname: string) => Promise<ResolvedAddress[]>;

const defaultLookup: LookupFn = async (hostname) =>
  (await dns.promises.lookup(hostname, { all: true, verbatim: true })).map((a) => ({ address: a.address, family: a.family as 4 | 6 }));

/** Resolve the host and return an address that is safe to call. Throws when the host, or any address it resolves to, is blocked. */
export async function resolvePublicAddress(hostname: string, lookup: LookupFn = defaultLookup): Promise<ResolvedAddress> {
  const host = hostname.replace(/^\[|\]$/g, '');
  let addresses: ResolvedAddress[];
  if (net.isIP(host)) {
    addresses = [{ address: host, family: net.isIPv6(host) ? 6 : 4 }];
  } else {
    try {
      addresses = await lookup(host);
    } catch {
      throw new HttpRequestError(`Could not resolve host "${host}"`);
    }
  }
  if (addresses.length === 0) throw new HttpRequestError(`Could not resolve host "${host}"`);
  // One blocked address is enough to refuse: a mixed answer is how rebinding tricks start.
  for (const { address } of addresses) {
    const reason = blockedAddressReason(address);
    if (reason) throw new HttpRequestError(`Request refused: "${host}" points to a ${reason} address`);
  }
  return addresses[0];
}

export interface TransportRequest {
  url: URL;
  method: Method;
  headers: Record<string, string>;
  body?: string;
  address: ResolvedAddress;
  signal: AbortSignal;
}
export interface TransportResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  truncated: boolean;
}
export type Transport = (req: TransportRequest) => Promise<TransportResponse>;

/** Real network call: connects to the checked address, reads at most MAX_BODY_BYTES of the body. */
export const nodeTransport: Transport = (req) =>
  new Promise((resolve, reject) => {
    const lib = req.url.protocol === 'https:' ? https : http;
    const request = lib.request({
      protocol: req.url.protocol,
      host: req.url.hostname.replace(/^\[|\]$/g, ''), // for the Host header and the TLS name
      port: req.url.port || undefined,
      path: `${req.url.pathname}${req.url.search}`,
      method: req.method,
      headers: req.headers,
      signal: req.signal,
      // Connect to the address that passed the check; never look the name up again.
      // (newer Node versions ask for all addresses at once, older ones for one)
      lookup: ((_host: string, opts: { all?: boolean }, cb: (err: Error | null, address: any, family?: number) => void) =>
        (opts?.all ? cb(null, [{ address: req.address.address, family: req.address.family }]) : cb(null, req.address.address, req.address.family))) as any,
    }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let truncated = false;
      const finish = () => resolve({
        status: res.statusCode ?? 0,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
        truncated,
      });
      res.on('data', (chunk: Buffer) => {
        if (truncated) return;
        const room = MAX_BODY_BYTES - size;
        if (chunk.length > room) {
          chunks.push(chunk.subarray(0, room));
          size = MAX_BODY_BYTES;
          truncated = true;
          res.destroy(); // stop downloading
          finish();
        } else {
          chunks.push(chunk);
          size += chunk.length;
        }
      });
      res.on('end', () => { if (!truncated) finish(); });
      res.on('error', (err) => { if (!truncated) reject(err); });
    });
    request.on('error', reject);
    if (req.body !== undefined) request.write(req.body);
    request.end();
  });

export interface SafeRequestInput {
  url: string;
  method?: string;
  headers?: Record<string, unknown>;
  body?: unknown;
}
export interface SafeRequestResult {
  status: number;
  ok: boolean;
  url: string;
  body: string;
  truncated: boolean;
}
export interface SafeRequestDeps {
  lookup?: LookupFn;
  transport?: Transport;
  timeoutMs?: number;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const DROPPED_HEADERS = new Set(['host', 'content-length', 'transfer-encoding', 'connection']);
const CROSS_ORIGIN_DROPPED = ['authorization', 'cookie', 'proxy-authorization'];

function parseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpRequestError('Request refused: the URL is not valid');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new HttpRequestError(`Request refused: only http and https URLs are allowed (got ${url.protocol.replace(':', '')})`);
  }
  return url;
}

function cleanHeaders(headers: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (value === undefined || value === null || DROPPED_HEADERS.has(key.toLowerCase())) continue;
    out[key] = String(value);
  }
  return out;
}

/** Make the call. Resolves with the (truncated) response; throws `HttpRequestError` when refused or failed. */
export async function safeHttpRequest(input: SafeRequestInput, deps: SafeRequestDeps = {}): Promise<SafeRequestResult> {
  const lookup = deps.lookup ?? defaultLookup;
  const transport = deps.transport ?? nodeTransport;
  const timeoutMs = deps.timeoutMs ?? HTTP_TIMEOUT_MS;

  const method = String(input.method ?? 'GET').toUpperCase() as Method;
  if (!ALLOWED_METHODS.includes(method)) {
    throw new HttpRequestError(`Request refused: method ${method} is not allowed (use ${ALLOWED_METHODS.join(', ')})`);
  }

  let url = parseUrl(String(input.url ?? ''));
  let headers = cleanHeaders(input.headers);
  let body: string | undefined;
  if (input.body !== undefined && input.body !== null && input.body !== '' && method !== 'GET') {
    if (typeof input.body === 'string') {
      body = input.body;
    } else {
      body = JSON.stringify(input.body);
      if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json';
    }
    headers['Content-Length'] = String(Buffer.byteLength(body));
  }

  // One limit for the whole call, redirects included.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let currentMethod: Method = method;
    for (let hop = 0; ; hop++) {
      const address = await resolvePublicAddress(url.hostname, lookup);
      let res: TransportResponse;
      try {
        res = await transport({ url, method: currentMethod, headers, body, address, signal: controller.signal });
      } catch (err: any) {
        if (controller.signal.aborted) throw new HttpRequestError(`Request timed out after ${Math.round(timeoutMs / 1000)} seconds`);
        throw new HttpRequestError(`Request failed: ${err?.code ?? err?.message ?? 'network error'}`);
      }

      const location = res.headers.location;
      if (REDIRECT_STATUSES.has(res.status) && typeof location === 'string') {
        if (hop >= MAX_REDIRECTS) throw new HttpRequestError(`Request refused: more than ${MAX_REDIRECTS} redirects`);
        const next = parseUrl(new URL(location, url).toString()); // protocol checked again; host resolved on the next loop
        if (next.origin !== url.origin) {
          headers = Object.fromEntries(Object.entries(headers).filter(([k]) => !CROSS_ORIGIN_DROPPED.includes(k.toLowerCase())));
        }
        if (res.status === 303 || ((res.status === 301 || res.status === 302) && currentMethod === 'POST')) {
          currentMethod = 'GET';
          body = undefined;
          headers = Object.fromEntries(Object.entries(headers).filter(([k]) => !['content-length', 'content-type'].includes(k.toLowerCase())));
        }
        url = next;
        continue;
      }

      return { status: res.status, ok: res.status >= 200 && res.status < 300, url: url.toString(), body: res.body, truncated: res.truncated };
    }
  } finally {
    clearTimeout(timer);
  }
}
