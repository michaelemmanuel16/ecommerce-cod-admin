import nodemailer from 'nodemailer';
import { AppError } from '../middleware/errorHandler';
import { getDbEmailConfig } from './messaging/providers/emailProvider';
import { arkeselCallbackUrl } from './messaging/providers/arkeselSmsProvider';
import { SECRET_MASK } from '../utils/providerCrypto';
import { resolveSmtpHost } from '../utils/smtpHost';

/** Settings helpers of the Connections page (M9-T27, F-1201 to F-1203). */

/**
 * The delivery-report URL the owner pastes into the Arkesel dashboard, with the callback token. Null when the platform
 * has no token set (Arkesel reports would be refused in production).
 */
export function smsReportUrl(): { url: string | null; message?: string } {
  const url = arkeselCallbackUrl();
  return url ? { url } : { url: null, message: 'The delivery report token is not set on the server' };
}

export interface SmtpTestInput {
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUser?: string;
  /** The SMTP password; the mask or nothing keeps the saved one. */
  password?: string;
  fromEmail?: string;
}

const SMTP_TIMEOUT_MS = 10_000;

/**
 * `POST /api/settings/smtp/test`: one test email to the caller, through the SMTP fields in the body (or the saved ones).
 * The mask or an empty password keeps the saved password. A failure answers 400 with the server's own error text.
 */
export async function sendSmtpTest(callerEmail: string, input: SmtpTestInput) {
  const saved = await getDbEmailConfig();
  const savedSmtp = saved?.provider === 'smtp' ? saved : null;
  const host = input.smtpHost?.trim() || savedSmtp?.smtpHost;
  const fromEmail = input.fromEmail?.trim() || savedSmtp?.fromEmail;
  const user = input.smtpUser?.trim() || savedSmtp?.smtpUser || fromEmail;
  const port = input.smtpPort ?? savedSmtp?.smtpPort ?? 587;
  const typed = input.password && input.password !== SECRET_MASK ? input.password : undefined;
  // The saved password goes only to the saved server: host, port and user must all match what is saved.
  const sameServer = !!savedSmtp
    && host?.toLowerCase() === savedSmtp.smtpHost?.trim().toLowerCase()
    && port === (savedSmtp.smtpPort ?? 587)
    && (user ?? '').toLowerCase() === (savedSmtp.smtpUser || savedSmtp.fromEmail || '').toLowerCase();
  if (!typed && savedSmtp && !sameServer) {
    throw new AppError('Type the password again when you change the server.', 400, 'SECRET_REQUIRED');
  }
  const password = typed ?? (sameServer ? savedSmtp?.apiKey : undefined);
  if (!host || !fromEmail || !password) {
    throw new AppError('Enter the SMTP host, the from address and the password first', 400, 'SMTP_FIELDS_MISSING');
  }

  // Refuse private hosts and connect to the checked address (see resolveSmtpHost).
  const { address, tls } = await resolveSmtpHost(host);

  const transporter = nodemailer.createTransport({
    host: address,
    ...(tls ? { tls } : {}),
    port,
    secure: input.smtpSecure ?? savedSmtp?.smtpSecure ?? false,
    auth: { user, pass: password },
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
  });
  try {
    await transporter.sendMail({
      from: fromEmail,
      to: callerEmail,
      subject: 'CodAdmin SMTP test',
      text: 'This is a test email from CodAdmin. Your SMTP settings work.',
    });
  } catch (error: any) {
    throw new AppError(error?.message || 'The SMTP server refused the message', 400, 'SMTP_TEST_FAILED');
  }
  return { ok: true, sentTo: callerEmail };
}
