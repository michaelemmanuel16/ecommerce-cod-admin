import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { prismaMock } from '../mocks/prisma.mock';
import '../mocks/logger.mock';
import whatsappService from '../../services/whatsappService';

describe('whatsappService.sendTemplate components structure', () => {
  const originalFetch = global.fetch;
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      WHATSAPP_ACCESS_TOKEN: 'mock-access-token',
      WHATSAPP_PHONE_NUMBER_ID: 'mock-phone-id',
      WHATSAPP_APP_SECRET: 'mock-secret',
    };
    (prismaMock.systemConfig.findFirst as any).mockResolvedValue(null);
    (prismaMock.messageLog.create as any).mockResolvedValue({ id: 101 });
    (prismaMock.messageLog.update as any).mockResolvedValue({ id: 101 });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = originalEnv;
  });

  it("sendTemplate with headerParams + bodyParams + buttonPayloads builds components in order header, body, button index '0','1','2' with { type: 'payload', payload }", async () => {
    let capturedPayload: any = null;
    global.fetch = jest.fn(async (_url: any, init: any) => {
      capturedPayload = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({ messages: [{ id: 'wamid.test.1' }] }),
      } as any;
    }) as any;

    const res = await whatsappService.sendTemplate({
      to: '+233241234567',
      templateName: 'order_auto_confirm',
      languageCode: 'en',
      headerParams: ['Magic Cream'],
      bodyParams: ['Kofi Annan', '2 sets', '123', 'GH₵360'],
      buttonPayloads: ['CONFIRM', 'CHANGE', 'CANCEL'],
      orderId: 123,
      customerId: 456,
    });

    expect(res.providerMessageId).toBe('wamid.test.1');
    expect(global.fetch).toHaveBeenCalledTimes(1);

    expect(capturedPayload).toMatchObject({
      messaging_product: 'whatsapp',
      to: '233241234567',
      type: 'template',
      template: {
        name: 'order_auto_confirm',
        language: { code: 'en' },
      },
    });

    const components = capturedPayload.template.components;
    expect(components).toHaveLength(5);

    // 1. Header component
    expect(components[0]).toEqual({
      type: 'header',
      parameters: [{ type: 'text', text: 'Magic Cream' }],
    });

    // 2. Body component
    expect(components[1]).toEqual({
      type: 'body',
      parameters: [
        { type: 'text', text: 'Kofi Annan' },
        { type: 'text', text: '2 sets' },
        { type: 'text', text: '123' },
        { type: 'text', text: 'GH₵360' },
      ],
    });

    // 3. Button index '0'
    expect(components[2]).toEqual({
      type: 'button',
      sub_type: 'quick_reply',
      index: '0',
      parameters: [{ type: 'payload', payload: 'CONFIRM' }],
    });

    // 4. Button index '1'
    expect(components[3]).toEqual({
      type: 'button',
      sub_type: 'quick_reply',
      index: '1',
      parameters: [{ type: 'payload', payload: 'CHANGE' }],
    });

    // 5. Button index '2'
    expect(components[4]).toEqual({
      type: 'button',
      sub_type: 'quick_reply',
      index: '2',
      parameters: [{ type: 'payload', payload: 'CANCEL' }],
    });
  });

  it('a call with only bodyParams builds the same body component as before', async () => {
    let capturedPayload: any = null;
    global.fetch = jest.fn(async (_url: any, init: any) => {
      capturedPayload = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({ messages: [{ id: 'wamid.test.2' }] }),
      } as any;
    }) as any;

    const res = await whatsappService.sendTemplate({
      to: '+233241234567',
      templateName: 'order_created',
      bodyParams: ['Kofi', '123'],
    });

    expect(res.providerMessageId).toBe('wamid.test.2');
    expect(global.fetch).toHaveBeenCalledTimes(1);

    expect(capturedPayload.template.components).toEqual([
      {
        type: 'body',
        parameters: [
          { type: 'text', text: 'Kofi' },
          { type: 'text', text: '123' },
        ],
      },
    ]);
  });
});
