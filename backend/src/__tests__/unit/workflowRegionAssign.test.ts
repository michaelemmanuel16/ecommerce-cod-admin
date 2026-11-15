import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import '../mocks/logger.mock';
import { prismaMock } from '../mocks/prisma.mock';

jest.mock('../../services/assignmentService', () => ({
  __esModule: true,
  default: { selectUserRoundRobin: jest.fn(), selectUserWeighted: jest.fn(), assignByRole: jest.fn() },
}));
jest.mock('../../services/systemUserService', () => ({ systemActor: jest.fn() }));

import assignmentService from '../../services/assignmentService';
import { systemActor } from '../../services/systemUserService';
import { evaluateConditions, evaluateRegionRule } from '../../utils/conditionEvaluator';
import { runAssignTo, validateAssignToConfig, assignToScope } from '../../services/workflowAssignTo';

const svc = assignmentService as unknown as Record<string, jest.Mock<any>>;
const kofi = { id: 11, firstName: 'Kofi', lastName: 'A', role: 'delivery_agent', isActive: true };
const ama = { id: 12, firstName: 'Ama', lastName: 'B', role: 'delivery_agent', isActive: true };
const region = (operator: string, value: unknown) => ({ id: 'c', logic: 'AND', rules: [{ field: 'region', operator, value }] });
const order = (over: Record<string, unknown> = {}) => ({ id: 5, deliveryState: 'Ashanti', customerRepId: null, deliveryAgentId: null, orderItems: [], ...over });

describe('condition "Region is X"', () => {
  it('compares case-insensitive and trimmed against the delivery state', () => {
    expect(evaluateRegionRule('is', 'Ashanti', ' ASHANTI ')).toBe(true);
    expect(evaluateRegionRule('is', '  ashanti', 'Ashanti')).toBe(true);
    expect(evaluateRegionRule('is', 'Ashanti', 'Volta')).toBe(false);
    expect(evaluateRegionRule('is', 'Ashanti', null)).toBe(false);
    expect(evaluateRegionRule('is_not', 'Ashanti', 'Volta')).toBe(true);
    expect(evaluateRegionRule('is_not', 'Ashanti', ' ashanti')).toBe(false);
    expect(evaluateRegionRule('is_not', 'Ashanti', null)).toBe(true);
    expect(evaluateRegionRule('in', ['Volta', ' Ashanti '], 'ASHANTI')).toBe(true);
    expect(evaluateRegionRule('in', ['Volta'], 'Ashanti')).toBe(false);
    expect(evaluateRegionRule('in', 'Ashanti', 'Ashanti')).toBe(false); // not a list
  });

  it('works as a workflow rule on the order, the field `region` reading deliveryState', () => {
    expect(evaluateConditions(region('is', 'Ashanti') as any, { deliveryState: 'ashanti ' })).toBe(true);
    expect(evaluateConditions(region('in', ['Volta', 'Ashanti']) as any, { deliveryState: 'Volta' })).toBe(true);
    expect(evaluateConditions(region('is', 'Ashanti') as any, { deliveryState: 'Volta' })).toBe(false);
  });
});

describe('assign_to config', () => {
  const ok = { role: 'delivery_agent', userIds: [1, 2], split: 'even' };
  it('accepts the three roles and both splits', () => {
    for (const role of ['sales_rep', 'delivery_agent', 'partner']) expect(() => validateAssignToConfig({ ...ok, role })).not.toThrow();
    expect(() => validateAssignToConfig({ ...ok, split: 'weighted', weights: { 1: 3, 2: 1 } })).not.toThrow();
  });
  it('refuses a bad role, no users, a bad split, and a weighted split without a weight for everyone', () => {
    for (const bad of [{ ...ok, role: 'admin' }, { ...ok, userIds: [] }, { ...ok, userIds: ['a'] }, { ...ok, split: 'random' },
      { ...ok, split: 'weighted' }, { ...ok, split: 'weighted', weights: { 1: 3 } }, { ...ok, split: 'weighted', weights: { 1: 3, 2: 0 } }, undefined]) {
      expect(() => validateAssignToConfig(bad)).toThrow(expect.objectContaining({ statusCode: 400 }));
    }
  });
});

describe('assign_to action', () => {
  beforeEach(() => {
    (systemActor as jest.Mock<any>).mockResolvedValue({ kind: 'system', userId: 77 });
    (prismaMock.order.findUnique as any).mockResolvedValue(order());
    (prismaMock.user.findMany as any).mockResolvedValue([ama, kofi]); // the database order differs from the list order
    svc.selectUserRoundRobin.mockResolvedValue(kofi);
    svc.selectUserWeighted.mockResolvedValue(kofi);
  });
  const action = (config: Record<string, unknown> = {}) => ({ type: 'assign_to', config: { role: 'delivery_agent', userIds: [11, 12], split: 'even', ...config } });

  it('even: the round robin gets the users in the workflow order and one cursor scope per workflow action', async () => {
    const out = await runAssignTo(action(), { orderId: 5 }, region('is', 'Ashanti'), { workflowId: 3, actionIndex: 1 });
    expect(svc.selectUserRoundRobin).toHaveBeenCalledWith([kofi, ama], 'delivery_agent', assignToScope(3, 1));
    expect(assignToScope(3, 1)).toBe('workflow:3:action:1');
    expect(svc.assignByRole).toHaveBeenCalledWith(5, 11, 'delivery_agent', { kind: 'system', userId: 77 }); // through the assignment service
    expect(out).toMatchObject({ assigned: true, assignedUserId: 11 });
  });

  it('weighted: the cursor gets the weights from the config', async () => {
    await runAssignTo(action({ split: 'weighted', weights: { 11: 3, 12: 1 } }), { orderId: 5 }, undefined, { workflowId: 3, actionIndex: 0 });
    expect(svc.selectUserWeighted).toHaveBeenCalledWith([kofi, ama], { 11: 3, 12: 1 }, 'delivery_agent', 'workflow:3:action:0');
    expect(svc.selectUserRoundRobin).not.toHaveBeenCalled();
  });

  it('partner assigns the delivery agent field; sales_rep the rep field', async () => {
    await runAssignTo(action({ role: 'partner' }), { orderId: 5 }, undefined, {});
    expect(svc.assignByRole).toHaveBeenLastCalledWith(5, 11, 'delivery_agent', expect.anything());
    (prismaMock.user.findMany as any).mockResolvedValue([{ ...kofi, role: 'sales_rep' }]);
    await runAssignTo(action({ role: 'sales_rep', userIds: [11] }), { orderId: 5 }, undefined, {});
    expect(svc.assignByRole).toHaveBeenLastCalledWith(5, 11, 'sales_rep', expect.anything());
  });

  it('an order in another region is left unassigned, the step succeeds and says why', async () => {
    (prismaMock.order.findUnique as any).mockResolvedValue(order({ deliveryState: 'Volta' }));
    const out = await runAssignTo(action(), { orderId: 5 }, region('is', 'Ashanti'), {});
    expect(out).toMatchObject({ assigned: false, reason: 'conditions_not_met' });
    expect(svc.assignByRole).not.toHaveBeenCalled();
  });

  it('never swaps an order that already has a user for the role', async () => {
    (prismaMock.order.findUnique as any).mockResolvedValue(order({ deliveryAgentId: 99 }));
    expect(await runAssignTo(action(), { orderId: 5 }, undefined, {})).toMatchObject({ assigned: false, reason: 'already_assigned' });
    expect(svc.assignByRole).not.toHaveBeenCalled();
  });

  it('nobody can take it (all deactivated or away): unassigned, and the result says why', async () => {
    svc.selectUserRoundRobin.mockResolvedValue(null);
    const out = await runAssignTo(action(), { orderId: 5 }, undefined, {});
    expect(out).toMatchObject({ assigned: false, reason: 'no_available_user' });
    expect(out.message).toContain('stays unassigned');
    expect(svc.assignByRole).not.toHaveBeenCalled();
  });

  it('a user with the wrong role or a missing id is not in the rotation', async () => {
    (prismaMock.user.findMany as any).mockResolvedValue([{ ...ama, role: 'sales_rep' }]);
    expect(await runAssignTo(action(), { orderId: 5 }, undefined, {})).toMatchObject({ assigned: false, reason: 'no_valid_users' });
  });

  it('no order in the input: nothing to assign', async () => {
    expect(await runAssignTo(action(), {}, undefined, {})).toMatchObject({ assigned: false, reason: 'no_order' });
  });
});
