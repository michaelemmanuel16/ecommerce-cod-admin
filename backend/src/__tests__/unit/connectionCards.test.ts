/** M9-T26: card status rules and activity levels. */
import { describe, it, expect } from '@jest/globals';
import '../mocks/prisma.mock';
import '../mocks/logger.mock';
import { resolveStatus, ERROR_WINDOW_MS } from '../../services/connections/connectionCards';

const now = new Date('2026-11-14T12:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms);

describe('resolveStatus', () => {
  it('not set up is not_connected with the reason', () => {
    expect(resolveStatus({ configured: false, notConnectedReason: 'Add your Arkesel API key', now })).toEqual({ status: 'not_connected', reason: 'Add your Arkesel API key' });
  });

  it('set up with no problem is connected, no reason', () => {
    expect(resolveStatus({ configured: true, notConnectedReason: 'x', now })).toEqual({ status: 'connected', reason: null });
  });

  it('a config problem is error', () => {
    expect(resolveStatus({ configured: true, notConnectedReason: 'x', configError: 'Token expired', now })).toEqual({ status: 'error', reason: 'Token expired' });
  });

  it('an error row in the last 24 hours is error; an older one, a warning or an info row is not', () => {
    const base = { configured: true, notConnectedReason: 'x', now };
    expect(resolveStatus({ ...base, lastEvent: { level: 'error', message: 'Bad key', createdAt: ago(ERROR_WINDOW_MS - 1000) } })).toEqual({ status: 'error', reason: 'Bad key' });
    expect(resolveStatus({ ...base, lastEvent: { level: 'error', message: 'Bad key', createdAt: ago(ERROR_WINDOW_MS + 1000) } }).status).toBe('connected');
    expect(resolveStatus({ ...base, lastEvent: { level: 'warning', message: 'w', createdAt: ago(1000) } }).status).toBe('connected');
    expect(resolveStatus({ ...base, lastEvent: { level: 'info', message: 'i', createdAt: ago(1000) } }).status).toBe('connected');
  });

  it('not set up wins over an error row', () => {
    expect(resolveStatus({ configured: false, notConnectedReason: 'Connect', lastEvent: { level: 'error', message: 'e', createdAt: ago(1) }, now }).status).toBe('not_connected');
  });
});
