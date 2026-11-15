/**
 * M9-T48 (COD-85): no workflow code writes an order by hand. Every order change a workflow makes goes through
 * transitionOrder (status) or setOrderPriorityAndNotes (priority, notes), so the state machine, history and
 * side effects always run. This scans the source (not __tests__) of every file with "workflow" in its path,
 * for `order.update(`, `order.updateMany(`, `order.upsert(`, `order.delete(` and raw `UPDATE orders` SQL.
 * It widens the M2-T16 check in statusWriters.test.ts, which names three files and only matches `prisma.order.update`.
 *
 * Limits: a text scan. It does not follow a client passed through a variable with another name for `order`.
 */
import { describe, it, expect } from '@jest/globals';
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '../..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

const RAW_ORDER_WRITE = /\border\.(update|updateMany|upsert|delete|deleteMany)\s*\(|\bUPDATE\s+"?orders"?\s+SET\b|\bDELETE\s+FROM\s+"?orders"?\b/i;

const workflowFiles = sourceFiles(SRC)
  .map((f) => [path.relative(SRC, f), fs.readFileSync(f, 'utf8')] as const)
  .filter(([rel]) => /workflow/i.test(rel));

describe('workflow code never writes an order directly (M9-T48)', () => {
  it('finds the workflow action files (the scan is not empty)', () => {
    const names = workflowFiles.map(([rel]) => rel);
    for (const expected of ['services/workflowActions.ts', 'services/workflowAssignTo.ts', 'queues/workflowQueue.ts', 'services/workflowService.ts']) {
      expect(names).toContain(expected);
    }
  });

  it('no workflow file calls order.update, updateMany, upsert or delete, or writes SQL on orders', () => {
    const offenders = workflowFiles.filter(([, text]) => RAW_ORDER_WRITE.test(text)).map(([rel]) => rel);
    expect(offenders).toEqual([]);
  });

  it('the status action goes through the state machine', () => {
    const actions = workflowFiles.find(([rel]) => rel === 'services/workflowActions.ts')![1];
    expect(actions).toMatch(/transitionOrder\(/);
    expect(actions).toMatch(/setOrderPriorityAndNotes\(/);
  });

  it('the scanner sees a write (self-check)', () => {
    expect(RAW_ORDER_WRITE.test('await prisma.order.update({ where: { id } })')).toBe(true);
    expect(RAW_ORDER_WRITE.test('await tx.order.updateMany({ where: {} })')).toBe(true);
    expect(RAW_ORDER_WRITE.test('await prismaBase.order.upsert({})')).toBe(true);
    expect(RAW_ORDER_WRITE.test('await tx.$executeRaw`UPDATE orders SET notes = 1`')).toBe(true);
    expect(RAW_ORDER_WRITE.test('await prisma.order.findUnique({ where: { id } })')).toBe(false);
    expect(RAW_ORDER_WRITE.test('await prisma.workflowExecution.update({ where: { id } })')).toBe(false);
  });
});
