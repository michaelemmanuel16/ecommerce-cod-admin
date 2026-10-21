/**
 * M3-T28: the token scripts pass on src/styles/tokens.css, and fail on a planted fault.
 * They run the real scripts (node scripts/check-*.mjs) against a temp copy of the file.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const FRONTEND = path.resolve(__dirname, '../../..');
const TOKENS = path.join(FRONTEND, 'src/styles/tokens.css');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tokens-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const run = (script: string, file: string) =>
  spawnSync('node', [path.join(FRONTEND, 'scripts', script), file], { encoding: 'utf8' });
const withCss = (css: string) => {
  const file = path.join(tmp, `t-${Math.random().toString(36).slice(2)}.css`);
  fs.writeFileSync(file, css);
  return file;
};

describe('check-tokens', () => {
  it('passes on tokens.css', () => {
    expect(run('check-tokens.mjs', TOKENS).status).toBe(0);
  });
  it('fails when a light token has no dark value, passes once it has one', () => {
    const bad = ':root{--pine:#0F5C55;--mint:#2FCB8B;}[data-theme="dark"]{--pine:#3FC1A8;}';
    const res = run('check-tokens.mjs', withCss(bad));
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('--mint');
    const fixed = ':root{--pine:#0F5C55;--mint:#2FCB8B;}[data-theme="dark"]{--pine:#3FC1A8;--mint:#3DDC97;}';
    expect(run('check-tokens.mjs', withCss(fixed)).status).toBe(0);
  });
});

describe('check-contrast', () => {
  it('passes on tokens.css', () => {
    expect(run('check-contrast.mjs', TOKENS).status).toBe(0);
  });
  it('fails when dark body text is too faint, passes with the real value', () => {
    const css = (ink: string) =>
      `:root{}[data-theme="dark"]{--ink:${ink};--ink-2:#A9B8B4;--ink-3:#6F7E7A;--bg:#0B1413;--card:#111D1B;--hover:#162623;--side:#0E1917;--pine:#3FC1A8;--on-pine:#04211D;}`;
    const res = run('check-contrast.mjs', withCss(css('#3A4A47')));
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('below 4.5:1');
    expect(run('check-contrast.mjs', withCss(css('#E8F0EE'))).status).toBe(0);
  });
});
