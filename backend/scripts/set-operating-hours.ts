import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import { assertNotProduction, hasFlag, option } from './lib/scriptArgs';
import { parseOperatingHours, OperatingHours } from '../src/services/kpi/workingTime';

// M1-T22 (COD-12). Sets SystemConfig.operatingHours for one tenant, before the Operations tab exists (M7).
// The time-to-first-call clock (F-755) counts only minutes inside these hours; with none set it counts every minute.
// Usage: ts-node scripts/set-operating-hours.ts --tenant <id> [--hours-file hours.json] [--apply]
// Default hours (NUMBERS.md): Mon to Fri 08:00 to 20:00, Sat 09:00 to 18:00, Sun off; target 15 min, alert 30 min.
// --hours-file is JSON in the stored shape (see services/kpi/workingTime.ts). The shape is validated before any write.
// Dry run by default (prints what it would write); pass --apply to write. Refuses NODE_ENV=production unless --allow-production.
// Plain PrismaClient on purpose: the tenant comes from --tenant, not from a request.
const prisma = new PrismaClient();

const weekday = { open: '08:00', close: '20:00', enabled: true };
const DEFAULT_HOURS: OperatingHours = {
  days: {
    monday: weekday, tuesday: weekday, wednesday: weekday, thursday: weekday, friday: weekday,
    saturday: { open: '09:00', close: '18:00', enabled: true },
    sunday: { open: '10:00', close: '16:00', enabled: false },
  },
  firstCallTargetMinutes: 15,
  queueWaitAlertMinutes: 30,
};

async function main() {
  if (!assertNotProduction()) return;
  const tenantId = option('--tenant');
  if (!tenantId) {
    console.error('Pass --tenant <id>. Usage: ts-node scripts/set-operating-hours.ts --tenant <id> [--hours-file hours.json] [--apply]');
    process.exitCode = 1;
    return;
  }
  const file = option('--hours-file');
  let hours: OperatingHours;
  try {
    hours = parseOperatingHours(file ? JSON.parse(fs.readFileSync(file, 'utf8')) : DEFAULT_HOURS);
  } catch (error) {
    console.error(`Invalid operating hours: ${(error as Error).message}`);
    process.exitCode = 1;
    return;
  }

  const dryRun = !hasFlag('--apply');
  console.log(dryRun ? 'MODE: dry run (no writes; pass --apply to write)' : 'MODE: apply (writes)');
  const config = await prisma.systemConfig.findUnique({ where: { tenantId } });
  if (!config) {
    console.error(`No SystemConfig row for tenant ${tenantId}.`);
    process.exitCode = 1;
    return;
  }
  console.log('Current:', JSON.stringify(config.operatingHours));
  console.log('New:    ', JSON.stringify(hours));
  if (dryRun) return;
  await prisma.systemConfig.update({ where: { id: config.id }, data: { operatingHours: hours as object } });
  console.log('Written.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
