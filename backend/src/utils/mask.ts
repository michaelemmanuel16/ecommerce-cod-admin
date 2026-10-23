/** "ama@gmail.com" gives "a***@gmail.com". An address with no "@" gives "***". One mask for logs and public answers. */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  return at > 0 ? `${email[0]}***${email.slice(at)}` : '***';
}
