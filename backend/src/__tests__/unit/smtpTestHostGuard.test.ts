import nodemailer from 'nodemailer';

jest.mock('nodemailer', () => ({ __esModule: true, default: { createTransport: jest.fn() } }));
jest.mock('../../services/messaging/providers/emailProvider', () => ({ getDbEmailConfig: jest.fn().mockResolvedValue(null) }));
jest.mock('../../services/messaging/providers/arkeselSmsProvider', () => ({ arkeselCallbackUrl: jest.fn() }));
jest.mock('dns', () => ({ promises: { lookup: jest.fn() } }));

import dns from 'dns';
import { sendSmtpTest } from '../../services/connectionSettingsService';

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
