import { describe, it, expect, beforeAll, beforeEach, afterAll } from '@jest/globals';
import prisma from '../../utils/prisma';

// R1 (eng review E4/E7) — verify the backfill from styling to design.
//
// Source of truth: backend/prisma/migrations/20260605140000_add_checkout_form_design/migration.sql
// If you change the backfill SQL in the migration, update this test too — the
// test will fail until the SQL here matches the migration, by design.
const BACKFILL_SQL = `
UPDATE "checkout_forms"
SET "design" = jsonb_build_object(
  'colors', jsonb_strip_nulls(jsonb_build_object(
    'cta', NULLIF(styling->>'buttonColor', ''),
    'surface', NULLIF(styling->>'accentColor', '')
  ))
)
WHERE "design" IS NULL
  AND (
    NULLIF(styling->>'buttonColor', '') IS NOT NULL
    OR NULLIF(styling->>'accentColor', '') IS NOT NULL
  );
`;

describe('CheckoutForm design backfill migration', () => {
  let productId: number;
  const seededSlugs = [
    'r1-full-styling',
    'r1-only-button',
    'r1-only-accent',
    'r1-empty-styling',
    'r1-non-palette-hex',
  ];

  beforeAll(async () => {
    const product = await prisma.product.create({
      data: {
        name: 'R1 Test Product',
        sku: `r1-test-${Date.now()}`,
        category: 'test',
        price: 100,
        stockQuantity: 10,
      },
    });
    productId = product.id;
  });

  beforeEach(async () => {
    await prisma.formSubmission.deleteMany({ where: { form: { slug: { in: seededSlugs } } } });
    await prisma.formPackage.deleteMany({ where: { form: { slug: { in: seededSlugs } } } });
    await prisma.formUpsell.deleteMany({ where: { form: { slug: { in: seededSlugs } } } });
    await prisma.checkoutForm.deleteMany({ where: { slug: { in: seededSlugs } } });
  });

  afterAll(async () => {
    await prisma.formSubmission.deleteMany({ where: { form: { slug: { in: seededSlugs } } } });
    await prisma.formPackage.deleteMany({ where: { form: { slug: { in: seededSlugs } } } });
    await prisma.formUpsell.deleteMany({ where: { form: { slug: { in: seededSlugs } } } });
    await prisma.checkoutForm.deleteMany({ where: { slug: { in: seededSlugs } } });
    await prisma.product.deleteMany({ where: { id: productId } });
  });

  const seed = async (slug: string, styling: object): Promise<number> => {
    const form = await prisma.checkoutForm.create({
      data: {
        name: slug,
        slug,
        productId,
        fields: [],
        styling,
        regions: [],
      },
    });
    return form.id;
  };

  it('backfills design.colors from full styling and leaves styling unchanged', async () => {
    const id = await seed('r1-full-styling', {
      buttonColor: '#0f172a',
      accentColor: '#dc2626',
    });

    await prisma.$executeRawUnsafe(BACKFILL_SQL);

    const form = await prisma.checkoutForm.findUniqueOrThrow({ where: { id } });
    expect(form.design).toEqual({
      colors: { cta: '#0f172a', surface: '#dc2626' },
    });
    expect(form.styling).toEqual({
      buttonColor: '#0f172a',
      accentColor: '#dc2626',
    });
  });

  it('backfills only cta when only buttonColor is present', async () => {
    const id = await seed('r1-only-button', { buttonColor: '#4f46e5' });

    await prisma.$executeRawUnsafe(BACKFILL_SQL);

    const form = await prisma.checkoutForm.findUniqueOrThrow({ where: { id } });
    expect(form.design).toEqual({ colors: { cta: '#4f46e5' } });
  });

  it('backfills only surface when only accentColor is present', async () => {
    const id = await seed('r1-only-accent', { accentColor: '#059669' });

    await prisma.$executeRawUnsafe(BACKFILL_SQL);

    const form = await prisma.checkoutForm.findUniqueOrThrow({ where: { id } });
    expect(form.design).toEqual({ colors: { surface: '#059669' } });
  });

  it('leaves design NULL when styling has no color values', async () => {
    const id = await seed('r1-empty-styling', { showName: true, showDescription: false });

    await prisma.$executeRawUnsafe(BACKFILL_SQL);

    const form = await prisma.checkoutForm.findUniqueOrThrow({ where: { id } });
    expect(form.design).toBeNull();
  });

  it('copies non-palette hex as-is (Zod normalizes on next save)', async () => {
    const id = await seed('r1-non-palette-hex', {
      buttonColor: '#abcdef',
      accentColor: '#123456',
    });

    await prisma.$executeRawUnsafe(BACKFILL_SQL);

    const form = await prisma.checkoutForm.findUniqueOrThrow({ where: { id } });
    expect(form.design).toEqual({
      colors: { cta: '#abcdef', surface: '#123456' },
    });
  });

  it('is idempotent — re-running the backfill does not change populated design rows', async () => {
    const id = await seed('r1-full-styling', {
      buttonColor: '#0f172a',
      accentColor: '#dc2626',
    });

    await prisma.$executeRawUnsafe(BACKFILL_SQL);
    const firstPass = await prisma.checkoutForm.findUniqueOrThrow({ where: { id } });

    // Mutate design separately to verify the WHERE clause keeps re-runs from clobbering it
    await prisma.checkoutForm.update({
      where: { id },
      data: { design: { colors: { cta: '#000000' } } },
    });

    await prisma.$executeRawUnsafe(BACKFILL_SQL);
    const secondPass = await prisma.checkoutForm.findUniqueOrThrow({ where: { id } });

    expect(secondPass.design).toEqual({ colors: { cta: '#000000' } });
    expect(firstPass.design).not.toEqual(secondPass.design);
  });
});
