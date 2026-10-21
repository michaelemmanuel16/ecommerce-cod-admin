// M3-T28 check: every `--token` in the light block of src/styles/tokens.css has a dark value.
// Usage: node scripts/check-tokens.mjs [path/to/tokens.css]. Exit 1 on a gap or an empty block.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTokens } from './lib/tokens.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] ?? path.join(here, '../src/styles/tokens.css');
const { light, dark } = readTokens(file);

const names = Object.keys(light);
const missing = names.filter((n) => !(n in dark));
const extra = Object.keys(dark).filter((n) => !(n in light));

if (names.length === 0) {
  console.error(`check-tokens: no tokens found in the :root block of ${file}`);
  process.exit(1);
}
if (missing.length || extra.length) {
  if (missing.length) console.error(`check-tokens: no dark value for ${missing.join(', ')}`);
  if (extra.length) console.error(`check-tokens: dark block has ${extra.join(', ')} but :root does not`);
  process.exit(1);
}
console.log(`check-tokens: ${names.length} tokens, all have a dark value`);
