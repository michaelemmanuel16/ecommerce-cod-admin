import { describe, it, expect } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import cors from 'cors';

// Replicate the CORS setup from server.ts to unit-test the origin logic
function makeApp(frontendUrl: string, platformUrl: string) {
  const app = express();
  app.use(cors({
    origin: [frontendUrl, platformUrl],
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
});
