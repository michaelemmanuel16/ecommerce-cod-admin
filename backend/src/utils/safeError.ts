/** An error message safe to log: token query values (access_token, input_token, ...) and Meta tokens (EAA...) are removed. */
export function safeErrorMessage(err: unknown): string | undefined {
  const message = (err as Error | undefined)?.message;
  if (typeof message !== 'string') return undefined;
  return message
    .replace(/([?&])(?:access_token|input_token|client_secret|code)=[^&\s"']+/gi, '$1[redacted]')
    .replace(/\bEAA[A-Za-z0-9]{10,}\b/g, '[redacted]');
}
