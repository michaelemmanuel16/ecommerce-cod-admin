import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const css = fs.readFileSync(path.join(__dirname, '../../styles/workflows.css'), 'utf8');

describe('Workflows list table (M9 QA)', () => {
  it('scrolls inside its card when the names are long, so the Run and Edit buttons stay reachable and the page does not scroll sideways', () => {
    // The rows are nowrap, so a long workflow name makes the table wider than the card at 1440 px
    expect(css).toMatch(/\.v2 \.wf \.tablewrap\{[^}]*overflow-x:auto/);
  });

  it('lets a long workflow name wrap, so the Run and Edit columns are not pushed out of view', () => {
    expect(css).toMatch(/\.v2 \.wf \.wfname a\{[^}]*white-space:normal/);
  });
});
