/**
 * M3b-T07 (COD-32, F-406, F-934): the payment-settled hook, the ledger poster, Paystack payouts and the
 * paystack_unsettled Finding. Real database and app; the provider is the fake one.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';

jest.mock('../../services/metaCapiService', () => require('./helpers/paymentTestKit').metaCapiMock());
jest.mock('../../services/digitalDeliveryService', () => ({
  digitalDeliveryService: { generateDownloadToken: async () => 'tok', sendDownloadLinks: async () => undefined },
}));

import app from '../../server';
import logger from '../../utils/logger';
import prisma, { prismaBase } from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import * as Money from '../../utils/money';
import { registerPaymentProvider, unregisterPaymentProvider } from '../../services/payments';
import { createFakeProvider, FakeProvider } from '../../services/payments/fakeProvider';
import { onPaymentSettled, clearPaymentSettledSubscribers, PaymentSettledEvent } from '../../services/payments/settlementHooks';
import { postPaymentToLedger, registerLedgerPoster } from '../../services/payments/ledgerPoster';
import { GLAutomationService } from '../../services/glAutomationService';
import { checkLedgerForTenant } from '../../services/ledgerCheckService';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';
import { bearer } from './helpers/superAdminToken';
import { ip, newRef, seedPending } from './helpers/paymentTestKit';

jest.setTimeout(120_000);

const DAY = 24 * 60 * 60 * 1000;
let pair: TwoTenants;
let fake: FakeProvider;
const events: PaymentSettledEvent[] = [];


/** Settle a payment through the real webhook and return the event the hook emitted for it. */
async function settle(orderType: 'physical' | 'digital', fee: string | undefined = '0.75') {
  const ref = newRef(orderType);
  await seedPending(pair, 'a', ref, { orderType });
  fake.setPayment(ref, { status: 'success', amount: '50', ...(fee ? { fee } : {}), channel: 'card' });
  const res = await request(app).post(`/api/payments/webhook/fake/${pair.a.slug}`).set('X-Forwarded-For', ip())
    .set('x-fake-signature', 'valid').send({ type: 'payment.success', reference: ref });
  expect(res.status).toBe(200);
  const event = events.find((e) => e.reference === ref);
  expect(event).toBeDefined();
  return event as PaymentSettledEvent;
}

const entriesFor = (tenantId: string, orderId: number) =>
  prismaBase.journalEntry.findMany({ where: { tenantId, sourceType: 'digital_sale', sourceId: orderId }, include: { transactions: { include: { account: true } } } });

/** Net balance (debit minus credit) of an account code for a tenant, from the stored balance and from the lines. */
async function balance1030(tenantId: string) {
  const lines = await prismaBase.$queryRawUnsafe<Array<{ net: string | null }>>(
    `SELECT SUM(t.debit_amount - t.credit_amount)::text AS net FROM account_transactions t JOIN accounts a ON a.id = t.account_id
     JOIN journal_entries j ON j.id = t.journal_entry_id WHERE t.tenant_id = $1 AND a.code = '1030' AND NOT j.is_voided`, tenantId);
  const account = await prismaBase.account.findFirstOrThrow({ where: { tenantId, code: '1030' } });
  return { fromLines: Money.parse(lines[0]?.net ?? 0), stored: Money.parse(account.currentBalance) };
}

/** A digital sale entry the way the poster books it, dated `daysAgo`. */
async function bookSale(side: 'a' | 'b', amount: string, fee: string, daysAgo: number) {
  const t = pair[side];
  await runInTenant(t.id, () =>
    prisma.$transaction((tx) => new GLAutomationService().createDigitalSaleEntry(tx as any, t.ids.order, amount, fee, t.users.admin.id, new Date(Date.now() - daysAgo * DAY))));
}

const clearLedger = async (tenantId: string) => {
  await prismaBase.accountTransaction.deleteMany({ where: { tenantId } });
  await prismaBase.journalEntry.deleteMany({ where: { tenantId } });
  await prismaBase.account.updateMany({ where: { tenantId }, data: { currentBalance: 0 } });
  await prismaBase.finding.deleteMany({ where: { tenantId, type: { in: ['paystack_unsettled', 'ledger_post_failed'] } } });
};

beforeAll(async () => {
  pair = await createTwoTenants('payfees');
  fake = createFakeProvider('fake');
  registerPaymentProvider(fake);
  onPaymentSettled((e) => { events.push(e); });
  await clearLedger(pair.a.id);
  await clearLedger(pair.b.id);
});

afterEach(async () => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  clearPaymentSettledSubscribers();
  unregisterPaymentProvider('fake');
  await clearLedger(pair.a.id);
  await clearLedger(pair.b.id);
  await pair.cleanup();
  await prismaBase.$disconnect();
});

describe('the payment-settled hook', () => {
  it('settlement emits once, after the commit, with the full payload in major units', async () => {
    const event = await settle('digital');
    const order = await prismaBase.order.findFirstOrThrow({ where: { paymentReference: event.reference } });
    expect(event).toMatchObject({
      tenantId: pair.a.id, orderId: order.id, provider: 'fake', reference: event.reference, currency: 'GHS',
      feeUnknown: false, channel: 'card', orderType: 'digital', method: 'online_full',
    });
    expect(Money.toApi(event.amount)).toBe('50.00');
    expect(Money.toApi(event.fee)).toBe('0.75');
    expect(event.paidAt).toBeInstanceOf(Date);
    expect(events.filter((e) => e.reference === event.reference)).toHaveLength(1);
    // the transaction row was committed before subscribers saw the event
    expect(await prismaBase.transaction.count({ where: { orderId: order.id } })).toBe(1);
  });

  it('a provider that gives no fee: fee 0 and feeUnknown on the event and on the Transaction row', async () => {
    const event = await settle('physical', '');
    expect(Money.toApi(event.fee)).toBe('0.00');
    expect(event.feeUnknown).toBe(true);
    const txn = await prismaBase.transaction.findFirstOrThrow({ where: { reference: event.reference } });
    expect(txn.feeUnknown).toBe(true);
    expect(txn.feeAmount?.toString()).toBe('0');
  });

  it('no GL write happens inside settlement any more: with no subscriber the digital order has no journal entry', async () => {
    const event = await settle('digital');
    expect(await entriesFor(pair.a.id, event.orderId)).toHaveLength(0);
  });
});

describe('ledger poster', () => {
  it('a digital sale posts a balanced entry dated paidAt: DR 1030 total, CR 4020 total, DR 5060 fee, CR 1030 fee', async () => {
    const event = await settle('digital');
    const paidAt = new Date('2026-10-12T14:30:00Z');
    await postPaymentToLedger({ ...event, paidAt });

    const entries = await entriesFor(pair.a.id, event.orderId);
    expect(entries).toHaveLength(1);
    expect(entries[0].entryDate.toISOString()).toBe(paidAt.toISOString());
    const lines = entries[0].transactions;
    const sum = (key: 'debitAmount' | 'creditAmount') => Money.sum(lines.map((l) => l[key]));
    expect(sum('debitAmount').eq(sum('creditAmount'))).toBe(true);
    expect(Money.toApi(sum('debitAmount'))).toBe('50.75');
    const byCode = (code: string, key: 'debitAmount' | 'creditAmount') => Money.sum(lines.filter((l) => l.account.code === code).map((l) => l[key]));
    expect(Money.toApi(byCode('1030', 'debitAmount'))).toBe('50.00');
    expect(Money.toApi(byCode('1030', 'creditAmount'))).toBe('0.75');
    expect(Money.toApi(byCode('4020', 'creditAmount'))).toBe('50.00');
    expect(Money.toApi(byCode('5060', 'debitAmount'))).toBe('0.75');
  });

  it('posting the same order twice leaves one entry', async () => {
    const event = await settle('digital');
    await postPaymentToLedger(event);
    await postPaymentToLedger(event);
    expect(await entriesFor(pair.a.id, event.orderId)).toHaveLength(1);
  });

  it('a physical online payment posts nothing and logs a warning', async () => {
    const event = await settle('physical');
    await postPaymentToLedger(event);
    expect(await entriesFor(pair.a.id, event.orderId)).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('physical order'), expect.objectContaining({ orderId: event.orderId }));
  });

  it('a failing post is tried 3 times, then opens one ledger_post_failed Finding; the order stands', async () => {
    const event = await settle('digital');
    const spy = jest.spyOn(GLAutomationService.prototype, 'createDigitalSaleEntry').mockRejectedValue(new Error('ledger down'));

    await postPaymentToLedger(event, { delaysMs: [1, 1] });
    expect(spy).toHaveBeenCalledTimes(3);

    const findings = await prismaBase.finding.findMany({ where: { tenantId: pair.a.id, type: 'ledger_post_failed', subjectId: String(event.orderId) } });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ status: 'open', subjectType: 'order', note: `Ledger entry failed for payment ${event.reference}` });
    expect(findings[0].amount?.toString()).toBe('50');
    expect(await entriesFor(pair.a.id, event.orderId)).toHaveLength(0);
    const order = await prismaBase.order.findUniqueOrThrow({ where: { id: event.orderId } });
    expect(order.paymentStatus).toBe('paid');
    expect(await prismaBase.transaction.count({ where: { orderId: event.orderId } })).toBe(1);

    // a second failure for the same order does not open a second Finding
    await postPaymentToLedger(event, { delaysMs: [1, 1] });
    expect(await prismaBase.finding.count({ where: { tenantId: pair.a.id, type: 'ledger_post_failed', subjectId: String(event.orderId) } })).toBe(1);
  });

  it('a post that fails once and then works posts the entry and opens no Finding', async () => {
    const event = await settle('digital');
    const real = GLAutomationService.prototype.createDigitalSaleEntry;
    let calls = 0;
    jest.spyOn(GLAutomationService.prototype, 'createDigitalSaleEntry').mockImplementation(function (this: GLAutomationService, ...args: Parameters<typeof real>) {
      if (++calls === 1) return Promise.reject(new Error('blip'));
      return real.apply(this, args);
    });
    await postPaymentToLedger(event, { delaysMs: [1, 1] });
    expect(calls).toBe(2);
    expect(await entriesFor(pair.a.id, event.orderId)).toHaveLength(1);
    expect(await prismaBase.finding.count({ where: { tenantId: pair.a.id, type: 'ledger_post_failed', subjectId: String(event.orderId) } })).toBe(0);
  });

  it('registered at startup, it posts a digital sale that arrives through the webhook', async () => {
    registerLedgerPoster();
    const event = await settle('digital');
    let entries = await entriesFor(pair.a.id, event.orderId);
    for (let i = 0; i < 50 && entries.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 100));
      entries = await entriesFor(pair.a.id, event.orderId);
    }
    expect(entries).toHaveLength(1);
    expect(entries[0].entryDate.toISOString()).toBe(event.paidAt.toISOString());
  });
});

describe('POST /api/financial/paystack-payouts', () => {
  const payout = (side: 'a' | 'b', body: Record<string, unknown>, token = pair[side].users.admin.token) =>
    request(app).post('/api/financial/paystack-payouts').set(bearer(token)).set('X-Forwarded-For', ip()).send(body);

  beforeEach(async () => {
    await clearLedger(pair.a.id);
    await clearLedger(pair.b.id);
  });

  it('posts DR 1010, CR 1030 dated the payout day; a sale then a payout of the same net amount leaves 1030 at 0', async () => {
    await bookSale('a', '50', '0.75', 3); // 1030 = 49.25
    expect(Money.toApi((await balance1030(pair.a.id)).stored)).toBe('49.25');

    const res = await payout('a', { amount: '49.25', payoutDate: '2026-10-20', reference: 'PO-1001', note: 'Weekly payout' });
    expect(res.status).toBe(201);
    expect(res.body.warning).toBeUndefined();
    expect(res.body.entry.description).toBe('Paystack payout PO-1001 - Weekly payout');

    const entry = await prismaBase.journalEntry.findFirstOrThrow({ where: { tenantId: pair.a.id, sourceType: 'paystack_payout' }, include: { transactions: { include: { account: true } } } });
    expect(entry.entryDate.toISOString()).toBe('2026-10-20T00:00:00.000Z');
    const dr = entry.transactions.find((l) => Money.parse(l.debitAmount).gt(0))!;
    const cr = entry.transactions.find((l) => Money.parse(l.creditAmount).gt(0))!;
    expect([dr.account.code, Money.toApi(dr.debitAmount)]).toEqual(['1010', '49.25']);
    expect([cr.account.code, Money.toApi(cr.creditAmount)]).toEqual(['1030', '49.25']);

    const bal = await balance1030(pair.a.id);
    expect(bal.fromLines.isZero()).toBe(true);
    expect(bal.stored.isZero()).toBe(true);
  });

  it('the same reference twice for one tenant is 409 and posts nothing the second time; another tenant may reuse it', async () => {
    await bookSale('a', '100', '0', 1);
    await bookSale('b', '100', '0', 1);
    expect((await payout('a', { amount: '10', payoutDate: '2026-10-20', reference: 'PO-DUP' })).status).toBe(201);
    const again = await payout('a', { amount: '10', payoutDate: '2026-10-21', reference: 'PO-DUP' });
    expect(again.status).toBe(409);
    expect(await prismaBase.journalEntry.count({ where: { tenantId: pair.a.id, sourceType: 'paystack_payout' } })).toBe(1);
    expect((await prismaBase.journalEntry.findFirstOrThrow({ where: { tenantId: pair.a.id, sourceType: 'paystack_payout' } })).externalRef).toBe('PO-DUP');

    expect((await payout('b', { amount: '10', payoutDate: '2026-10-20', reference: 'PO-DUP' })).status).toBe(201);
  });

  it('two requests with the same reference at the same time post one entry', async () => {
    await bookSale('a', '100', '0', 1);
    const results = await Promise.all([1, 2, 3].map(() => payout('a', { amount: '5', payoutDate: '2026-10-20', reference: 'PO-RACE' })));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect(await prismaBase.journalEntry.count({ where: { tenantId: pair.a.id, sourceType: 'paystack_payout' } })).toBe(1);
  });

  it('a payout above the 1030 balance still posts, with a warning and the note in the description', async () => {
    await bookSale('a', '20', '0', 1);
    const res = await payout('a', { amount: '35.50', payoutDate: '2026-10-20', reference: 'PO-BIG', note: 'Includes a sale not booked yet' });
    expect(res.status).toBe(201);
    expect(res.body.warning).toBe('Payout is larger than the Paystack receivable balance');
    expect(res.body.entry.description).toBe('Paystack payout PO-BIG - Includes a sale not booked yet - Payout is larger than the Paystack receivable balance');
    expect(Money.toApi((await balance1030(pair.a.id)).stored)).toBe('-15.50');
  });

  it('refuses a bad body with 400 and posts nothing', async () => {
    const bad: Array<Record<string, unknown>> = [
      { payoutDate: '2026-10-20', reference: 'x' },
      { amount: '0', payoutDate: '2026-10-20', reference: 'x' },
      { amount: '-5', payoutDate: '2026-10-20', reference: 'x' },
      { amount: 'abc', payoutDate: '2026-10-20', reference: 'x' },
      { amount: '5', payoutDate: 'not a date', reference: 'x' },
      { amount: '5', payoutDate: '2026-10-20' },
      { amount: '5', payoutDate: '2026-10-20', reference: '   ' },
    ];
    for (const body of bad) {
      const res = await payout('a', body);
      expect([res.status, JSON.stringify(body)]).toEqual([400, JSON.stringify(body)]);
    }
    expect(await prismaBase.journalEntry.count({ where: { tenantId: pair.a.id, sourceType: 'paystack_payout' } })).toBe(0);
  });

  it('needs a login and an admin role', async () => {
    const body = { amount: '5', payoutDate: '2026-10-20', reference: 'PO-AUTH' };
    expect((await request(app).post('/api/financial/paystack-payouts').send(body)).status).toBe(401);
    expect((await payout('a', body, pair.a.users.salesRep.token)).status).toBe(403);
    expect(await prismaBase.journalEntry.count({ where: { tenantId: pair.a.id, sourceType: 'paystack_payout' } })).toBe(0);
  });

  it("tenant A's payout never touches tenant B's 1030", async () => {
    await bookSale('a', '50', '0', 1);
    await bookSale('b', '70', '0', 1);
    await payout('a', { amount: '50', payoutDate: '2026-10-20', reference: 'PO-ISO' });
    expect((await balance1030(pair.a.id)).stored.isZero()).toBe(true);
    expect(Money.toApi((await balance1030(pair.b.id)).stored)).toBe('70.00');
    expect(await prismaBase.journalEntry.count({ where: { tenantId: pair.b.id, sourceType: 'paystack_payout' } })).toBe(0);
  });
});

describe('paystack_unsettled Finding (nightly ledger check)', () => {
  const findings = (side: 'a' | 'b') => prismaBase.finding.findMany({ where: { tenantId: pair[side].id, type: 'paystack_unsettled' } });

  beforeEach(async () => {
    await clearLedger(pair.a.id);
    await clearLedger(pair.b.id);
  });

  it('opens one Finding for a sale older than 7 days with no payout, and not a second on the next run', async () => {
    await bookSale('a', '50', '0.75', 9);
    await checkLedgerForTenant(pair.a.id);
    let open = await findings('a');
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ status: 'open', subjectType: 'account', subjectId: '1030' });
    expect(open[0].amount?.toString()).toBe('49.25');

    await bookSale('a', '10', '0', 8); // balance grows; still one Finding, its amount follows
    await checkLedgerForTenant(pair.a.id);
    open = await findings('a');
    expect(open).toHaveLength(1);
    expect(open[0].amount?.toString()).toBe('59.25');
  });

  it('opens nothing when the sale is recent, the balance is 0, or old sales are paid out and only recent ones remain', async () => {
    await bookSale('a', '50', '0', 2); // too young
    await checkLedgerForTenant(pair.a.id);
    expect(await findings('a')).toHaveLength(0);

    await clearLedger(pair.a.id);
    await bookSale('a', '30', '0', 9);
    await runInTenant(pair.a.id, () => prisma.$transaction((tx) =>
      new GLAutomationService().createPaystackPayoutEntry(tx as any, '30', new Date(Date.now() - 8 * DAY), 'Paystack payout OLD', pair.a.users.admin.id, 'OLD')));
    await checkLedgerForTenant(pair.a.id);
    expect(await findings('a')).toHaveLength(0); // balance is 0

    await bookSale('a', '20', '0', 2); // the old sale is paid out; only this recent one is owed, and no payout in 7 days
    await checkLedgerForTenant(pair.a.id);
    expect(await findings('a')).toHaveLength(0);
  });

  it('a recent payout smaller than the old sales leaves the old remainder flagged (oldest sales clear first)', async () => {
    await bookSale('a', '40', '0', 9);
    await bookSale('a', '50', '0', 2);
    const res = await request(app).post('/api/financial/paystack-payouts').set(bearer(pair.a.users.admin.token)).set('X-Forwarded-For', ip())
      .send({ amount: '10', payoutDate: new Date().toISOString().slice(0, 10), reference: 'PO-RECENT' });
    expect(res.status).toBe(201);
    await checkLedgerForTenant(pair.a.id);
    const open = await findings('a');
    expect(open).toHaveLength(1);
    expect(open[0].amount?.toString()).toBe('30');
  });

  it("is per tenant: A's old sale opens a Finding for A only", async () => {
    await bookSale('a', '50', '0', 9);
    await checkLedgerForTenant(pair.a.id);
    await checkLedgerForTenant(pair.b.id);
    expect(await findings('a')).toHaveLength(1);
    expect(await findings('b')).toHaveLength(0);
  });
});
