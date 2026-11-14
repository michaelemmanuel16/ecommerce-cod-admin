/**
 * M9-T09 data move: old SMS templates, old email templates and the settings `notificationTemplates` text become
 * MessageTemplate rows. Safe to run again (nothing moves twice, nothing is deleted).
 * Run once after `prisma migrate deploy`: npm run migrate:templates
 */
import { prismaBase } from '../src/utils/prisma';
import { migrateLegacyTemplates } from '../src/services/messaging/templateMigration';

migrateLegacyTemplates()
  .then((r) => console.log('Templates moved:', JSON.stringify(r)))
  .catch((err) => { console.error('Template move failed:', err); process.exitCode = 1; })
  .finally(() => prismaBase.$disconnect());
