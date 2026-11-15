/** M9-T09 (COD-78): the pure template rules. */
import { describe, it, expect } from '@jest/globals';
import { isSendable, assertSendable, freeName, placeholders, statusOf } from '../../services/messaging/templateService';
import { templateCreateSchema } from '../../validators/messageTemplateSchema';

jest.mock('../../utils/prisma', () => ({ __esModule: true, default: {}, prismaBase: {} }));
jest.mock('../../services/messaging/providers/whatsappCloudProvider', () => ({ getDbWhatsappConfig: jest.fn(), WHATSAPP_API_URL: 'https://graph.test/v21.0' }));

const wa = (metaStatus: string | null) => ({ name: 'order_x', channel: 'whatsapp' as const, metaStatus });

describe('a WhatsApp template can be picked only when approved', () => {
  it('approved passes', () => expect(isSendable(wa('APPROVED'))).toBe(true));
  it.each(['PENDING', 'REJECTED', 'PAUSED', null])('%s is refused with 409', (status) => {
    expect(isSendable(wa(status))).toBe(false);
    expect(() => assertSendable(wa(status))).toThrow(expect.objectContaining({ statusCode: 409, errorCode: 'TEMPLATE_NOT_APPROVED' }));
  });
  it('SMS and email have no approval step', () => {
    expect(isSendable({ channel: 'sms', metaStatus: null })).toBe(true);
    expect(isSendable({ channel: 'email', metaStatus: null })).toBe(true);
  });
  it('the API status is lower case', () => expect(statusOf({ metaStatus: 'REJECTED' })).toBe('rejected'));
});

describe('freeName', () => {
  it('keeps a free name and suffixes a clash with (2), (3)', () => {
    expect(freeName(['A'], 'B')).toBe('B');
    expect(freeName(['A'], 'A')).toBe('A (2)');
    expect(freeName(['A', 'A (2)'], 'A')).toBe('A (3)');
  });
});

describe('placeholders', () => {
  it('reads {{1}} and {{name}} once each, in order', () => expect(placeholders('Hi {{1}}, {{ name }} and {{1}}')).toEqual(['1', 'name']));
});

describe('template schema', () => {
  it('an email template needs a subject', () => {
    expect(templateCreateSchema.safeParse({ channel: 'email', name: 'n', body: 'b' }).success).toBe(false);
    expect(templateCreateSchema.safeParse({ channel: 'email', name: 'n', body: 'b', subject: 's' }).success).toBe(true);
  });
  it('Meta fields are for WhatsApp only', () => {
    expect(templateCreateSchema.safeParse({ channel: 'sms', name: 'n', body: 'b', language: 'en_US' }).success).toBe(false);
    expect(templateCreateSchema.safeParse({ channel: 'whatsapp', name: 'n', body: 'b', language: 'en_US', category: 'UTILITY' }).success).toBe(true);
  });
});
