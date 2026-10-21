// M3-T30 static checks (F-111, F-328, F-100). Run in CI by `npm run check:static`.
//
// SCOPE: these checks run against NEW code paths only, listed in SCANNED below. The old pages and components
// (hundreds of files) are NOT scanned and must not make CI fail. Later tasks add their own folders to SCANNED
// (for example each v2 page folder). A path may be a folder or a single file; missing paths are skipped.
//
// Checks:
//   hex      a hex colour (#fff, #0F5C55) in a .ts/.tsx/.css file. Colours belong in src/styles/tokens.css only.
//   button   a <button> with no type attribute, or with no handler (onClick, onChange, ...) and not type="submit".
//            A {...spread} counts as a handler, because the props come from the caller.
//   confirm  window.confirm or a bare confirm(...) call. Use ConfirmDialog.
// Add `check-static:allow` in a comment on the same line to exempt one line (give the reason in the comment).
//
// Usage: node scripts/check-static.mjs [--root <frontend dir>]. Exit 1 on any finding.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCANNED = [
  'src/components/ui-v2',
  'src/styles/components.css',
  // later tasks: 'src/pages/v2', ...
];

const EXT = /\.(tsx?|css)$/;
const ALLOW = 'check-static:allow';

function files(target, out = []) {
  if (!fs.existsSync(target)) return out;
  const st = fs.statSync(target);
  if (st.isFile()) {
    if (EXT.test(target)) out.push(target);
  } else {
    for (const e of fs.readdirSync(target)) files(path.join(target, e), out);
  }
  return out;
}

const HEX = /#[0-9a-fA-F]{3,8}\b/g;
// "#1042" is an order number, not a colour: pure digits count only at 6 or 8 digits.
const isColour = (m) => /[a-fA-F]/.test(m) || /^#(\d{6}|\d{8})$/.test(m);

/** Index just after the `>` that closes the tag opened at `start`, skipping quotes and {braces}. */
function tagEnd(src, start) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (depth === 0 && (c === '"' || c === "'")) quote = c;
    else if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (depth > 0 && (c === '"' || c === "'" || c === '`')) quote = c;
    else if (c === '>' && depth === 0) return i + 1;
  }
  return src.length;
}

export function scanSource(rel, src) {
  const found = [];
  const lines = src.split('\n');
  const lineOf = (idx) => src.slice(0, idx).split('\n').length;
  const add = (check, idx, msg) => {
    const n = lineOf(idx);
    if (!lines[n - 1].includes(ALLOW)) found.push(`${rel}:${n}: [${check}] ${msg}`);
  };

  for (const m of src.matchAll(HEX)) if (isColour(m[0])) add('hex', m.index, `${m[0]} is a hex colour; use a token from src/styles/tokens.css`);
  for (const m of src.matchAll(/\bwindow\.confirm\b|(?<![.\w])confirm\s*\(/g)) add('confirm', m.index, 'use ConfirmDialog, not the browser confirm');

  if (/\.tsx$/.test(rel)) {
    for (const m of src.matchAll(/<button(?=[\s>])/g)) {
      const tag = src.slice(m.index, tagEnd(src, m.index));
      const hasType = /\btype\s*=/.test(tag);
      const submit = /\btype\s*=\s*["']submit["']/.test(tag);
      const handler = /\bon[A-Z]\w*\s*=/.test(tag) || /\{\s*\.\.\./.test(tag);
      if (!hasType) add('button', m.index, '<button> has no type');
      else if (!submit && !handler) add('button', m.index, '<button> has no handler and is not type="submit"');
    }
  }
  return found;
}

export function scanRoot(root) {
  const found = [];
  for (const target of SCANNED) {
    for (const f of files(path.join(root, target))) {
      found.push(...scanSource(path.relative(root, f), fs.readFileSync(f, 'utf8')));
    }
  }
  return found;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--root');
  const root = i > -1 ? path.resolve(process.argv[i + 1]) : path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const found = scanRoot(root);
  if (found.length) {
    console.error(found.join('\n'));
    console.error(`check-static: ${found.length} finding(s)`);
    process.exit(1);
  }
  console.log(`check-static: clean (${SCANNED.length} scanned paths)`);
}
