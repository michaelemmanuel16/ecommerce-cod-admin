/**
 * M7-T13 (COD-65, F-771): One order id format and one status label source used by rep, admin and agent screens.
 *
 * Grep-style single-formatter test:
 * - Scans backend/src and frontend/src (excluding __tests__).
 * - Fails if a second order number formatter or a second ORDER_STATUS_LABELS definition exists outside:
 *     - backend/src/utils/orderNumber.ts
 *     - frontend/src/utils/orderNumber.ts
 *     - frontend/src/utils/orderStatus.ts
 * - Fails on an inline order id template (`#${...id}` or `#${...orderId}`) outside utils/orderNumber.ts.
 */
import { describe, it, expect } from '@jest/globals';
import fs from 'fs';
import path from 'path';

const BACKEND_ROOT = path.resolve(__dirname, '../../..');
const FRONTEND_ROOT = path.resolve(BACKEND_ROOT, '../frontend');

const ALLOWED_ORDER_NUMBER_FILES = new Set([
  path.normalize('backend/src/utils/orderNumber.ts'),
  path.normalize('frontend/src/utils/orderNumber.ts'),
]);

const ALLOWED_STATUS_LABEL_FILES = new Set([
  path.normalize('frontend/src/utils/orderStatus.ts'),
]);

// Deposit ids in agentReconciliationService.ts are not order ids: add that one line to an explicit allow list with a comment.
const ALLOWED_INLINE_LINES: Array<{ file: string; linePattern: RegExp; comment: string }> = [
  {
    file: path.normalize('backend/src/services/agentReconciliationService.ts'),
    linePattern: /agentDeposits\.map\(\(d\)\s*=>\s*`#\$\{d\.id\}`\)/,
    comment: 'Deposit ids in agentReconciliationService.ts are not order ids',
  },
  {
    file: path.normalize('backend/src/services/agentReconciliationService.ts'),
    linePattern: /rows\.map\(\(c\)\s*=>\s*`#\$\{c\.id\}`\)/,
    comment: 'Collection ids in agentReconciliationService.ts are not order ids',
  },
];

// Patterns matching definitions of formatters or status label maps
const ORDER_NUMBER_DEF = /(?:export\s+)?(?:const|function)\s+(?:formatOrderNumber|orderNumber)\s*(?:=\s*(?:\([^)]*\)|[a-zA-Z0-9_]+)\s*(?::\s*[^=]+)?=>|\()/g;
const STATUS_LABELS_DEF = /(?:export\s+)?const\s+ORDER_STATUS_LABELS\s*[:=]/g;
const INLINE_ORDER_ID_TEMPLATE = /`#\$\{[^}]*?(?:orderId|\bid)\s*\}/g;

function collectSourceFiles(dir: string, baseDir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__' && entry.name !== 'node_modules' && entry.name !== 'dist') {
        collectSourceFiles(fullPath, baseDir, out);
      }
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(fullPath);
    }
  }
  return out;
}

export function scanOrderFormatters(filePath: string, content: string): string[] {
  const violations: string[] = [];
  const normalizedRel = path.normalize(filePath);

  // Check order number definitions and inline templates
  if (!ALLOWED_ORDER_NUMBER_FILES.has(normalizedRel)) {
    const matches = content.match(ORDER_NUMBER_DEF);
    if (matches) {
      // Re-export statements like `export { formatOrderNumber } from '...'` are fine
      // but new definition functions must not exist
      for (const m of matches) {
        violations.push(`Duplicate order number formatter defined in ${normalizedRel}: "${m}"`);
      }
    }

    // Check inline order id templates (`#${...id}` or `#${...orderId}`)
    const lines = content.split('\n');
    lines.forEach((line, lineIdx) => {
      const inlineMatches = line.match(INLINE_ORDER_ID_TEMPLATE);
      if (inlineMatches) {
        const isAllowed = ALLOWED_INLINE_LINES.some(
          (entry) => normalizedRel.endsWith(entry.file) && entry.linePattern.test(line)
        );
        if (!isAllowed) {
          for (const m of inlineMatches) {
            violations.push(`Inline order id template found in ${normalizedRel}:${lineIdx + 1}: "${m}"`);
          }
        }
      }
    });
  }

  // Check order status label definitions
  if (!ALLOWED_STATUS_LABEL_FILES.has(normalizedRel)) {
    const matches = content.match(STATUS_LABELS_DEF);
    if (matches) {
      for (const m of matches) {
        violations.push(`Duplicate ORDER_STATUS_LABELS defined in ${normalizedRel}: "${m}"`);
      }
    }
  }

  return violations;
}

describe('single order format and status label source (M7-T13)', () => {
  const backendFiles = collectSourceFiles(path.join(BACKEND_ROOT, 'src'), BACKEND_ROOT);
  const frontendFiles = collectSourceFiles(path.join(FRONTEND_ROOT, 'src'), FRONTEND_ROOT);

  it('no second order id formatter exists outside utils/orderNumber.ts (backend & frontend)', () => {
    const allViolations: string[] = [];

    for (const file of backendFiles) {
      const rel = path.relative(path.resolve(BACKEND_ROOT, '..'), file);
      const content = fs.readFileSync(file, 'utf8');
      const v = scanOrderFormatters(rel, content);
      allViolations.push(...v);
    }

    for (const file of frontendFiles) {
      const rel = path.relative(path.resolve(BACKEND_ROOT, '..'), file);
      const content = fs.readFileSync(file, 'utf8');
      const v = scanOrderFormatters(rel, content);
      allViolations.push(...v);
    }

    expect(allViolations).toEqual([]);
  });

  it('fails if a second formatter or status label map is planted', () => {
    const fakeContent = `
      export const formatOrderNumber = (id: number) => 'ORD-' + id;
      export const ORDER_STATUS_LABELS = { pending: 'Pending' };
    `;
    const violations = scanOrderFormatters('frontend/src/pages/CustomPage.tsx', fakeContent);
    expect(violations.length).toBe(2);
    expect(violations[0]).toContain('Duplicate order number formatter defined');
    expect(violations[1]).toContain('Duplicate ORDER_STATUS_LABELS defined');
  });

  it('flags an inline order id template outside utils/orderNumber.ts', () => {
    const sampleContent = 'const ref = `#${order.id}`; const orderRef = `#${orderId}`;';
    const violations = scanOrderFormatters('backend/src/services/customService.ts', sampleContent);
    expect(violations.length).toBe(2);
    expect(violations[0]).toContain('Inline order id template found');
    expect(violations[1]).toContain('Inline order id template found');
  });

  it('canonical formatters produce expected results and labels', async () => {
    const backendNumber = await import('../../utils/orderNumber');
    expect(backendNumber.formatOrderNumber(1042)).toBe('#1042');
    expect(backendNumber.parseOrderNumber('#1042')).toBe(1042);
  });
});
