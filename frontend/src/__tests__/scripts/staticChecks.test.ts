/**
 * M3-T30: scripts/check-static.mjs fails on a planted violation in a scanned folder and passes after removal.
 * Runs the real script with --root pointing at a temp tree that mirrors the scanned paths.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const FRONTEND = path.resolve(__dirname, '../../..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'static-'));
const dir = path.join(root, 'src/components/ui-v2');
fs.mkdirSync(dir, { recursive: true });
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const run = () => spawnSync('node', [path.join(FRONTEND, 'scripts/check-static.mjs'), '--root', root], { encoding: 'utf8' });
const plant = (name: string, code: string) => fs.writeFileSync(path.join(dir, name), code);
const remove = (name: string) => fs.rmSync(path.join(dir, name));

describe('check-static', () => {
  it('passes on the real repo', () => {
    const res = spawnSync('node', [path.join(FRONTEND, 'scripts/check-static.mjs')], { encoding: 'utf8' });
    expect(res.status).toBe(0);
  });
  it('passes on clean code', () => {
    plant('Ok.tsx', 'export const A = () => <button type="button" onClick={() => go()}>Go</button>;\nexport const B = () => <button type="submit">Save</button>;\nexport const C = (p) => <button type="button" {...p} />;\nconst id = "#1042";');
    expect(run().status).toBe(0);
    remove('Ok.tsx');
  });
  it('fails on a hex colour, passes after removal', () => {
    plant('Hex.tsx', 'export const s = { color: "#0F5C55" };');
    const bad = run();
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('[hex]');
    remove('Hex.tsx');
    expect(run().status).toBe(0);
  });
  it('fails on a <button> with no type, passes after removal', () => {
    plant('NoType.tsx', 'export const A = () => <button onClick={() => x()}>Go</button>;');
    const bad = run();
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('has no type');
    remove('NoType.tsx');
    expect(run().status).toBe(0);
  });
  it('fails on a <button> with no handler, even when the handler arrow has a ">"', () => {
    plant('NoHandler.tsx', 'export const A = () => (\n  <button\n    type="button"\n    className="btn"\n  >Go</button>\n);');
    const bad = run();
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('no handler');
    remove('NoHandler.tsx');
    expect(run().status).toBe(0);
  });
  it('fails on window.confirm and on a bare confirm(), passes after removal', () => {
    plant('Confirm.ts', 'export const a = () => window.confirm("Sure?");');
    plant('Confirm2.ts', 'export const b = () => confirm("Sure?");');
    const bad = run();
    expect(bad.status).toBe(1);
    expect(bad.stderr.match(/\[confirm\]/g)).toHaveLength(2);
    remove('Confirm.ts');
    remove('Confirm2.ts');
    expect(run().status).toBe(0);
  });
  it('a line marked check-static:allow is exempt', () => {
    plant('Allow.ts', 'export const c = "#fff"; // check-static:allow test fixture');
    expect(run().status).toBe(0);
    remove('Allow.ts');
  });
});
