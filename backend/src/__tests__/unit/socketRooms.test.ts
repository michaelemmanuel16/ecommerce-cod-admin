/**
 * M0-T16 (COD-4): room-name builder, and a code scan that no tenant data goes to a global emit.
 */
import { describe, it, expect } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { roomNames } from '../../sockets/rooms';

describe('roomNames', () => {
  it('builds tenant-prefixed room names', () => {
    expect(roomNames.tenant('abc')).toBe('t:abc');
    expect(roomNames.role('abc', 'admin')).toBe('t:abc:role:admin');
    expect(roomNames.user('abc', 7)).toBe('t:abc:user:7');
    expect(roomNames.order('abc', 42)).toBe('t:abc:order:42');
  });

  it('the same role or id in two tenants gives two different rooms', () => {
    expect(roomNames.role('a', 'admin')).not.toBe(roomNames.role('b', 'admin'));
    expect(roomNames.user('a', 1)).not.toBe(roomNames.user('b', 1));
    expect(roomNames.order('a', 1)).not.toBe(roomNames.order('b', 1));
  });

  it('platform rooms carry no tenant prefix', () => {
    expect(roomNames.platform).toBe('platform');
    expect(roomNames.platformUser(3)).toBe('platform:user:3');
  });
});

describe('no global emit of tenant data', () => {
  // Allow-list: file -> reason. Empty: every emit in the app is tenant data.
  const ALLOW: Record<string, string> = {};

  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return e.name === '__tests__' ? [] : walk(full);
      return e.name.endsWith('.ts') ? [full] : [];
    });

  it('src has no io.emit( or getSocketInstance()?.emit( outside the allow-list', () => {
    const src = path.join(__dirname, '../..');
    const offenders = walk(src)
      .filter((f) => !ALLOW[path.relative(src, f)])
      .filter((f) => /\bio\.emit\(|getSocketInstance\(\)\??\.emit\(/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(src, f));
    expect(offenders).toEqual([]);
  });
});
