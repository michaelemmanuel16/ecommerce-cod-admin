import { describe, it, expect } from '@jest/globals';
import { fileSignatureError } from '../../utils/fileSignature';

const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBPVP8 ')]);
const good: Array<[string, Buffer]> = [
  ['image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0])],
  ['image/jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe1])],
  ['image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])],
  ['image/gif', Buffer.from('GIF89a....')],
  ['image/gif', Buffer.from('GIF87a....')],
  ['image/webp', webp],
  ['application/pdf', Buffer.from('%PDF-1.7\n')],
];

describe('fileSignatureError', () => {
  it.each(good)('accepts real %s bytes', (type, buf) => {
    expect(fileSignatureError(type, buf)).toBeNull();
  });

  it.each(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'])('refuses html sent as %s', (type) => {
    expect(fileSignatureError(type, Buffer.from('<html>x</html>'))).toMatch(/^This file is not a valid /);
  });

  it('refuses a PNG sent as a JPEG, and an empty or short file', () => {
    expect(fileSignatureError('image/jpeg', good[2][1])).toBe('This file is not a valid JPEG image');
    expect(fileSignatureError('application/pdf', Buffer.alloc(0))).toBe('This file is not a valid PDF');
    expect(fileSignatureError('image/webp', Buffer.from('RIFF'))).toBe('This file is not a valid WebP image');
  });

  it('a type with no signature rule is left to the type filter', () => {
    expect(fileSignatureError('text/plain', Buffer.from('x'))).toBeNull();
  });
});
