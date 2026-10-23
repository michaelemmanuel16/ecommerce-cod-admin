import { PrismaClient } from '@prisma/client';
import { assertNotProduction, hasFlag } from './lib/scriptArgs';
import { encryptString } from '../src/utils/providerCrypto';

// M3b-T04 (COD-31, F-400). Copies SystemConfig.paystackProvider (the old per-tenant Paystack JSON) into a
// PaymentConnection row (provider 'paystack') per tenant. The secret is stored with the same enc:v1: encryption.
// Idempotent: a tenant that already has a paystack connection is left alone, so a second run creates nothing.
// The old JSON is not changed or removed; the app reads the connection first and the JSON as the fallback.
// Usage: ts-node scripts/copy-paystack-to-payment-connections.ts [--dry-run]
//   --dry-run  prints the counts and writes nothing.
// Plain PrismaClient on purpose: no tenant extension, so every tenant is visible.
// Refuses to run when NODE_ENV=production unless --allow-production.
const prisma = new PrismaClient();
const dryRun = hasFlag('--dry-run');

async function main() {
  if (!assertNotProduction()) return;
  console.log(dryRun ? 'MODE: dry run (nothing is written)' : 'MODE: copy (writes)');

  const configs = await prisma.systemConfig.findMany({
    where: { NOT: { paystackProvider: { equals: null as never } } },
    select: { tenantId: true, paystackProvider: true },
  });

  const counts = { scanned: 0, created: 0, alreadyConnected: 0, skippedNoSecret: 0, skippedNoTenant: 0 };
  for (const config of configs) {
    counts.scanned++;
    const json = config.paystackProvider as { publicKey?: string; secretKey?: string; mode?: string; isEnabled?: boolean } | null;
    if (!config.tenantId) { counts.skippedNoTenant++; continue; }
    if (!json?.secretKey) { counts.skippedNoSecret++; continue; }

    const existing = await prisma.paymentConnection.findUnique({
      where: { tenantId_provider: { tenantId: config.tenantId, provider: 'paystack' } },
      select: { id: true },
    });
    if (existing) { counts.alreadyConnected++; continue; }

    if (!dryRun) {
      await prisma.paymentConnection.create({
        data: {
          tenantId: config.tenantId,
          provider: 'paystack',
          mode: json.mode === 'live' ? 'live' : 'test',
          publicKey: json.publicKey || null,
          secretKey: encryptString(json.secretKey) as string,
          isEnabled: json.isEnabled !== false,
        },
      });
    }
    counts.created++;
  }

  console.log(`${dryRun ? 'Would create' : 'Created'}: ${counts.created}`);
  console.log(`Scanned: ${counts.scanned}, already connected: ${counts.alreadyConnected}, no secret: ${counts.skippedNoSecret}, no tenant: ${counts.skippedNoTenant}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
