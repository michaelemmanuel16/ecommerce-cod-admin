// Reads the two token blocks of src/styles/tokens.css: `:root{...}` (light) and `[data-theme="dark"]{...}` (dark).
import fs from 'node:fs';

/** Body of the first rule whose selector is exactly `selector`, or null. Comments are removed first. */
function block(css, selector) {
  const re = new RegExp(`(?:^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`);
  const m = css.replace(/\/\*[\s\S]*?\*\//g, '').match(re);
  return m ? m[1] : null;
}

/** { '--pine': '#0F5C55', ... } from a declaration list. Values may contain commas and parentheses. */
function declarations(body) {
  const out = {};
  for (const m of (body ?? '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

export function readTokens(file) {
  const css = fs.readFileSync(file, 'utf8');
  return { light: declarations(block(css, ':root')), dark: declarations(block(css, '[data-theme="dark"]')) };
}
