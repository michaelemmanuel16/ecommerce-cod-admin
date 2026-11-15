import { AppError } from '../middleware/errorHandler';

/**
 * What a workflow must pass at save (M9-T25, F-508, F-509). Every problem is listed, one clear message each,
 * and the save is refused with 400 and `errors: string[]` in the body.
 */

export const MAX_ACTIONS = 10;
/** Actions the editor no longer offers. Old workflows were rewritten by the T25 migration. */
export const REMOVED_ACTIONS: Record<string, string> = {
  assign_agent: 'use "Assign to" (assign_to) instead',
  add_tag: 'use "Update order" (update_order) instead',
};

/** Condition fields that hold a number. */
const NUMERIC_FIELDS = new Set([
  'subtotal', 'shippingCost', 'discount', 'totalAmount', 'codAmount', 'depositPaid', 'balanceDue', 'deliveryFee',
  'landedCostTotal', 'priority', 'quantity', 'itemCount', 'paymentAmount',
]);
/** Condition fields that hold text. */
const TEXT_FIELDS = new Set([
  'status', 'oldStatus', 'newStatus', 'paymentStatus', 'currency', 'orderType', 'paymentMethod', 'paymentProvider', 'paymentReference',
  'deliveryAddress', 'deliveryState', 'deliveryArea', 'region', 'source', 'internalNotes', 'productName', 'products',
  'customerName', 'customerPhone', 'orderNumber', 'customerResponse', 'declineReason', 'failureReason', 'paymentProvider',
]);
/** Ids, flags and dates: any operator may be tried on them. */
const OTHER_FIELDS = new Set([
  'id', 'orderId', 'customerId', 'customerRepId', 'deliveryAgentId', 'isTest', 'requiresManualCall', 'saidNo',
  'createdAt', 'updatedAt', 'confirmedAt', 'dispatchedAt', 'deliveryDate', 'estimatedDelivery', 'nextAttemptDate',
]);
/** A path into the customer, the item list or the webhook body. */
const NESTED_PREFIXES = ['customer.', 'orderItems.', 'data.'];

/** The long names the evaluator reads and the short ones the editor sends (`gt`, `lt`, `gte`, `lte`). */
const NUMERIC_OPERATORS = new Set(['greater_than', 'less_than', 'greater_than_or_equal', 'less_than_or_equal', 'gt', 'lt', 'gte', 'lte']);
const NO_VALUE_OPERATORS = new Set(['is_empty', 'is_not_empty']);

const isEmptyValue = (value: unknown) =>
  value === undefined || value === null || (typeof value === 'string' && value.trim() === '') || (Array.isArray(value) && value.length === 0);

function checkRule(rule: any, path: string, errors: string[]) {
  const label = `Condition ${path}`;
  const field = rule?.field;
  if (typeof field !== 'string' || field.trim() === '') {
    errors.push(`${label}: pick a field`);
    return;
  }
  const known = NUMERIC_FIELDS.has(field) || TEXT_FIELDS.has(field) || OTHER_FIELDS.has(field) || NESTED_PREFIXES.some((p) => field.startsWith(p));
  if (!known) errors.push(`${label}: "${field}" is not a field of an order`);
  const operator = rule?.operator;
  if (typeof operator !== 'string' || operator === '') {
    errors.push(`${label}: pick an operator`);
    return;
  }
  if (TEXT_FIELDS.has(field) && NUMERIC_OPERATORS.has(operator)) {
    errors.push(`${label}: "${operator}" compares numbers, but "${field}" is text`);
  }
  if (!NO_VALUE_OPERATORS.has(operator) && isEmptyValue(rule?.value)) {
    errors.push(`${label}: enter a value for "${field}"`);
  }
}

function walk(group: any, path: string, errors: string[]) {
  for (const [i, item] of (group.rules as any[]).entries()) {
    const here = `${path}${i + 1}`;
    if (item && Array.isArray(item.rules)) walk(item, `${here}.`, errors);
    else checkRule(item, here, errors);
  }
}

/** The problems in a conditions object. The old key-value shape (no `rules`) is left alone. */
export function conditionErrors(conditions: any): string[] {
  const errors: string[] = [];
  if (conditions && typeof conditions === 'object' && Array.isArray(conditions.rules)) walk(conditions, '', errors);
  return errors;
}

/** Action count and removed action types. */
export function actionErrors(actions: any[]): string[] {
  const errors: string[] = [];
  if (Array.isArray(actions) && actions.length > MAX_ACTIONS) {
    errors.push(`A workflow can have at most ${MAX_ACTIONS} actions (this one has ${actions.length})`);
  }
  for (const [i, action] of (Array.isArray(actions) ? actions : []).entries()) {
    const hint = REMOVED_ACTIONS[action?.type];
    if (hint) errors.push(`Action ${i + 1}: "${action.type}" is no longer available, ${hint}`);
  }
  return errors;
}

/** Throws 400 listing every problem; `errors` is in the response body. */
export function assertValidWorkflow(parts: { actions?: any[]; conditions?: any }): void {
  const errors = [
    ...(parts.actions !== undefined ? actionErrors(parts.actions) : []),
    ...(parts.conditions !== undefined ? conditionErrors(parts.conditions) : []),
  ];
  if (errors.length === 0) return;
  const error = new AppError(errors.join('. '), 400, 'WORKFLOW_INVALID');
  error.details = { errors };
  throw error;
}
