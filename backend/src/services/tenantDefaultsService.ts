import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { tenantStorage } from '../utils/tenantContext';
import { DEFAULT_GL_ACCOUNTS } from '../config/glAccounts';
import { seedDefaultEmailTemplates } from './emailTemplateService';

/**
 * Create what a tenant is missing: the chart of accounts and the default email
 * templates. Idempotent: re-running never creates duplicates (unique
 * `(tenantId, code)` on accounts and `(name, tenantId)` on email templates).
 * Runs inside the tenant context so the Prisma extension stamps the tenantId.
 *
 * SMS templates are not seeded: no default SMS content exists in the code.
 */
export async function seedTenantDefaults(tenantId: string): Promise<{ accounts: number; emailTemplates: number }> {
  const accounts = await tenantStorage.run({ tenantId }, async () => {
    const result = await prisma.account.createMany({
      data: DEFAULT_GL_ACCOUNTS.map((a) => ({
        code: a.code,
        name: a.name,
        accountType: a.accountType,
        normalBalance: a.normalBalance,
        description: `Default account: ${a.name}`,
        isActive: true,
      })),
      skipDuplicates: true,
    });
    return result.count;
  });
  const emailTemplates = await seedDefaultEmailTemplates(tenantId);
  if (accounts > 0 || emailTemplates > 0) {
    logger.info(`Seeded tenant defaults for ${tenantId}: ${accounts} accounts, ${emailTemplates} email templates`);
  }
  return { accounts, emailTemplates };
}
