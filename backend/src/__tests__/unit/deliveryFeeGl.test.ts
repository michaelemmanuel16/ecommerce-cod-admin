/**
 * M5-T06 (COD-48): the delivery fee lines in GLAutomationService. Account ids are the account codes, so a line can be read by code.
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Decimal } from '@prisma/client/runtime/library';
import { GLAutomationService } from '../../services/glAutomationService';
import { GLAccountService } from '../../services/glAccountService';
import * as tenantContext from '../../utils/tenantContext';

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../services/glAccountService', () => ({ GLAccountService: { getAccountIdByCode: jest.fn() } }));

const makeTx = (existing: unknown = null): any => ({
  journalEntry: {
    findFirst: jest.fn().mockResolvedValue(existing),
    create: jest.fn().mockImplementation(async (args: any) => ({ id: 7, entryNumber: 'JE-7', ...args.data, transactions: [] })),
    update: jest.fn().mockResolvedValue({}),
  },
  account: {
    findUnique: jest.fn().mockResolvedValue({ normalBalance: 'debit', currentBalance: new Decimal(0) }),
    update: jest.fn().mockResolvedValue({}),
  },
  $queryRaw: jest.fn().mockResolvedValue([]),
});

/** debit and credit per account code of the entry the tx created */
const linesOf = (tx: any) =>
  tx.journalEntry.create.mock.calls[0][0].data.transactions.create.map((l: any) => ({
    code: String(l.accountId), debit: Number(l.debitAmount), credit: Number(l.creditAmount),
  }));

beforeEach(() => {
  jest.clearAllMocks();
  (GLAccountService.getAccountIdByCode as jest.Mock<any>).mockImplementation(async (code: any) => Number(code));
  jest.spyOn(tenantContext, 'getTenantId').mockReturnValue('tenant-a');
});

const order: any = {
  id: 1, tenantId: 'tenant-a', totalAmount: new Decimal(150), deliveryAgentId: 2,
  deliveryAgent: { id: 2, commissionAmount: new Decimal(40) },
  customerRep: null, orderItems: [],
};

describe('revenue entry', () => {
  it('debits 1015 with the full amount and ignores the agent commission on the profile', async () => {
    const tx = makeTx();
    await GLAutomationService.createRevenueRecognitionEntry(tx, order, new Decimal(0), 1);
    expect(linesOf(tx)).toEqual([
      { code: '1015', debit: 150, credit: 0 },
      { code: '4010', debit: 0, credit: 150 },
    ]);
  });
});

describe('createDeliveryFeeEntry', () => {
  it('posts DR 5070 CR 1015 keyed on outcome and history id', async () => {
    const tx = makeTx();
    const date = new Date('2026-10-10T12:00:00.000Z');
    await GLAutomationService.createDeliveryFeeEntry(tx, order, 'delivered', 25, 99, 1, date);
    expect(linesOf(tx)).toEqual([
      { code: '5070', debit: 25, credit: 0 },
      { code: '1015', debit: 0, credit: 25 },
    ]);
    const data = tx.journalEntry.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ sourceType: 'delivery_fee', sourceId: 1, externalRef: 'delivered:99', entryDate: date });
  });

  it('a fee of 0 posts nothing', async () => {
    const tx = makeTx();
    expect(await GLAutomationService.createDeliveryFeeEntry(tx, order, 'failed', 0, 99, 1)).toBeNull();
    expect(tx.journalEntry.create).not.toHaveBeenCalled();
  });

  it('a repeat of the same move returns the entry already posted', async () => {
    const existing = { id: 3, entryNumber: 'JE-3', transactions: [] };
    const tx = makeTx(existing);
    expect(await GLAutomationService.createDeliveryFeeEntry(tx, order, 'delivered', 25, 99, 1)).toBe(existing);
    expect(tx.journalEntry.create).not.toHaveBeenCalled();
  });
});

describe('return reversal', () => {
  const line = (code: string, debit: number, credit: number) => ({ debitAmount: new Decimal(debit), creditAmount: new Decimal(credit), account: { code } });

  it('an entry booked from M5 on reverses the full amount in 1015 and has no agent line', async () => {
    const tx = makeTx();
    const original: any = { id: 1, entryNumber: 'JE-1', transactions: [line('1015', 150, 0), line('4010', 0, 150)] };
    await GLAutomationService.createReturnReversalEntry(tx, order, original, 1);
    expect(linesOf(tx)).toEqual([
      { code: '1015', debit: 0, credit: 150 },
      { code: '4010', debit: 150, credit: 0 },
    ]);
  });

  it('an entry booked before M5 reverses what it booked, and the commission goes back to 5070 (nothing posts to 5040)', async () => {
    const tx = makeTx();
    const original: any = { id: 1, entryNumber: 'JE-1', transactions: [line('1015', 110, 0), line('5040', 40, 0), line('4010', 0, 150)] };
    await GLAutomationService.createReturnReversalEntry(tx, order, original, 1);
    expect(linesOf(tx)).toEqual([
      { code: '1015', debit: 0, credit: 110 },
      { code: '4010', debit: 150, credit: 0 },
      { code: '5070', debit: 0, credit: 40 },
    ]);
  });
});

describe('reverseDeliveredFee', () => {
  it('flips the original lines, links them and returns null when there is no active delivered fee', async () => {
    const original = {
      id: 5, entryNumber: 'JE-5',
      transactions: [
        { accountId: 5070, debitAmount: new Decimal(25), creditAmount: new Decimal(0), description: 'fee' },
        { accountId: 1015, debitAmount: new Decimal(0), creditAmount: new Decimal(25), description: 'net' },
      ],
    };
    const tx = makeTx(original);
    await GLAutomationService.reverseDeliveredFee(tx, order, 1);
    expect(linesOf(tx)).toEqual([
      { code: '5070', debit: 0, credit: 25 },
      { code: '1015', debit: 25, credit: 0 },
    ]);
    expect(tx.journalEntry.create.mock.calls[0][0].data.externalRef).toBe('reversal:5');
    expect(tx.journalEntry.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { reversingEntryId: 7 } });

    const none = makeTx(null);
    expect(await GLAutomationService.reverseDeliveredFee(none, order, 1)).toBeNull();
    expect(none.journalEntry.create).not.toHaveBeenCalled();
  });
});
