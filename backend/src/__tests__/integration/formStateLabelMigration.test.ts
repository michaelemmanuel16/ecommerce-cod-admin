/**
 * COD-36: the migration 20261023190000_form_state_label renames the stored "Region" and "Region/State" labels to "State"
 * and leaves every other label, and the order and keys of the fields, as they were. It runs the real migration file.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import prisma from '../../utils/prisma';
import { withoutTenant } from '../../utils/tenantContext';

const SQL = fs.readFileSync(path.join(__dirname, '../../../prisma/migrations/20261023190000_form_state_label/migration.sql'), 'utf8');
const unscoped = <T>(fn: () => Promise<T>) => withoutTenant('legacy fixture', fn);
const slugs = ['state-label-region', 'state-label-slash', 'state-label-county', 'state-label-empty'];
let productId: number;

const field = (id: string, label: string, extra: object = {}) => ({ id, label, type: 'state', required: true, enabled: true, standardKey: 'region', ...extra });
const seed = (slug: string, fields: object[]) =>
  prisma.checkoutForm.create({ data: { name: slug, slug, productId, fields: fields as never, styling: {}, regions: [] } });
const labelsOf = async (slug: string) =>
  ((await prisma.checkoutForm.findFirstOrThrow({ where: { slug } })).fields as Array<{ label: string }>).map((f) => f.label);

const clean = () => unscoped(async () => {
  await prisma.checkoutForm.deleteMany({ where: { slug: { in: slugs } } });
});

beforeAll(() => unscoped(async () => {
  await clean();
  productId = (await prisma.product.create({ data: { name: 'State label product', sku: `state-label-${Date.now()}`, category: 'test', price: 10, stockQuantity: 1 } })).id;
}));

afterAll(() => unscoped(async () => {
  await clean();
  await prisma.product.deleteMany({ where: { id: productId } });
}));

describe('form_state_label migration', () => {
  it('renames Region and Region/State (any case, spaces ignored); keeps County and other labels, order and keys', () => unscoped(async () => {
    await seed('state-label-region', [{ id: 'n', label: 'Full Name', type: 'text', standardKey: 'fullName' }, field('r', '  REGION ')]);
    await seed('state-label-slash', [field('r', 'Region / State')]);
    await seed('state-label-county', [field('r', 'County'), field('x', 'Region of birth', { standardKey: 'custom', type: 'text' })]);
    await seed('state-label-empty', []);

    await prisma.$executeRawUnsafe(SQL);

    expect(await labelsOf('state-label-region')).toEqual(['Full Name', 'State']);
    expect(await labelsOf('state-label-slash')).toEqual(['State']);
    expect(await labelsOf('state-label-county')).toEqual(['County', 'Region of birth']);
    expect(await labelsOf('state-label-empty')).toEqual([]);
    const kept = (await prisma.checkoutForm.findFirstOrThrow({ where: { slug: 'state-label-region' } })).fields as Array<Record<string, unknown>>;
    expect(kept[1]).toEqual({ id: 'r', label: 'State', type: 'state', required: true, enabled: true, standardKey: 'region' });

    // running it again changes nothing
    await prisma.$executeRawUnsafe(SQL);
    expect(await labelsOf('state-label-region')).toEqual(['Full Name', 'State']);
  }));
});
