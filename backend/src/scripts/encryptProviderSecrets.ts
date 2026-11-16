/**
 * One-time: encrypt the provider secrets already saved in plaintext (T51).
 *
 * Turning on PROVIDER_ENCRYPTION_KEY only encrypts values saved after that; old rows stay plaintext until
 * saved again. This walks every SystemConfig row and every provider type in SENSITIVE_FIELDS, runs
 * encryptProviderSecrets, and saves a row only when a value changed. Idempotent: a second run changes 0 rows.
 *
 * Dry run (default) prints counts per provider type, never values. --apply writes.
 * Exits with an error when PROVIDER_ENCRYPTION_KEY is not set.
 * Run: npx ts-node src/scripts/encryptProviderSecrets.ts [--apply]
 */
import prisma from '../utils/prisma';
import { withoutTenant } from '../utils/tenantContext';
import { SENSITIVE_FIELDS, encryptProviderSecrets } from '../utils/providerCrypto';

export async function encryptAll(apply: boolean): Promise<{ counts: Record<string, number>; rows: number }> {
  if (!process.env.PROVIDER_ENCRYPTION_KEY) {
    throw new Error('PROVIDER_ENCRYPTION_KEY is not set. Nothing was changed.');
  }

  const counts: Record<string, number> = {};
  for (const type of Object.keys(SENSITIVE_FIELDS)) counts[type] = 0;
  let rows = 0;

  await withoutTenant('encrypt-provider-secrets', async () => {
    const configs = await prisma.systemConfig.findMany();
    for (const config of configs) {
      const data: Record<string, unknown> = {};
      for (const type of Object.keys(SENSITIVE_FIELDS)) {
        const current = (config as any)[type];
        if (!current) continue;
        const next = encryptProviderSecrets(type, current);
        if (JSON.stringify(next) !== JSON.stringify(current)) {
          data[type] = next;
          counts[type] += 1;
        }
      }
      if (Object.keys(data).length === 0) continue;
      rows += 1;
      if (apply) await prisma.systemConfig.update({ where: { id: config.id }, data: data as any });
    }
  });

  return { counts, rows };
}

async function main(): Promise<void> {
  const apply = process.argv.slice(2).includes('--apply');
  const { counts, rows } = await encryptAll(apply);
  console.log(apply ? 'APPLY: writing changes.' : 'DRY RUN: nothing is written. Pass --apply to write.');
  for (const [type, n] of Object.entries(counts)) {
    console.log(`  ${type}: ${n} row(s) ${apply ? 'encrypted' : 'would be encrypted'}`);
  }
  console.log(`Total: ${rows} config row(s) ${apply ? 'updated' : 'would be updated'}.`);
  await prisma.$disconnect();
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Encrypt failed:', err.message ?? err);
    process.exitCode = 1;
  });
}
