import net from 'net';
import nodemailer from 'nodemailer';
import { AppError } from '../middleware/errorHandler';
import { getDbEmailConfig } from './messaging/providers/emailProvider';
import { arkeselCallbackUrl } from './messaging/providers/arkeselSmsProvider';
import { SECRET_MASK } from '../utils/providerCrypto';
import { HttpRequestError, resolvePublicAddress } from '../utils/safeHttp';

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
  const password = input.password && input.password !== SECRET_MASK ? input.password : savedSmtp?.apiKey;
  const user = input.smtpUser?.trim() || savedSmtp?.smtpUser || fromEmail;
  if (!host || !fromEmail || !password) {
    throw new AppError('Enter the SMTP host, the from address and the password first', 400, 'SMTP_FIELDS_MISSING');
  }

  // The host is typed by an admin: refuse private, loopback and link-local servers, and connect to the checked
  // address (not the name again) so a second DNS answer cannot point somewhere else. TLS still checks the name.
  let address: string;
  try {
    ({ address } = await resolvePublicAddress(host));
  } catch (error) {
    if (error instanceof HttpRequestError) throw new AppError(error.message, 400, 'SMTP_HOST_REFUSED');
    throw error;
  }

  const transporter = nodemailer.createTransport({
    host: address,
    ...(net.isIP(host) ? {} : { tls: { servername: host } }),
    port: input.smtpPort ?? savedSmtp?.smtpPort ?? 587,
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
