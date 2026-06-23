import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { prismaMock } from '../mocks/prisma.mock';

// Rate limiter is irrelevant here and may reach for redis — make it a passthrough.
jest.mock('../../middleware/rateLimiter', () => ({
  webhookLimiter: (_req: any, _res: any, next: any) => next(),
  publicOrderLimiter: (_req: any, _res: any, next: any) => next(),
  apiLimiter: (_req: any, _res: any, next: any) => next(),
}));

import unsubscribeRoutes from '../../routes/unsubscribeRoutes';
import {
  ensureUnsubscribeToken,
  buildUnsubscribeUrl,
  optOutByUnsubscribeToken,
} from '../../services/unsubscribeService';
import { renderEmailTemplate, appendUnsubscribeFooter } from '../../services/emailTemplateService';

// Bare app mounts ONLY the router under test — no server.ts/redis/queue side effects.
const app = express();
app.use('/api/public/unsubscribe', unsubscribeRoutes);

const TOKEN = 'a'.repeat(64);

describe('Unsubscribe routes (MAN-81)', () => {
  beforeEach(() => {
    (prismaMock.customer.update as any).mockResolvedValue({});
  });

  it('GET renders a confirm page and never writes (H2)', async () => {
    (prismaMock.customer.findUnique as any).mockResolvedValue({ id: 7, emailOptOut: false });

    const res = await request(app).get(`/api/public/unsubscribe/${TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('Confirm unsubscribe');
    // Token (hex) is escape-stable, so it survives HTML-escaping of the form action.
    expect(res.text).toContain(TOKEN);
    // The critical guarantee: a GET (scanner/prefetch) must not opt anyone out.
    expect((prismaMock.customer.update as any)).not.toHaveBeenCalled();
  });

  it('GET with an unknown/forged token is rejected (404, no write)', async () => {
    (prismaMock.customer.findUnique as any).mockResolvedValue(null);

    const res = await request(app).get(`/api/public/unsubscribe/${TOKEN}`);

    expect(res.status).toBe(404);
    expect(res.text).toContain('invalid');
    expect((prismaMock.customer.update as any)).not.toHaveBeenCalled();
  });

  it('POST flips emailOptOut to true', async () => {
    (prismaMock.customer.findUnique as any).mockResolvedValue({ id: 7, emailOptOut: false });

    const res = await request(app).post(`/api/public/unsubscribe/${TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('unsubscribed');
    const updateArg = (prismaMock.customer.update as any).mock.calls[0][0];
    expect(updateArg).toEqual({ where: { id: 7 }, data: { emailOptOut: true } });
  });

  it('POST is idempotent — already opted-out customer is not re-written', async () => {
    (prismaMock.customer.findUnique as any).mockResolvedValue({ id: 7, emailOptOut: true });

    const res = await request(app).post(`/api/public/unsubscribe/${TOKEN}`);

    expect(res.status).toBe(200);
    expect((prismaMock.customer.update as any)).not.toHaveBeenCalled();
  });

  it('POST with an unknown/forged token is rejected (404, no write)', async () => {
    (prismaMock.customer.findUnique as any).mockResolvedValue(null);

    const res = await request(app).post(`/api/public/unsubscribe/${TOKEN}`);

    expect(res.status).toBe(404);
    expect((prismaMock.customer.update as any)).not.toHaveBeenCalled();
  });
});

describe('unsubscribeService (MAN-81)', () => {
  it('buildUnsubscribeUrl points at the public route', () => {
    expect(buildUnsubscribeUrl('abc123')).toMatch(/\/api\/public\/unsubscribe\/abc123$/);
  });

  it('ensureUnsubscribeToken reuses an existing token without writing', async () => {
    const token = await ensureUnsubscribeToken({ id: 7, unsubscribeToken: 'existing-token' });
    expect(token).toBe('existing-token');
    expect((prismaMock.customer.update as any)).not.toHaveBeenCalled();
  });

  it('ensureUnsubscribeToken mints + persists a 32-byte hex token when absent', async () => {
    (prismaMock.customer.update as any).mockResolvedValue({});
    const token = await ensureUnsubscribeToken({ id: 7, unsubscribeToken: null });
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    const updateArg = (prismaMock.customer.update as any).mock.calls[0][0];
    expect(updateArg).toEqual({ where: { id: 7 }, data: { unsubscribeToken: token } });
  });

  it('optOutByUnsubscribeToken returns false for an unknown token (no write)', async () => {
    (prismaMock.customer.findUnique as any).mockResolvedValue(null);
    const ok = await optOutByUnsubscribeToken('nope');
    expect(ok).toBe(false);
    expect((prismaMock.customer.update as any)).not.toHaveBeenCalled();
  });
});

describe('unsubscribe merge tag + footer (MAN-81)', () => {
  it('renders {{unsubscribe_url}} in the body (token survives HTML-escaping)', () => {
    const url = 'https://api.test/api/public/unsubscribe/tok123';
    const { html } = renderEmailTemplate(
      { subject: 's', body: '<a href="{{unsubscribe_url}}">Unsubscribe</a>' },
      { unsubscribe_url: url },
    );
    expect(html).not.toContain('{{unsubscribe_url}}'); // tag was substituted
    expect(html).toContain('tok123'); // hex/token part is escape-stable
  });

  it('appendUnsubscribeFooter adds a visible opt-out link', () => {
    const url = 'https://api.test/api/public/unsubscribe/tok123';
    const out = appendUnsubscribeFooter('<p>Hello</p>', url);
    expect(out).toContain('<p>Hello</p>');
    expect(out).toContain('tok123');
    expect(out).toContain('Unsubscribe');
  });
});
