import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

const findMany = jest.fn<any>();
const update = jest.fn<any>();
jest.mock('../../utils/prisma', () => ({
  __esModule: true,
  default: { systemConfig: { findMany: (...a: any[]) => findMany(...a), update: (...a: any[]) => update(...a) }, $disconnect: jest.fn() },
}));

import { encryptAll } from '../../scripts/encryptProviderSecrets';
import { isEncryptedString } from '../../utils/providerCrypto';

const KEY = 'a'.repeat(64);

describe('encryptProviderSecrets script', () => {
  const saved = process.env.PROVIDER_ENCRYPTION_KEY;
  beforeEach(() => {
    process.env.PROVIDER_ENCRYPTION_KEY = KEY;
    findMany.mockReset();
    update.mockReset();
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.PROVIDER_ENCRYPTION_KEY;
    else process.env.PROVIDER_ENCRYPTION_KEY = saved;
  });

  const rows = () => [
    { id: 1, smsProvider: { provider: 'arkesel', authToken: 'plain-sms' }, whatsappProvider: null, emailProvider: null, paystackProvider: null },
    { id: 2, smsProvider: null, whatsappProvider: null, emailProvider: null, paystackProvider: null },
  ];

  it('fails when the key is not set', async () => {
    delete process.env.PROVIDER_ENCRYPTION_KEY;
    await expect(encryptAll(true)).rejects.toThrow('PROVIDER_ENCRYPTION_KEY');
    expect(findMany).not.toHaveBeenCalled();
  });

  it('dry run counts per type and writes nothing', async () => {
    findMany.mockResolvedValue(rows());
    const r = await encryptAll(false);
    expect(r.counts.smsProvider).toBe(1);
    expect(r.rows).toBe(1);
    expect(update).not.toHaveBeenCalled();
  });

  it('apply encrypts only changed rows; a second run changes nothing', async () => {
    findMany.mockResolvedValue(rows());
    await encryptAll(true);
    expect(update).toHaveBeenCalledTimes(1);
    const arg = update.mock.calls[0][0] as any;
    expect(arg.where).toEqual({ id: 1 });
    expect(isEncryptedString(arg.data.smsProvider.authToken)).toBe(true);
    expect(arg.data.smsProvider.provider).toBe('arkesel');

    update.mockReset();
    findMany.mockResolvedValue([{ ...rows()[0], smsProvider: arg.data.smsProvider }]);
    const again = await encryptAll(true);
    expect(again.rows).toBe(0);
    expect(update).not.toHaveBeenCalled();
  });
});
