import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const css = fs.readFileSync(path.join(__dirname, '../../styles/connections.css'), 'utf8');

describe('Connections link buttons (M9 QA)', () => {
  it('a primary link button keeps its on-pine text, so "Open Checkout forms" is readable in light mode', () => {
    // `.v2 .cx a.btn{color:var(--ink)}` is more specific than `a.btn.pri`; without this rule the label is dark text on a dark green button
    expect(css).toMatch(/\.v2 \.cx a\.btn\.pri\{[^}]*color:var\(--on-pine\)/);
    // The hover rule for plain link buttons must not turn the primary one into pale text on a pale fill
    expect(css).toMatch(/\.v2 \.cx a\.btn\.pri:hover\{[^}]*background:var\(--pine\)/);
  });
});
