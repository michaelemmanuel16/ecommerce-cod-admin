import { conditionErrors, actionErrors, assertValidWorkflow, MAX_ACTIONS } from '../../services/workflowValidation';
import { templateConnections } from '../../services/workflowService';

const group = (...rules: any[]) => ({ id: 'c', logic: 'AND', rules });

describe('workflow validation (M9-T25)', () => {
  it('refuses an empty condition value, one message per rule', () => {
    const errors = conditionErrors(group(
      { field: 'region', operator: 'is', value: '' },
      { field: 'totalAmount', operator: 'greater_than', value: null },
      { field: 'status', operator: 'in', value: [] },
    ));
    expect(errors).toHaveLength(3);
    expect(errors[0]).toMatch(/enter a value for "region"/);
  });

  it('accepts a missing value for is_empty / is_not_empty', () => {
    expect(conditionErrors(group({ field: 'internalNotes', operator: 'is_empty' }))).toEqual([]);
  });

  it('refuses a numeric operator on a text field, long and short names', () => {
    for (const operator of ['gt', 'lt', 'gte', 'lte', 'greater_than', 'less_than_or_equal']) {
      expect(conditionErrors(group({ field: 'productName', operator, value: '5' }))).toEqual([
        expect.stringMatching(/compares numbers, but "productName" is text/),
      ]);
    }
    expect(conditionErrors(group({ field: 'totalAmount', operator: 'gt', value: 5 }))).toEqual([]);
  });

  it('refuses an unknown field and checks nested groups', () => {
    const errors = conditionErrors(group({ logic: 'OR', rules: [{ field: 'nope', operator: 'equals', value: 'x' }] }));
    expect(errors).toEqual([expect.stringMatching(/"nope" is not a field of an order/)]);
    expect(conditionErrors(group({ field: 'customer.name', operator: 'equals', value: 'Ama' }))).toEqual([]);
  });

  it('leaves no conditions, empty conditions and the old key-value shape alone', () => {
    expect(conditionErrors(null)).toEqual([]);
    expect(conditionErrors({})).toEqual([]);
    expect(conditionErrors({ status: 'delivered' })).toEqual([]);
  });

  it('refuses more than 10 actions and the removed actions', () => {
    expect(actionErrors(Array.from({ length: MAX_ACTIONS }, () => ({ type: 'wait' })))).toEqual([]);
    expect(actionErrors(Array.from({ length: MAX_ACTIONS + 1 }, () => ({ type: 'wait' })))).toEqual([expect.stringMatching(/at most 10 actions/)]);
    expect(actionErrors([{ type: 'assign_agent' }, { type: 'add_tag' }])).toHaveLength(2);
  });

  it('throws 400 with every error in details', () => {
    try {
      assertValidWorkflow({ actions: [{ type: 'add_tag' }], conditions: group({ field: 'region', operator: 'is', value: '' }) });
      throw new Error('should not pass');
    } catch (e: any) {
      expect(e.statusCode).toBe(400);
      expect(e.details.errors).toHaveLength(2);
    }
  });

  it('lists the connections a template needs', () => {
    expect(templateConnections([{ type: 'send_whatsapp' }, { type: 'send_sms' }, { type: 'update_order' }, { type: 'send_whatsapp' }])).toEqual(['whatsapp', 'sms']);
  });
});
