import { prismaBase } from '../../../utils/prisma';
import { runInTenant } from '../../../utils/tenantContext';
import glService from '../../../services/glService';

/**
 * One balanced journal entry written through the GL service, dated at noon UTC of `date` (YYYY-MM-DD). Lines are
 * [account code, debit, credit]. `who` is the user the entry is booked by. Defaults to a hand-made (manual) entry.
 */
export async function postEntry(
  tenantId: string,
  who: number,
  date: string,
  lines: Array<[string, number, number]>,
  sourceType: Parameters<typeof glService.createJournalEntry>[0]['sourceType'] = 'manual',
  sourceId?: number,
) {
  const accounts = await prismaBase.account.findMany({ where: { tenantId, code: { in: lines.map((l) => l[0]) } } });
  const id = (code: string) => accounts.find((x) => x.code === code)!.id;
  await runInTenant(tenantId, () => glService.createJournalEntry({
    entryDate: `${date}T12:00:00.000Z`, description: `test ${date}`, sourceType, sourceId,
    transactions: lines.map(([code, d, c]) => ({ accountId: id(code), debitAmount: d, creditAmount: c })),
  }, { id: who, role: 'super_admin' }));
}
