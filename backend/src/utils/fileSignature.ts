/**
 * Magic-byte check for the files POST /api/upload accepts. The browser's content type is only a claim; the first
 * bytes say what the file is. A file whose bytes do not match its claimed type is not stored.
 */
const ascii = (buf: Buffer, start: number, text: string) => buf.length >= start + text.length && buf.toString('latin1', start, start + text.length) === text;
const bytes = (buf: Buffer, ...values: number[]) => buf.length >= values.length && values.every((v, i) => buf[i] === v);

const SIGNATURES: Record<string, { label: string; matches: (buf: Buffer) => boolean }> = {
  'image/jpeg': { label: 'JPEG image', matches: (b) => bytes(b, 0xff, 0xd8, 0xff) },
  'image/jpg': { label: 'JPEG image', matches: (b) => bytes(b, 0xff, 0xd8, 0xff) },
  'image/png': { label: 'PNG image', matches: (b) => bytes(b, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) },
  'image/gif': { label: 'GIF image', matches: (b) => ascii(b, 0, 'GIF87a') || ascii(b, 0, 'GIF89a') },
  'image/webp': { label: 'WebP image', matches: (b) => ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP') },
  'application/pdf': { label: 'PDF', matches: (b) => ascii(b, 0, '%PDF-') },
};

/** null when the bytes match the claimed type; otherwise the message for the 400 answer. */
export function fileSignatureError(mimetype: string, buffer: Buffer): string | null {
  const sig = SIGNATURES[mimetype];
  if (!sig || sig.matches(buffer)) return null;
  return `This file is not a valid ${sig.label}`;
}
