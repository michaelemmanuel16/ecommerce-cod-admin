import net from 'net';
import { AppError } from '../middleware/errorHandler';
import { HttpRequestError, resolvePublicAddress } from './safeHttp';

/**
 * The SMTP host is typed by an admin: refuse private, loopback and link-local servers (SSRF). Returns the checked address
 * to connect to (not the name again, so a second DNS answer cannot point somewhere else) and the TLS name to keep.
 */
export async function resolveSmtpHost(host: string): Promise<{ address: string; tls?: { servername: string } }> {
  try {
    const { address } = await resolvePublicAddress(host);
    return net.isIP(host) ? { address } : { address, tls: { servername: host } };
  } catch (error) {
    if (error instanceof HttpRequestError) throw new AppError(error.message, 400, 'SMTP_HOST_REFUSED');
    throw error;
  }
}
