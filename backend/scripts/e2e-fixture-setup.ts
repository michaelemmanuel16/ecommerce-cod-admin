import fs from 'fs';
import path from 'path';
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import { uploadDir } from '../src/config/multer';

// M4-T30 to T33. Makes the fixture tenant (`npm run seed:fixture`) usable by the Playwright spec e2e/m4-deliveries.spec.ts.
// The fixture users have `password: 'x'`, which is not a hash, so nobody can sign in. This script
//   1. sets a real bcrypt password on the fixture admin (fixture-admin@fixture-numbers.test), and
//   2. gives one delivered order of Kofi Appiah a delivery proof with a photo (the fixture has no deliveries), and
//   3. makes Logiswift and Kasapa Express companies (3PLs) and gives the five partners a profile (base town, days to pay,
//      data source, trial flag). The fixture makes every partner a person and writes no profile, so the Deliveries tabs
//      would read 5 / 5 / 0 instead of 5 / 3 / 2.
// It never edits the fixture itself and can run again (same result).
// Refuses unless DATABASE_URL is a local database whose name contains `_test_`, and when NODE_ENV=production.
// `--undo` removes the rows this script added (deliveries and partner profiles of the fixture tenant). The fixture re-seed and the
// integration suites that seed it cannot delete a tenant while those rows exist, so run `--undo` before them on the same database.
// Run: npm run e2e:fixture-setup [-- --undo]

export const FIXTURE_SLUG = 'fixture-numbers';
export const FIXTURE_ADMIN_EMAIL = 'fixture-admin@fixture-numbers.test';
export const FIXTURE_PASSWORD = 'password123';

/** Partner profiles of docs/mockups/v2/NUMBERS.md (days to pay) and deliveries.html (towns, trial, data source). */
const PROFILES = [
  { first: 'Logiswift', kind: 'company' as const, baseTown: 'Accra', daysToPay: 9, dataSource: 'csv' as const, isTrial: false },
  { first: 'Kasapa', kind: 'company' as const, baseTown: 'Cape Coast', daysToPay: 7, dataSource: 'csv' as const, isTrial: true },
  { first: 'Kofi', kind: 'person' as const, baseTown: 'Kumasi', daysToPay: 2, dataSource: 'app' as const, isTrial: false },
  { first: 'Esi', kind: 'person' as const, baseTown: 'Accra', daysToPay: 2, dataSource: 'app' as const, isTrial: false },
  { first: 'Kwesi', kind: 'person' as const, baseTown: 'Takoradi', daysToPay: 3, dataSource: 'app' as const, isTrial: false },
];
const PHOTO_FILE = 'e2e-proof.png';
// A 1x1 green PNG
const PHOTO = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==', 'base64');

/** Returns the reason the run must stop, or null when the database is a local test database. */
export function refusal(databaseUrl: string | undefined, nodeEnv: string | undefined): string | null {
  if (nodeEnv === 'production') return 'NODE_ENV is production';
  if (!databaseUrl) return 'DATABASE_URL is not set';
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return 'DATABASE_URL is not a valid URL';
  }
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname)) return `the database host "${url.hostname}" is not local`;
  const name = url.pathname.replace(/^\//, '');
  if (!name.includes('_test_')) return `the database "${name}" is not a test database (its name has no "_test_")`;
  return null;
}

async function main() {
  const why = refusal(process.env.DATABASE_URL, process.env.NODE_ENV);
  if (why) {
    console.error(`Refusing to run: ${why}.`);
    process.exitCode = 1;
    return;
  }

  const prisma = new PrismaClient();
  try {
    const tenant = await prisma.tenant.findUnique({ where: { slug: FIXTURE_SLUG }, select: { id: true } });
    if (!tenant) throw new Error(`Tenant ${FIXTURE_SLUG} not found. Run npm run seed:fixture first.`);

    if (process.argv.includes('--undo')) {
      const deliveries = await prisma.delivery.deleteMany({ where: { tenantId: tenant.id } });
      const profiles = await prisma.deliveryPartnerProfile.deleteMany({ where: { tenantId: tenant.id } });
      // m4-inventory.spec.ts allocates stock to agents, which leaves inbox notifications that block the fixture re-seed
      const notifications = await prisma.notification.deleteMany({ where: { tenantId: tenant.id } });
      console.log(`Removed ${deliveries.count} deliveries, ${profiles.count} partner profiles and ${notifications.count} notifications of ${FIXTURE_SLUG}.`);
      return;
    }

    const hash = await bcrypt.hash(FIXTURE_PASSWORD, 10);
    const admin = await prisma.user.updateMany({ where: { tenantId: tenant.id, email: FIXTURE_ADMIN_EMAIL }, data: { password: hash } });
    if (admin.count !== 1) throw new Error(`Fixture admin ${FIXTURE_ADMIN_EMAIL} not found`);

    for (const p of PROFILES) {
      const user = await prisma.user.findFirst({ where: { tenantId: tenant.id, role: 'delivery_agent', firstName: p.first }, select: { id: true } });
      if (!user) throw new Error(`Partner ${p.first} not found in the fixture`);
      // The fixture names the 3PL "Logiswift 3PL"; the mockup says "Logiswift"
      await prisma.user.update({ where: { id: user.id }, data: { kind: p.kind, ...(p.first === 'Logiswift' ? { lastName: '' } : {}) } });
      const { first: _first, kind: _kind, ...profile } = p;
      await prisma.deliveryPartnerProfile.upsert({
        where: { userId: user.id },
        update: profile,
        create: { tenantId: tenant.id, userId: user.id, ...profile },
      });
    }

    const kofi = await prisma.user.findFirst({ where: { tenantId: tenant.id, role: 'delivery_agent', firstName: 'Kofi' }, select: { id: true } });
    if (!kofi) throw new Error('Kofi Appiah not found in the fixture');
    const order = await prisma.order.findFirst({
      where: { tenantId: tenant.id, deliveryAgentId: kofi.id, status: 'delivered' },
      orderBy: { createdAt: 'desc' }, // a recent one, so the first page of the drawer Orders tab holds it
      select: { id: true, deliveryDate: true },
    });
    if (!order) throw new Error('Kofi has no delivered order in the fixture');

    fs.mkdirSync(uploadDir, { recursive: true });
    fs.writeFileSync(path.join(uploadDir, PHOTO_FILE), PHOTO);
    const proof = {
      tenantId: tenant.id,
      agentId: kofi.id,
      actualDeliveryTime: order.deliveryDate ?? new Date(),
      proofType: 'photo' as const,
      proofImageUrl: `/uploads/${PHOTO_FILE}`,
      recipientName: 'Abena Owusu',
    };
    await prisma.delivery.upsert({ where: { orderId: order.id }, update: proof, create: { orderId: order.id, ...proof } });

    console.log(`Fixture admin can sign in as ${FIXTURE_ADMIN_EMAIL} / ${FIXTURE_PASSWORD}.`);
    console.log(`Order ${order.id} (Kofi Appiah) has a delivery proof with a photo.`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
