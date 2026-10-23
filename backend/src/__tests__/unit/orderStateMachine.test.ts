/**
 * M1-T08 / M1-T09: order state machine unit tests. The 12 x 12 grid below is written out by hand
 * and does not read the exported table.
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import '../mocks/logger.mock';
import { OrderStatus } from '@prisma/client';

const tx: any = {
  order: { findFirst: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
  orderHistory: { create: jest.fn() },
  auditLog: { create: jest.fn() },
  agentCollection: { findFirst: jest.fn() },
};

jest.mock('../../utils/prisma', () => ({
  __esModule: true,
  default: { $transaction: (cb: any) => cb(tx) },
}));
// GL, stock and post-commit effects have their own integration tests (orderSideEffects.test.ts)
jest.mock('../../services/orderSideEffects', () => ({
  legacyStockHook: jest.fn(async () => undefined),
  applyGlEffects: jest.fn(async () => ({})),
  afterCommitEffects: jest.fn(),
}));
jest.mock('../../middleware/auth', () => ({ __esModule: true, hasPermission: jest.fn() }));
// The attempt row has its own integration test (deliveryProofAttempts.test.ts); here only the call is checked
jest.mock('../../services/deliveryAttemptHook', () => ({ recordDeliveryAttempt: jest.fn(async () => undefined) }));

import { transitionOrder, allowedTransitions, OrderTransitionError, TransitionActor } from '../../services/orderStateMachine';
import { hasPermission } from '../../middleware/auth';
import { recordDeliveryAttempt } from '../../services/deliveryAttemptHook';

const S: OrderStatus[] = [
  'pending_confirmation', 'payment_pending', 'payment_failed', 'confirmed', 'preparing', 'ready_for_pickup',
  'out_for_delivery', 'delivered', 'digital_delivered', 'failed_delivery', 'returned', 'cancelled',
];

// Row = from, column = to, in the order of S. . = same, Y = allowed for admin, N = denied.
//        pc pp pf co pr rp od de dd fd re ca
const GRID: Record<string, string> = {
  pending_confirmation: '. Y N Y N N N N N N N Y',
  payment_pending:      'N . Y Y N N N N Y N N Y',
  payment_failed:       'N Y . N N N N N N N N Y',
  confirmed:            'N N N . Y Y Y N N N N Y',
  preparing:            'N N N Y . Y Y N N N N Y',
  ready_for_pickup:     'N N N Y Y . Y N N N N Y',
  out_for_delivery:     'N N N N N N . Y N Y Y N',
  delivered:            'N N N N N N N . N N Y N',
  digital_delivered:    'N N N N N N N N . N N N',
  failed_delivery:      'N N N N N N Y N N . Y Y',
  returned:             'N N N N N N N N N N . N',
  cancelled:            'N N N N N N N N N N N .',
};

const ADMIN: TransitionActor = { kind: 'user', userId: 1, role: 'admin' };
const SYSTEM: TransitionActor = { kind: 'system' };
const INTEGRATION: TransitionActor = { kind: 'integration' };

function setOrder(over: Record<string, unknown> = {}) {
  const order = {
    id: 5, tenantId: 't1', status: 'confirmed', statusVersion: 3, orderType: 'physical',
    customerRepId: 20, deliveryAgentId: 30, confirmedAt: null, confirmedById: null, dispatchedAt: null,
    ...over,
  };
  tx.order.findFirst.mockResolvedValue(order);
  return order;
}

const code = async (p: Promise<unknown>) => {
  try { await p; return 'ok'; } catch (e) { return e instanceof OrderTransitionError ? e.code : `other:${(e as Error).message}`; }
};

beforeEach(() => {
  setOrder();
  tx.order.updateMany.mockResolvedValue({ count: 1 });
  tx.order.update.mockResolvedValue({});
  tx.orderHistory.create.mockResolvedValue({ id: 99 });
  tx.auditLog.create.mockResolvedValue({});
  tx.agentCollection.findFirst.mockResolvedValue(null);
  (hasPermission as jest.Mock<any>).mockResolvedValue(false);
});

describe('transition table, admin actor', () => {
  for (const from of S) {
    const cells = GRID[from].split(' ');
    S.forEach((to, i) => {
      const cell = cells[i];
      const verb = cell === '.' ? 'is a no-op' : cell === 'Y' ? 'is allowed' : 'is denied';
      it(`${from} -> ${to} ${verb}`, async () => {
        setOrder({ status: from });
        // A user actor must give the reasons the machine asks for (failed_delivery needs failureReason)
        const result = await code(transitionOrder(5, to, ADMIN, { failureReason: 'other' }));
        if (cell === '.') {
          expect(result).toBe('ok');
          expect(tx.orderHistory.create).not.toHaveBeenCalled();
          expect(tx.order.updateMany).not.toHaveBeenCalled();
        } else if (cell === 'Y') {
          expect(result).toBe('ok');
          expect(tx.orderHistory.create).toHaveBeenCalledTimes(1);
        } else {
          expect(['INVALID_TRANSITION', 'FORBIDDEN']).toContain(result);
          expect(tx.orderHistory.create).not.toHaveBeenCalled();
        }
      });
    });
  }
});

describe('same status', () => {
  it('returns changed:false with no history row and no write', async () => {
    const res = await transitionOrder(5, 'confirmed', ADMIN);
    expect(res.changed).toBe(false);
    expect(tx.order.updateMany).not.toHaveBeenCalled();
    expect(tx.orderHistory.create).not.toHaveBeenCalled();
  });
});

describe('history row and lock', () => {
  it('writes one row with from, actor kind, note and locks on statusVersion', async () => {
    await transitionOrder(5, 'preparing', ADMIN, { note: 'packing' });
    expect(tx.order.updateMany).toHaveBeenCalledWith({ where: { id: 5, statusVersion: 3 }, data: { status: 'preparing' } });
    expect(tx.orderHistory.create).toHaveBeenCalledTimes(1);
    expect(tx.orderHistory.create.mock.calls[0][0].data).toMatchObject({
      orderId: 5, status: 'preparing', fromStatus: 'confirmed', changedBy: 1, actorKind: 'user', notes: 'packing', forced: false,
    });
  });

  it('zero rows updated gives STALE_ORDER', async () => {
    tx.order.updateMany.mockResolvedValue({ count: 0 });
    expect(await code(transitionOrder(5, 'preparing', ADMIN))).toBe('STALE_ORDER');
    expect(tx.orderHistory.create).not.toHaveBeenCalled();
  });
});

describe('role gates', () => {
  const rep: TransitionActor = { kind: 'user', userId: 20, role: 'sales_rep' };
  const agent: TransitionActor = { kind: 'user', userId: 30, role: 'delivery_agent' };

  it('sales_rep: pending_confirmation -> confirmed|cancelled on own order', async () => {
    setOrder({ status: 'pending_confirmation' });
    expect(await code(transitionOrder(5, 'confirmed', rep))).toBe('ok');
    expect(await code(transitionOrder(5, 'cancelled', rep, { declineReason: 'changed_mind' }))).toBe('ok');
  });
  it('sales_rep: not another rep order', async () => {
    setOrder({ status: 'pending_confirmation', customerRepId: 21 });
    expect(await code(transitionOrder(5, 'confirmed', rep))).toBe('FORBIDDEN');
  });
  it('sales_rep: no other moves', async () => {
    setOrder({ status: 'confirmed' });
    expect(await code(transitionOrder(5, 'preparing', rep))).toBe('FORBIDDEN');
    setOrder({ status: 'pending_confirmation' });
    expect(await code(transitionOrder(5, 'payment_pending', rep))).toBe('FORBIDDEN');
  });
  it('inventory_manager: pre-dispatch moves only', async () => {
    const inv: TransitionActor = { kind: 'user', userId: 40, role: 'inventory_manager' };
    setOrder({ status: 'confirmed' });
    expect(await code(transitionOrder(5, 'preparing', inv))).toBe('ok');
    expect(await code(transitionOrder(5, 'out_for_delivery', inv))).toBe('FORBIDDEN');
    expect(await code(transitionOrder(5, 'cancelled', inv))).toBe('FORBIDDEN');
  });
  it('delivery_agent: dispatch, deliver, fail, retry on own order', async () => {
    setOrder({ status: 'ready_for_pickup' });
    expect(await code(transitionOrder(5, 'out_for_delivery', agent))).toBe('ok');
    setOrder({ status: 'out_for_delivery' });
    expect(await code(transitionOrder(5, 'delivered', agent))).toBe('ok');
    expect(await code(transitionOrder(5, 'failed_delivery', agent, { failureReason: 'refused' }))).toBe('ok');
    setOrder({ status: 'failed_delivery' });
    expect(await code(transitionOrder(5, 'out_for_delivery', agent))).toBe('ok');
  });
  it('delivery_agent: not another agent order, not returned or cancelled', async () => {
    setOrder({ status: 'out_for_delivery', deliveryAgentId: 31 });
    expect(await code(transitionOrder(5, 'delivered', agent))).toBe('FORBIDDEN');
    setOrder({ status: 'out_for_delivery' });
    expect(await code(transitionOrder(5, 'returned', agent))).toBe('FORBIDDEN');
    setOrder({ status: 'failed_delivery' });
    expect(await code(transitionOrder(5, 'cancelled', agent))).toBe('FORBIDDEN');
  });
  it('accountant: none', async () => {
    const acc: TransitionActor = { kind: 'user', userId: 50, role: 'accountant' };
    expect(await code(transitionOrder(5, 'preparing', acc))).toBe('FORBIDDEN');
  });
  it('manager: every normal move', async () => {
    const mgr: TransitionActor = { kind: 'user', userId: 60, role: 'manager' };
    expect(await code(transitionOrder(5, 'cancelled', mgr))).toBe('ok');
  });
  it('system: checkout and settlement moves', async () => {
    setOrder({ status: 'pending_confirmation' });
    expect(await code(transitionOrder(5, 'payment_pending', SYSTEM))).toBe('ok');
    setOrder({ status: 'payment_pending' });
    expect(await code(transitionOrder(5, 'confirmed', SYSTEM))).toBe('ok');
    setOrder({ status: 'payment_failed' });
    expect(await code(transitionOrder(5, 'payment_pending', SYSTEM))).toBe('ok');
  });
});

describe('out_for_delivery needs an agent', () => {
  it('pre-dispatch without agent is INVALID_TRANSITION', async () => {
    setOrder({ status: 'confirmed', deliveryAgentId: null });
    await expect(transitionOrder(5, 'out_for_delivery', ADMIN)).rejects.toMatchObject({
      code: 'INVALID_TRANSITION', message: 'Assign a delivery agent first', statusCode: 409,
    });
  });
});

describe('digital_delivered', () => {
  it('system may move a digital pre-dispatch order', async () => {
    setOrder({ status: 'confirmed', orderType: 'digital' });
    expect(await code(transitionOrder(5, 'digital_delivered', SYSTEM))).toBe('ok');
  });
  it('a user may not, even on a digital order', async () => {
    setOrder({ status: 'confirmed', orderType: 'digital' });
    expect(await code(transitionOrder(5, 'digital_delivered', ADMIN))).toBe('FORBIDDEN');
    expect(await code(transitionOrder(5, 'digital_delivered', INTEGRATION))).toBe('FORBIDDEN');
  });
  it('system may not on a physical order', async () => {
    setOrder({ status: 'confirmed' });
    expect(await code(transitionOrder(5, 'digital_delivered', SYSTEM))).toBe('INVALID_TRANSITION');
  });
});

describe('force (F-302)', () => {
  const SUPER: TransitionActor = { kind: 'user', userId: 2, role: 'super_admin' };

  it('without permission is FORBIDDEN (403)', async () => {
    setOrder({ status: 'cancelled' });
    await expect(transitionOrder(5, 'confirmed', ADMIN, { force: true, reason: 'owner asked' })).rejects.toMatchObject({
      code: 'FORBIDDEN', statusCode: 403,
    });
  });
  it('a forced move with a blank or missing reason works and stores no reason (COD-139)', async () => {
    (hasPermission as jest.Mock<any>).mockResolvedValue(true);
    setOrder({ status: 'cancelled' });
    const res = await transitionOrder(5, 'confirmed', SUPER, { force: true, reason: '   ' });
    expect(res).toMatchObject({ changed: true, forced: true });
    const data = tx.orderHistory.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ forced: true, notes: null });
    expect(data.metadata.reason).toBeUndefined();
    expect(tx.auditLog.create.mock.calls[0][0].data.metadata.reason).toBeUndefined();
    setOrder({ status: 'cancelled' });
    expect((await transitionOrder(5, 'confirmed', SUPER, { force: true })).forced).toBe(true);
  });
  it('a short reason is kept as given (COD-139)', async () => {
    (hasPermission as jest.Mock<any>).mockResolvedValue(true);
    setOrder({ status: 'cancelled' });
    await transitionOrder(5, 'confirmed', SUPER, { force: true, reason: ' abc ' });
    expect(tx.orderHistory.create.mock.calls[0][0].data).toMatchObject({ forced: true, notes: 'abc', metadata: { reason: 'abc' } });
  });
  it('a forced move to digital_delivered on a physical order is INVALID_TRANSITION (COD-139)', async () => {
    (hasPermission as jest.Mock<any>).mockResolvedValue(true);
    setOrder({ status: 'cancelled' });
    expect(await code(transitionOrder(5, 'digital_delivered', SUPER, { force: true, reason: 'owner asked' }))).toBe('INVALID_TRANSITION');
    expect(tx.order.updateMany).not.toHaveBeenCalled();
    setOrder({ status: 'cancelled', orderType: 'digital' });
    expect(await code(transitionOrder(5, 'digital_delivered', SUPER, { force: true }))).toBe('ok');
  });
  it('a valid force works, marks the row forced and writes one AuditLog row', async () => {
    (hasPermission as jest.Mock<any>).mockResolvedValue(true);
    setOrder({ status: 'cancelled' });
    const res = await transitionOrder(5, 'confirmed', SUPER, { force: true, reason: 'cancelled by mistake' });
    expect(res).toMatchObject({ changed: true, forced: true });
    expect(tx.orderHistory.create.mock.calls[0][0].data).toMatchObject({ forced: true, notes: 'cancelled by mistake', fromStatus: 'cancelled' });
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({
      userId: 2, resource: 'order', resourceId: '5',
      metadata: { from: 'cancelled', to: 'confirmed', reason: 'cancelled by mistake', forced: true },
    });
  });
  it('forced move to same status is a no-op', async () => {
    (hasPermission as jest.Mock<any>).mockResolvedValue(true);
    const res = await transitionOrder(5, 'confirmed', SUPER, { force: true, reason: 'nothing to do' });
    expect(res.changed).toBe(false);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it('forced move to delivered needs a delivery partner', async () => {
    (hasPermission as jest.Mock<any>).mockResolvedValue(true);
    setOrder({ status: 'cancelled', deliveryAgentId: null });
    expect(await code(transitionOrder(5, 'delivered', SUPER, { force: true, reason: 'owner asked' }))).toBe('INVALID_TRANSITION');
  });
  it('a sales_rep with force_status cannot force another rep order (FORBIDDEN 403)', async () => {
    (hasPermission as jest.Mock<any>).mockResolvedValue(true);
    setOrder({ status: 'cancelled', customerRepId: 21 });
    await expect(transitionOrder(5, 'confirmed', { kind: 'user', userId: 20, role: 'sales_rep' }, { force: true, reason: 'customer called back' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
    expect(tx.orderHistory.create).not.toHaveBeenCalled();
  });
  it('a sales_rep with force_status can force an own order', async () => {
    (hasPermission as jest.Mock<any>).mockResolvedValue(true);
    setOrder({ status: 'cancelled', customerRepId: 20 });
    const res = await transitionOrder(5, 'confirmed', { kind: 'user', userId: 20, role: 'sales_rep' }, { force: true, reason: 'customer called back' });
    expect(res).toMatchObject({ changed: true, forced: true });
  });
  it('an integration actor cannot force', async () => {
    (hasPermission as jest.Mock<any>).mockResolvedValue(true);
    setOrder({ status: 'cancelled' });
    expect(await code(transitionOrder(5, 'confirmed', INTEGRATION, { force: true, reason: 'sync says so' }))).toBe('FORBIDDEN');
  });
  it('an integration actor may revive a cancelled order as a jump (3PL says delivered)', async () => {
    setOrder({ status: 'cancelled' });
    const res = await transitionOrder(5, 'delivered', INTEGRATION);
    expect(res).toMatchObject({ changed: true, jump: true });
  });
});

describe('integration jumps (F-302)', () => {
  it('pre-dispatch -> delivered needs no reason, carries metadata.jump and sets dispatchedAt', async () => {
    setOrder({ status: 'preparing', deliveryAgentId: null });
    const res = await transitionOrder(5, 'delivered', INTEGRATION);
    expect(res).toMatchObject({ changed: true, jump: true });
    expect(tx.orderHistory.create.mock.calls[0][0].data).toMatchObject({ actorKind: 'integration', forced: false, metadata: { jump: true } });
    const patch = tx.order.updateMany.mock.calls[0][0].data;
    expect(patch.dispatchedAt).toBeInstanceOf(Date);
    expect(patch.deliveryDate).toBeInstanceOf(Date);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it('pre-dispatch -> failed_delivery|returned and failed_delivery -> delivered', async () => {
    setOrder({ status: 'confirmed' });
    expect(await code(transitionOrder(5, 'failed_delivery', INTEGRATION))).toBe('ok');
    expect(await code(transitionOrder(5, 'returned', INTEGRATION))).toBe('ok');
    setOrder({ status: 'failed_delivery' });
    expect(await code(transitionOrder(5, 'delivered', INTEGRATION))).toBe('ok');
  });
  it('real Logiswift moves: pending -> out_for_delivery with no agent, out_for_delivery -> cancelled', async () => {
    setOrder({ status: 'pending_confirmation', deliveryAgentId: null });
    expect(await code(transitionOrder(5, 'out_for_delivery', INTEGRATION))).toBe('ok');
    expect(tx.order.updateMany.mock.calls[0][0].data.dispatchedAt).toBeInstanceOf(Date);
    setOrder({ status: 'out_for_delivery' });
    expect(await code(transitionOrder(5, 'cancelled', INTEGRATION))).toBe('ok');
  });
  it('an integration actor still cannot make a physical order digital_delivered', async () => {
    setOrder({ status: 'confirmed' });
    expect(await code(transitionOrder(5, 'digital_delivered', INTEGRATION))).not.toBe('ok');
  });
  it('ai actor may jump too', async () => {
    setOrder({ status: 'confirmed' });
    expect(await code(transitionOrder(5, 'delivered', { kind: 'ai' }))).toBe('ok');
  });
  it('a person without force cannot jump', async () => {
    setOrder({ status: 'confirmed' });
    expect(await code(transitionOrder(5, 'delivered', ADMIN))).toBe('INVALID_TRANSITION');
  });
  it('dispatchedAt already set stays', async () => {
    setOrder({ status: 'confirmed', dispatchedAt: new Date('2026-01-01') });
    await transitionOrder(5, 'delivered', INTEGRATION);
    expect(tx.order.updateMany.mock.calls[0][0].data.dispatchedAt).toBeUndefined();
  });
});

describe('leaving delivered', () => {
  it.each(['verified', 'approved', 'deposited', 'reconciled'])('collection %s blocks with COLLECTION_VERIFIED (409)', async (status) => {
    setOrder({ status: 'delivered' });
    tx.agentCollection.findFirst.mockResolvedValue({ status });
    await expect(transitionOrder(5, 'returned', ADMIN)).rejects.toMatchObject({
      code: 'COLLECTION_VERIFIED', message: 'Reverse the collection first', statusCode: 409,
    });
    expect(tx.order.updateMany).not.toHaveBeenCalled();
  });
  it('a draft collection does not block; deliveryDate is cleared and returnedAt set', async () => {
    setOrder({ status: 'delivered' });
    tx.agentCollection.findFirst.mockResolvedValue({ status: 'draft' });
    await transitionOrder(5, 'returned', ADMIN);
    const patch = tx.order.updateMany.mock.calls[0][0].data;
    expect(patch.deliveryDate).toBeNull();
    expect(patch.returnedAt).toBeInstanceOf(Date);
  });
});

describe('side effects', () => {
  it('confirmed sets confirmedAt and confirmedById when empty', async () => {
    setOrder({ status: 'pending_confirmation' });
    await transitionOrder(5, 'confirmed', ADMIN);
    expect(tx.order.updateMany.mock.calls[0][0].data).toMatchObject({ confirmedById: 1 });
    expect(tx.order.updateMany.mock.calls[0][0].data.confirmedAt).toBeInstanceOf(Date);
  });
  it('confirmed keeps an existing confirmedAt', async () => {
    setOrder({ status: 'pending_confirmation', confirmedAt: new Date('2026-01-01') });
    await transitionOrder(5, 'confirmed', ADMIN);
    expect(tx.order.updateMany.mock.calls[0][0].data.confirmedAt).toBeUndefined();
  });
  it('delivered uses options.deliveryDate', async () => {
    const d = new Date('2026-05-05T10:00:00Z');
    setOrder({ status: 'out_for_delivery' });
    await transitionOrder(5, 'delivered', ADMIN, { deliveryDate: d });
    expect(tx.order.updateMany.mock.calls[0][0].data.deliveryDate).toBe(d);
  });
  it('failed_delivery stores reason and next attempt; retry clears failureReason', async () => {
    const next = new Date('2026-05-06T10:00:00Z');
    setOrder({ status: 'out_for_delivery' });
    await transitionOrder(5, 'failed_delivery', ADMIN, { failureReason: 'rescheduled', nextAttemptDate: next });
    expect(tx.order.updateMany.mock.calls[0][0].data).toMatchObject({ failureReason: 'rescheduled', nextAttemptDate: next });
    tx.order.updateMany.mockClear();
    setOrder({ status: 'failed_delivery' });
    await transitionOrder(5, 'out_for_delivery', ADMIN);
    expect(tx.order.updateMany.mock.calls[0][0].data.failureReason).toBeNull();
  });
  it('a reschedule with no date sets the next attempt to tomorrow; an explicit date wins', async () => {
    setOrder({ status: 'out_for_delivery' });
    await transitionOrder(5, 'failed_delivery', ADMIN, { failureReason: 'rescheduled' });
    const next: Date = tx.order.updateMany.mock.calls[0][0].data.nextAttemptDate;
    const hours = (next.getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(22);
    expect(hours).toBeLessThan(26);
    tx.order.updateMany.mockClear();
    setOrder({ status: 'out_for_delivery' });
    await transitionOrder(5, 'failed_delivery', ADMIN, { failureReason: 'other' });
    expect(tx.order.updateMany.mock.calls[0][0].data.nextAttemptDate).toBeUndefined();
  });
  it('every changed move calls the delivery attempt hook once, in the move transaction; a same-status call does not', async () => {
    setOrder({ status: 'out_for_delivery' });
    await transitionOrder(5, 'failed_delivery', ADMIN, { failureReason: 'refused', note: 'Brother refused' });
    expect(recordDeliveryAttempt).toHaveBeenCalledTimes(1);
    expect(recordDeliveryAttempt).toHaveBeenCalledWith(tx, expect.objectContaining({ id: 5, deliveryAgentId: 30 }), 'failed_delivery', expect.objectContaining({ failureReason: 'refused', note: 'Brother refused' }));
    (recordDeliveryAttempt as jest.Mock).mockClear();
    setOrder({ status: 'failed_delivery' });
    expect((await transitionOrder(5, 'failed_delivery', ADMIN)).changed).toBe(false);
    expect(recordDeliveryAttempt).not.toHaveBeenCalled();
  });
  it('cancelled stores declineReason', async () => {
    await transitionOrder(5, 'cancelled', ADMIN, { declineReason: 'changed_mind' });
    expect(tx.order.updateMany.mock.calls[0][0].data.declineReason).toBe('changed_mind');
  });
});

describe('failure and decline reasons (COD-139)', () => {
  it('failed_delivery without failureReason works', async () => {
    setOrder({ status: 'out_for_delivery' });
    expect(await code(transitionOrder(5, 'failed_delivery', ADMIN))).toBe('ok');
  });
  it('a rep cancelling from pending_confirmation without declineReason works', async () => {
    setOrder({ status: 'pending_confirmation' });
    const REP: TransitionActor = { kind: 'user', userId: 20, role: 'sales_rep' };
    expect(await code(transitionOrder(5, 'cancelled', REP))).toBe('ok');
  });
});

describe('allowedTransitions', () => {
  it('lists normal moves and, with canForce, the rest as forced', () => {
    const order: any = { status: 'delivered', orderType: 'physical' };
    const r = allowedTransitions(order, ADMIN, { canForce: true });
    expect(r.normal).toEqual(['returned']);
    expect(r.forced).toHaveLength(7);
    expect(r.forced).not.toContain('delivered');
    expect(allowedTransitions(order, ADMIN).forced).toEqual([]);
  });
  it('a physical order is not offered digital_delivered, payment_pending or payment_failed (COD-139)', () => {
    const hidden = ['digital_delivered', 'payment_pending', 'payment_failed'];
    const r = allowedTransitions({ status: 'pending_confirmation', orderType: 'physical' } as any, ADMIN, { canForce: true });
    expect(r.normal).toEqual(['confirmed', 'cancelled']);
    for (const s of hidden) { expect(r.normal).not.toContain(s); expect(r.forced).not.toContain(s); }
  });
  it('a digital order keeps the payment statuses (COD-139)', () => {
    const r = allowedTransitions({ status: 'pending_confirmation', orderType: 'digital' } as any, ADMIN, { canForce: true });
    expect(r.normal).toContain('payment_pending');
    expect(r.forced).toContain('payment_failed');
  });
  it('a physical order already in a payment status keeps the moves the table allows (COD-139)', () => {
    const r = allowedTransitions({ status: 'payment_pending', orderType: 'physical' } as any, ADMIN, { canForce: true });
    expect(r.normal).toEqual(expect.arrayContaining(['confirmed', 'payment_failed', 'cancelled']));
    expect(r.forced).not.toContain('digital_delivered');
  });
  it('an integration actor sees the jumps', () => {
    const order: any = { status: 'confirmed', orderType: 'physical', deliveryAgentId: 1 };
    expect(allowedTransitions(order, INTEGRATION).normal).toEqual(
      expect.arrayContaining(['delivered', 'failed_delivery', 'returned']),
    );
  });
});
