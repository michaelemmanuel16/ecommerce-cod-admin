import nodemailer from 'nodemailer';
import { prismaMock } from '../mocks/prisma.mock';

jest.mock('nodemailer', () => ({ __esModule: true, default: { createTransport: jest.fn() } }));
jest.mock('../../services/messaging/providers/emailProvider', () => ({
  ...jest.requireActual('../../services/messaging/providers/emailProvider'),
  getDbEmailConfig: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../services/messaging/providers/arkeselSmsProvider', () => ({ arkeselCallbackUrl: jest.fn() }));
jest.mock('dns', () => ({ promises: { lookup: jest.fn() } }));

import dns from 'dns';
import { sendSmtpTest } from '../../services/connectionSettingsService';
import { adminService } from '../../services/adminService';

const lookup = dns.promises.lookup as unknown as jest.Mock;
const createTransport = (nodemailer as any).createTransport as jest.Mock;
const input = (smtpHost: string) => ({ smtpHost, fromEmail: 'shop@example.com', password: 'secret' });

describe('SMTP test refuses private hosts (M9 /cso)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    createTransport.mockReturnValue({ sendMail: jest.fn().mockResolvedValue({}) });
  });

  it.each(['127.0.0.1', '10.0.0.5', '169.254.169.254', '[::1]'])('refuses %s and never opens a connection', async (host) => {
    await expect(sendSmtpTest('me@example.com', input(host))).rejects.toMatchObject({ statusCode: 400, errorCode: 'SMTP_HOST_REFUSED' });
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('refuses a name that resolves to a private address', async () => {
    lookup.mockResolvedValue([{ address: '192.168.1.10', family: 4 }]);
    await expect(sendSmtpTest('me@example.com', input('mail.internal'))).rejects.toMatchObject({ errorCode: 'SMTP_HOST_REFUSED' });
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('connects to the checked public address and keeps the name for TLS', async () => {
    lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
    await expect(sendSmtpTest('me@example.com', input('smtp.example.com'))).resolves.toEqual({ ok: true, sentTo: 'me@example.com' });
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: '8.8.8.8', tls: { servername: 'smtp.example.com' } }));
  });
});

describe('SMTP send and save refuse private hosts (M9 /cso)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    createTransport.mockReturnValue({ sendMail: jest.fn().mockResolvedValue({ messageId: 'm1' }) });
  });

  const sendInput = { to: 'buyer@example.com', subject: 'Hi', body: '<p>Hi</p>', from: '"Shop" <shop@example.com>', tenantId: 1 } as any;
  const smtpConfig = (smtpHost: string) => ({
    provider: 'smtp', apiKey: 'secret', fromEmail: 'shop@example.com', fromName: 'Shop', smtpHost, smtpPort: 587,
  });
  const sendWith = async (smtpHost: string) => {
    const { emailProvider, clearEmailConfigCache } = await import('../../services/messaging/providers/emailProvider');
    clearEmailConfigCache();
    (prismaMock.systemConfig.findFirst as any).mockResolvedValue({ emailProvider: smtpConfig(smtpHost) });
    return emailProvider.send(sendInput);
  };

  it('fails the send for a private host and never opens a connection', async () => {
    const result = await sendWith('169.254.169.254');
    expect(result).toMatchObject({ accepted: false });
    expect(result.error).toMatch(/private|blocked|internal|not allowed|refus/i);
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('sends through the checked public address and keeps the name for TLS', async () => {
    lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
    const result = await sendWith('smtp.example.com');
    expect(result).toMatchObject({ accepted: true });
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: '8.8.8.8', tls: { servername: 'smtp.example.com' } }));
  });

  it('refuses to save a private SMTP host', async () => {
    jest.spyOn(adminService, 'checkAdminPrivilege').mockResolvedValue(undefined as any);
    (prismaMock.systemConfig.findFirst as any).mockResolvedValue({ id: 1, tenantId: null });
    await expect(
      adminService.updateSystemConfig({ id: 1, role: 'super_admin' } as any, { emailProvider: smtpConfig('10.0.0.5') }),
    ).rejects.toMatchObject({ statusCode: 400, errorCode: 'SMTP_HOST_REFUSED' });
    expect(prismaMock.systemConfig.update).not.toHaveBeenCalled();
  });
});
