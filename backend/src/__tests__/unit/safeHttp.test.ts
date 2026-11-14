import { describe, it, expect, jest, afterEach } from '@jest/globals';
import http from 'http';
import type { AddressInfo } from 'net';
import {
  blockedAddressReason, resolvePublicAddress, safeHttpRequest, nodeTransport,
  HTTP_TIMEOUT_MS, MAX_BODY_BYTES, MAX_REDIRECTS, HttpRequestError,
  type LookupFn, type Transport, type TransportResponse,
} from '../../utils/safeHttp';

/** M9-T21: the http_request guard. No real network: lookup and transport are injected, except the one local-server test. */

const PUBLIC = '93.184.216.34';
const lookupTo = (address: string): LookupFn => async () => [{ address, family: address.includes(':') ? 6 : 4 }];
const reply = (status: number, extra: Partial<TransportResponse> = {}): TransportResponse =>
  ({ status, headers: {}, body: '', truncated: false, ...extra });

describe('blockedAddressReason: address classes', () => {
  const blocked: Array<[string, string]> = [
    ['127.0.0.1', 'loopback'],
    ['127.255.255.254', 'loopback'],
    ['10.0.0.5', 'private'],
    ['172.16.0.1', 'private'],
    ['172.31.255.255', 'private'],
    ['192.168.1.1', 'private'],
    ['169.254.169.254', 'link-local or cloud metadata'],
    ['169.254.170.2', 'link-local or cloud metadata'],
    ['100.64.0.1', 'carrier-grade NAT'],
    ['100.127.255.255', 'carrier-grade NAT'],
    ['100.100.100.200', 'carrier-grade NAT'],
    ['0.0.0.0', 'this-network'],
    ['224.0.0.1', 'multicast'],
    ['255.255.255.255', 'reserved'],
    ['::1', 'loopback'],
    ['::', 'unspecified'],
    ['fc00::1', 'private (fc00::/7)'],
    ['fd00:ec2::254', 'private (fc00::/7)'],
    ['fe80::1', 'link-local'],
    ['ff02::1', 'multicast'],
    ['::ffff:127.0.0.1', 'loopback'],
    ['::ffff:169.254.169.254', 'link-local or cloud metadata'],
    ['::ffff:7f00:1', 'loopback'],
    ['64:ff9b::a00:1', 'private'],
    ['2002:7f00:1::1', 'loopback'],
    ['::127.0.0.1', 'reserved'],
  ];
  it.each(blocked)('refuses %s', (ip) => {
    expect(blockedAddressReason(ip)).not.toBeNull();
  });

  it('names the class', () => {
    for (const [ip, reason] of blocked.slice(0, 6)) expect(blockedAddressReason(ip)).toBe(reason);
  });

  it.each(['93.184.216.34', '8.8.8.8', '1.1.1.1', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1',
    '2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8'])('allows public %s', (ip) => {
    expect(blockedAddressReason(ip)).toBeNull();
  });

  it('refuses text that is not an address', () => {
    expect(blockedAddressReason('not-an-ip')).not.toBeNull();
  });
});

describe('resolvePublicAddress', () => {
  it('returns a public address', async () => {
    await expect(resolvePublicAddress('example.com', lookupTo(PUBLIC))).resolves.toEqual({ address: PUBLIC, family: 4 });
  });

  it('refuses a name that resolves to a private address', async () => {
    await expect(resolvePublicAddress('internal.example.com', lookupTo('10.0.0.8'))).rejects.toThrow(/refused.*private/);
  });

  it('refuses when any one answer is private (mixed answer)', async () => {
    const mixed: LookupFn = async () => [{ address: PUBLIC, family: 4 }, { address: '127.0.0.1', family: 4 }];
    await expect(resolvePublicAddress('mixed.example.com', mixed)).rejects.toThrow(/refused/);
  });

  it('refuses an IP literal without a lookup, IPv4 and IPv6', async () => {
    const never: LookupFn = jest.fn(async () => { throw new Error('must not be called'); });
    await expect(resolvePublicAddress('169.254.169.254', never)).rejects.toThrow(/cloud metadata/);
    await expect(resolvePublicAddress('[::1]', never)).rejects.toThrow(/loopback/);
    expect(never).not.toHaveBeenCalled();
  });

  it('a host that does not resolve is a clear error', async () => {
    const fails: LookupFn = async () => { throw new Error('ENOTFOUND'); };
    await expect(resolvePublicAddress('nope.invalid', fails)).rejects.toThrow('Could not resolve host "nope.invalid"');
  });
});

describe('safeHttpRequest', () => {
  afterEach(() => { jest.useRealTimers(); });

  it('only http and https', async () => {
    const transport = jest.fn<Transport>();
    for (const url of ['file:///etc/passwd', 'ftp://example.com/x', 'gopher://example.com', 'javascript:alert(1)']) {
      await expect(safeHttpRequest({ url }, { lookup: lookupTo(PUBLIC), transport })).rejects.toThrow(/only http and https/);
    }
    await expect(safeHttpRequest({ url: 'not a url' }, { transport })).rejects.toThrow(/not valid/);
    expect(transport).not.toHaveBeenCalled();
  });

  it('allows GET POST PUT PATCH DELETE and refuses the rest', async () => {
    const transport = jest.fn<Transport>(async () => reply(200, { body: 'ok' }));
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'post']) {
      await expect(safeHttpRequest({ url: 'https://example.com', method }, { lookup: lookupTo(PUBLIC), transport })).resolves.toMatchObject({ status: 200 });
    }
    for (const method of ['HEAD', 'OPTIONS', 'TRACE', 'CONNECT']) {
      await expect(safeHttpRequest({ url: 'https://example.com', method }, { lookup: lookupTo(PUBLIC), transport })).rejects.toThrow(/not allowed/);
    }
  });

  it('refuses a private address before any request is made', async () => {
    const transport = jest.fn<Transport>();
    await expect(safeHttpRequest({ url: 'http://169.254.169.254/latest/meta-data/' }, { transport })).rejects.toThrow(/refused/);
    await expect(safeHttpRequest({ url: 'http://localhost:3000/' }, { lookup: lookupTo('127.0.0.1'), transport })).rejects.toThrow(/refused/);
    // The URL parser turns these tricks into the plain address
    await expect(safeHttpRequest({ url: 'http://2130706433/' }, { transport })).rejects.toThrow(/refused/);
    await expect(safeHttpRequest({ url: 'http://0x7f.1/' }, { transport })).rejects.toThrow(/refused/);
    await expect(safeHttpRequest({ url: 'http://[::ffff:127.0.0.1]/' }, { transport })).rejects.toThrow(/refused/);
    expect(transport).not.toHaveBeenCalled();
  });

  it('connects to the address it checked', async () => {
    const transport = jest.fn<Transport>(async () => reply(200));
    await safeHttpRequest({ url: 'https://example.com/a?b=1' }, { lookup: lookupTo(PUBLIC), transport });
    expect(transport.mock.calls[0][0].address).toEqual({ address: PUBLIC, family: 4 });
  });

  it('refuses a redirect to a private address', async () => {
    const lookup: LookupFn = async (host) => [{ address: host === 'evil.example.com' ? '10.1.1.1' : PUBLIC, family: 4 }];
    const transport = jest.fn<Transport>(async () => reply(302, { headers: { location: 'http://evil.example.com/steal' } }));
    await expect(safeHttpRequest({ url: 'https://example.com' }, { lookup, transport })).rejects.toThrow(/refused.*private/);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('refuses a redirect straight to the metadata address, and to a non-http scheme', async () => {
    const meta = jest.fn<Transport>(async () => reply(301, { headers: { location: 'http://169.254.169.254/' } }));
    await expect(safeHttpRequest({ url: 'https://example.com' }, { lookup: lookupTo(PUBLIC), transport: meta })).rejects.toThrow(/cloud metadata/);
    const file = jest.fn<Transport>(async () => reply(301, { headers: { location: 'file:///etc/passwd' } }));
    await expect(safeHttpRequest({ url: 'https://example.com' }, { lookup: lookupTo(PUBLIC), transport: file })).rejects.toThrow(/only http and https/);
  });

  it('follows up to 3 redirects and refuses a fourth', async () => {
    let n = 0;
    const transport = jest.fn<Transport>(async () => (n++ < 3 ? reply(302, { headers: { location: `/hop${n}` } }) : reply(200, { body: 'done' })));
    const ok = await safeHttpRequest({ url: 'https://example.com' }, { lookup: lookupTo(PUBLIC), transport });
    expect(MAX_REDIRECTS).toBe(3);
    expect(ok).toMatchObject({ status: 200, body: 'done', url: 'https://example.com/hop3' });

    const endless = jest.fn<Transport>(async () => reply(302, { headers: { location: '/again' } }));
    await expect(safeHttpRequest({ url: 'https://example.com' }, { lookup: lookupTo(PUBLIC), transport: endless })).rejects.toThrow(/more than 3 redirects/);
    expect(endless).toHaveBeenCalledTimes(4);
  });

  it('drops the Authorization header on a redirect to another origin, and turns a 302 POST into a GET', async () => {
    const seen: Array<{ method: string; headers: Record<string, string>; body?: string }> = [];
    const transport = jest.fn<Transport>(async (req) => {
      seen.push({ method: req.method, headers: req.headers, body: req.body });
      return seen.length === 1 ? reply(302, { headers: { location: 'https://other.example.org/x' } }) : reply(200);
    });
    await safeHttpRequest(
      { url: 'https://example.com', method: 'POST', headers: { Authorization: 'Bearer t', 'X-Keep': '1' }, body: { a: 1 } },
      { lookup: lookupTo(PUBLIC), transport },
    );
    expect(seen[0]).toMatchObject({ method: 'POST', body: '{"a":1}' });
    expect(seen[0].headers.Authorization).toBe('Bearer t');
    expect(seen[1]).toMatchObject({ method: 'GET', body: undefined });
    expect(seen[1].headers.Authorization).toBeUndefined();
    expect(seen[1].headers['X-Keep']).toBe('1');
  });

  it('ignores a user Host header', async () => {
    const transport = jest.fn<Transport>(async () => reply(200));
    await safeHttpRequest({ url: 'https://example.com', headers: { Host: 'internal.local', 'X-A': 'b' } }, { lookup: lookupTo(PUBLIC), transport });
    expect(transport.mock.calls[0][0].headers).toEqual({ 'X-A': 'b' });
  });

  it('the limit is 10 seconds', async () => {
    expect(HTTP_TIMEOUT_MS).toBe(10_000);
    jest.useFakeTimers();
    const hangs: Transport = (req) => new Promise((_, reject) => req.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    const call = safeHttpRequest({ url: 'https://example.com' }, { lookup: lookupTo(PUBLIC), transport: hangs });
    const outcome = call.then(() => 'resolved', (e) => e);
    await jest.advanceTimersByTimeAsync(9_999);
    let settled = false;
    void outcome.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    const err = await outcome;
    expect(err).toBeInstanceOf(HttpRequestError);
    expect(err.message).toBe('Request timed out after 10 seconds');
  });

  it('a network failure is a clear error', async () => {
    const transport: Transport = async () => { throw Object.assign(new Error('boom'), { code: 'ECONNREFUSED' }); };
    await expect(safeHttpRequest({ url: 'https://example.com' }, { lookup: lookupTo(PUBLIC), transport })).rejects.toThrow('Request failed: ECONNREFUSED');
  });

  it('reports ok=false for a 500 and passes the truncated flag on', async () => {
    const transport = jest.fn<Transport>(async () => reply(500, { body: 'x', truncated: true }));
    await expect(safeHttpRequest({ url: 'https://example.com' }, { lookup: lookupTo(PUBLIC), transport })).resolves.toMatchObject({ status: 500, ok: false, truncated: true });
  });
});

describe('nodeTransport (a real local server; the guard is not in this layer)', () => {
  let server: http.Server;
  afterEach(async () => { await new Promise((r) => server?.close(r)); });

  const serve = async (handler: http.RequestListener) => {
    server = http.createServer(handler);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    return (server.address() as AddressInfo).port;
  };
  const call = (port: number, over: Partial<Parameters<Transport>[0]> = {}) =>
    nodeTransport({
      url: new URL(`http://names.never.resolve.test:${port}/p?q=1`), method: 'GET', headers: {},
      address: { address: '127.0.0.1', family: 4 }, signal: new AbortController().signal, ...over,
    });

  it('connects to the given address, not the name, and sends method, path and body', async () => {
    let got = '';
    const port = await serve((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => { got = `${req.method} ${req.url} ${req.headers.host} ${body}`; res.end('hello'); });
    });
    const res = await call(port, { method: 'POST', body: '{"a":1}', headers: { 'Content-Type': 'application/json' } });
    expect(res).toMatchObject({ status: 200, body: 'hello', truncated: false });
    expect(got).toBe(`POST /p?q=1 names.never.resolve.test:${port} {"a":1}`);
  });

  it('cuts the body at 10 KB', async () => {
    const port = await serve((_req, res) => { res.end('a'.repeat(MAX_BODY_BYTES * 3)); });
    const res = await call(port);
    expect(res.truncated).toBe(true);
    expect(Buffer.byteLength(res.body)).toBe(MAX_BODY_BYTES);
  });

  it('keeps a body of exactly 10 KB whole', async () => {
    const port = await serve((_req, res) => { res.end('b'.repeat(MAX_BODY_BYTES)); });
    const res = await call(port);
    expect(res.truncated).toBe(false);
    expect(res.body.length).toBe(MAX_BODY_BYTES);
  });

  it('aborts on the signal', async () => {
    const port = await serve(() => { /* never answers */ });
    const controller = new AbortController();
    const pending = call(port, { signal: controller.signal });
    setTimeout(() => controller.abort(), 50);
    await expect(pending).rejects.toBeDefined();
  });
});
