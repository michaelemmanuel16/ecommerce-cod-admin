import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// M7 renamed Reports' `.sw` and deleted the shared label-switch rules, so every <label class="sw"> lost its pill and
// settings.css's button-switch knob painted over it. These rules must stay in components.css, scoped to label.sw.
const read = (f: string) => readFileSync(join(process.cwd(), 'src/styles', f), 'utf8').replace(/\s+/g, '');
const css = read('components.css');
const has = (rule: string) => expect(css).toContain(rule.replace(/\s+/g, ''));

describe('label switch rules (components.css)', () => {
  it('draws the pill, the knob, and the checked state for label.sw', () => {
    has('.v2 label.sw .tg{');
    has('.v2 label.sw .tg::after{');
    has('.v2 label.sw input:checked+.tg{background:var(--pine)}');
    has('.v2 label.sw input:checked+.tg::after{transform:translateX(16px)}');
  });

  it('neutralises the button switch look for a label, so no grey dot paints over it', () => {
    has('.v2 label.sw{width:auto;height:auto;background:none;border-radius:0;');
    has('.v2 label.sw::after{content:none}');
  });

  it('keeps the button switch in settings.css', () => {
    expect(read('settings.css')).toContain('.v2.sw[aria-checked="true"]{background:var(--pine)}');
  });
});
