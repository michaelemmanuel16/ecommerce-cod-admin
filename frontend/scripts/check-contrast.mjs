// M3-T28 check (F-107): body text in dark mode has a contrast ratio of at least 4.5:1 (WCAG 2.x).
// Body text = --ink and --ink-2 on every surface (--bg --card --hover --side), and button text (--on-pine) on --pine.
// --ink-3 is the hint colour, not body text: it is printed for information and does not fail the check.
// Usage: node scripts/check-contrast.mjs [path/to/tokens.css]. Exit 1 when a body pair is below 4.5.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTokens } from './lib/tokens.mjs';

const MIN = 4.5;
const here = path.dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] ?? path.join(here, '../src/styles/tokens.css');
const { dark } = readTokens(file);

const channel = (v) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
function luminance(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
  const n = parseInt(m[1], 16);
  return 0.2126 * channel(n >> 16) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
export function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const surfaces = ['--bg', '--card', '--hover', '--side'];
const body = [
  ...['--ink', '--ink-2'].flatMap((fg) => surfaces.map((bg) => [fg, bg])),
  ['--on-pine', '--pine'],
];
const info = surfaces.map((bg) => ['--ink-3', bg]);

let failed = 0;
for (const [fg, bg, hard] of [...body.map((p) => [...p, true]), ...info.map((p) => [...p, false])]) {
  if (!dark[fg] || !dark[bg]) {
    console.error(`check-contrast: dark block has no ${!dark[fg] ? fg : bg}`);
    failed++;
    continue;
  }
  const r = ratio(dark[fg], dark[bg]);
  const ok = r >= MIN;
  if (hard && !ok) failed++;
  console.log(`${hard ? (ok ? 'ok  ' : 'FAIL') : 'info'} ${fg} on ${bg}: ${r.toFixed(2)}:1`);
}
if (failed) {
  console.error(`check-contrast: ${failed} body pair(s) below ${MIN}:1 in dark mode`);
  process.exit(1);
}
console.log(`check-contrast: dark-mode body text is at least ${MIN}:1`);
