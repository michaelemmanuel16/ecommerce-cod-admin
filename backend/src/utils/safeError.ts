/** Text with token query values (access_token, input_token, ...) and Meta tokens (EAA...) removed. */
export function redactSecrets(text: string): string {
  return text
    .replace(/([?&])(?:access_token|input_token|client_secret|code)=[^&\s"']+/gi, '$1[redacted]')
    .replace(/\bEAA[A-Za-z0-9]{10,}\b/g, '[redacted]');
}

/** An error message safe to log: token query values and Meta tokens are removed. */
export function safeErrorMessage(err: unknown): string | undefined {
  const message = (err as Error | undefined)?.message;
  return typeof message === 'string' ? redactSecrets(message) : undefined;
}
