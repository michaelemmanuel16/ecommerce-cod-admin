import { describe, it, expect } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import cors from 'cors';

// Replicate the CORS setup from server.ts to unit-test the origin logic.
function derivePlatformOrigin(frontendUrl: string): string | null {
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

function makeApp(frontendUrl: string, platformUrl?: string) {
  const app = express();
  const resolvedPlatform = platformUrl || derivePlatformOrigin(frontendUrl);
  app.use(cors({
    origin: [
      frontendUrl,
      ...(resolvedPlatform ? [resolvedPlatform] : []),
    ],
    credentials: true,
  }));
  app.get('/test', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('CORS origin configuration', () => {
  const app = makeApp('https://codadminpro.com', 'https://platform.codadminpro.com');

  it('allows requests from FRONTEND_URL', async () => {
    const res = await request(app)
      .get('/test')
      .set('Origin', 'https://codadminpro.com');
    expect(res.headers['access-control-allow-origin']).toBe('https://codadminpro.com');
  });

  it('allows requests from platform subdomain', async () => {
    const res = await request(app)
      .get('/test')
      .set('Origin', 'https://platform.codadminpro.com');
    expect(res.headers['access-control-allow-origin']).toBe('https://platform.codadminpro.com');
  });

  it('blocks requests from unknown origins', async () => {
    const res = await request(app)
      .get('/test')
      .set('Origin', 'https://evil.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('auto-derives platform subdomain from FRONTEND_URL when PLATFORM_URL is unset', async () => {
    const appAutoDerive = makeApp('https://codadminpro.com');
    const res = await request(appAutoDerive)
      .get('/test')
      .set('Origin', 'https://platform.codadminpro.com');
    expect(res.headers['access-control-allow-origin']).toBe('https://platform.codadminpro.com');
  });

  it('explicit PLATFORM_URL overrides auto-derive', async () => {
    const appCustom = makeApp('https://codadminpro.com', 'https://admin.codadminpro.com');
    const res = await request(appCustom)
      .get('/test')
      .set('Origin', 'https://admin.codadminpro.com');
    expect(res.headers['access-control-allow-origin']).toBe('https://admin.codadminpro.com');
  });

  it('does not auto-derive a platform origin for localhost', async () => {
    const appLocal = makeApp('http://localhost:5173');
    const res = await request(appLocal)
      .get('/test')
      .set('Origin', 'https://platform.localhost:5173');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('derivePlatformOrigin', () => {
  it('derives platform.<host> from apex frontend URL', () => {
    expect(derivePlatformOrigin('https://codadminpro.com')).toBe('https://platform.codadminpro.com');
  });

  it('preserves protocol', () => {
    expect(derivePlatformOrigin('http://example.test')).toBe('http://platform.example.test');
  });

  it('returns null for localhost', () => {
    expect(derivePlatformOrigin('http://localhost:5173')).toBeNull();
  });

  it('returns null when frontend is already a platform subdomain', () => {
    expect(derivePlatformOrigin('https://platform.codadminpro.com')).toBeNull();
  });

  it('returns null for invalid URL', () => {
    expect(derivePlatformOrigin('not a url')).toBeNull();
  });
});
