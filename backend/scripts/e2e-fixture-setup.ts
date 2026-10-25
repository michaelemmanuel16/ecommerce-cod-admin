import fs from 'fs';
import path from 'path';
import bcrypt from 'bcrypt';
import { Prisma, PrismaClient } from '@prisma/client';
import { uploadDir } from '../src/config/multer';

// M4-T30 to T33. Makes the fixture tenant (`npm run seed:fixture`) usable by the Playwright spec e2e/m4-deliveries.spec.ts.
// The fixture users have `password: 'x'`, which is not a hash, so nobody can sign in. This script
//   1. sets a real bcrypt password on the fixture admin (fixture-admin@fixture-numbers.test), and
//   2. gives one delivered order of Kofi Appiah a delivery proof with a photo (the fixture has no deliveries), and
//   3. gives the disputed Logiswift return a destination (an own store, which the fixture does not set up), so Resolve finds it, and
//      gives the admin role `orders:force_status` for the tenant (m3-owner-flow moves an order outside the normal flow), and
//   4. makes Logiswift and Kasapa Express companies (3PLs) and gives the five partners a profile (base town, days to pay,
//      data source, trial flag). The fixture makes every partner a person (the default kind) and writes no profile, so the
//      Deliveries tabs would read 5 / 5 / 0 instead of 5 / 3 / 2. The data source is set only for the two 3PLs (csv); the column
//      default `app` already fits the agents.
// It patches the seeded rows and never edits the fixture seed code; it can run again (same result).
// Refuses unless DATABASE_URL is a local database whose name contains `_test_`, and when NODE_ENV=production.
// `--undo` removes the rows this script and the specs added (deliveries, partner profiles, notifications and checkout forms with their submissions of the fixture tenant). The fixture re-seed and the
// integration suites that seed it cannot delete a tenant while those rows exist, so run `--undo` before them on the same database.
// Run: npm run e2e:fixture-setup [-- --undo]

export const FIXTURE_SLUG = 'fixture-numbers';
export const FIXTURE_ADMIN_EMAIL = 'fixture-admin@fixture-numbers.test';
export const FIXTURE_PASSWORD = 'password123';
const RETURN_STORE = 'Main store';
// The admin role's default orders permissions plus force_status. The stored role replaces the default per resource, so the whole list goes in.
const ADMIN_ORDERS = ['create', 'view', 'update', 'delete', 'bulk_import', 'assign', 'update_status', 'force_status'];

/** Partner profiles of docs/mockups/v2/NUMBERS.md (days to pay) and deliveries.html (towns, trial, data source). */
const PROFILES = [
  { first: 'Logiswift', kind: 'company' as const, baseTown: 'Accra', daysToPay: 9, dataSource: 'csv' as const, isTrial: false },
  { first: 'Kasapa', kind: 'company' as const, baseTown: 'Cape Coast', daysToPay: 7, dataSource: 'csv' as const, isTrial: true },
  { first: 'Kofi', kind: 'person' as const, baseTown: 'Kumasi', daysToPay: 2, isTrial: false },
  { first: 'Esi', kind: 'person' as const, baseTown: 'Accra', daysToPay: 2, isTrial: false },
  { first: 'Kwesi', kind: 'person' as const, baseTown: 'Takoradi', daysToPay: 3, isTrial: false },
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

/**
 * Removes the rows the setup and the Playwright specs add to the fixture tenant. Every delete is scoped by the tenant id.
 * m4-flows.spec.ts (public order) leaves a checkout form, a submission and a pending checkout, none of which the fixture seeds.
 * FK order: submissions and pending checkouts first (the submission points at the form), then the form packages and upsells
 * (no tenant column, scoped through their form), then the forms. The public order itself is not deleted here: the fixture re-seed
 * removes the tenant's orders, and the submission that pointed at it is gone by then.
 */
export async function undoFixtureRows(prisma: PrismaClient, tenantId: string): Promise<string> {
  const deliveries = await prisma.delivery.deleteMany({ where: { tenantId } });
  const profiles = await prisma.deliveryPartnerProfile.deleteMany({ where: { tenantId } });
  // m4-inventory.spec.ts allocates stock to agents, which leaves inbox notifications that block the fixture re-seed
  const notifications = await prisma.notification.deleteMany({ where: { tenantId } });
  const submissions = await prisma.formSubmission.deleteMany({ where: { tenantId } });
  const pending = await prisma.pendingCheckout.deleteMany({ where: { tenantId } });
  const packages = await prisma.formPackage.deleteMany({ where: { form: { tenantId } } });
  const upsells = await prisma.formUpsell.deleteMany({ where: { form: { tenantId } } });
  const forms = await prisma.checkoutForm.deleteMany({ where: { tenantId } });
  return `Removed ${deliveries.count} deliveries, ${profiles.count} partner profiles, ${notifications.count} notifications, ${submissions.count} form submissions, ${pending.count} pending checkouts, ${packages.count} packages, ${upsells.count} upsells and ${forms.count} checkout forms of ${FIXTURE_SLUG}.`;
}

/**
 * The app creates a return toward an own store (F-652), but the fixture seeds none, so its disputed return has no destination and
 * Resolve fails "Transfer not found". Sets up the store and points that return at it; grants the admin role orders:force_status.
 */
export async function giveFixtureReturnDestination(prisma: PrismaClient, tenantId: string): Promise<string> {
  const store = (await prisma.stockLocation.findFirst({ where: { tenantId, type: 'own_store' } }))
    ?? (await prisma.stockLocation.create({ data: { tenantId, type: 'own_store', name: RETURN_STORE, address: 'Accra' } }));
  const returns = await prisma.inventoryTransfer.updateMany({
    where: { tenantId, transferType: 'return_to_warehouse', status: 'disputed', toLocationId: null },
    data: { toLocationId: store.id },
  });
  const config = await prisma.systemConfig.findFirst({ where: { tenantId } });
  const stored = (config?.rolePermissions ?? {}) as Record<string, Record<string, string[]>>;
  const rolePermissions = { ...stored, admin: { ...stored.admin, orders: ADMIN_ORDERS } };
  if (config) await prisma.systemConfig.update({ where: { id: config.id }, data: { rolePermissions } });
  else await prisma.systemConfig.create({ data: { tenantId, rolePermissions } });
  return `${returns.count} disputed return(s) now go to ${store.name}; admin has orders:force_status.`;
}

/** Reverses giveFixtureReturnDestination: the return loses the store this script made, and the stored role permissions go. */
export async function undoFixtureReturnDestination(prisma: PrismaClient, tenantId: string): Promise<void> {
  const store = await prisma.stockLocation.findFirst({ where: { tenantId, type: 'own_store', name: RETURN_STORE } });
  if (store) {
    await prisma.inventoryTransfer.updateMany({ where: { tenantId, toLocationId: store.id, transferType: 'return_to_warehouse', status: 'disputed' }, data: { toLocationId: null } });
    await prisma.stockLocation.deleteMany({ where: { tenantId, id: store.id } });
  }
  await prisma.systemConfig.updateMany({ where: { tenantId }, data: { rolePermissions: Prisma.DbNull } });
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
      await undoFixtureReturnDestination(prisma, tenant.id);
      console.log(await undoFixtureRows(prisma, tenant.id));
      return;
    }

    const hash = await bcrypt.hash(FIXTURE_PASSWORD, 10);
    const admin = await prisma.user.updateMany({ where: { tenantId: tenant.id, email: FIXTURE_ADMIN_EMAIL }, data: { password: hash } });
    if (admin.count !== 1) throw new Error(`Fixture admin ${FIXTURE_ADMIN_EMAIL} not found`);

    for (const p of PROFILES) {
      const user = await prisma.user.findFirst({ where: { tenantId: tenant.id, role: 'delivery_agent', firstName: p.first }, select: { id: true } });
      if (!user) throw new Error(`Partner ${p.first} not found in the fixture`);
      await prisma.user.update({ where: { id: user.id }, data: { kind: p.kind } });
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

    console.log(await giveFixtureReturnDestination(prisma, tenant.id));
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
