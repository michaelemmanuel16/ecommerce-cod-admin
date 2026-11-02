import type { UserRole } from '@prisma/client';
import { PAY_METHODS } from '../validators/staffSchema';

/**
 * How a role of person can be paid (F-1158, F-1161). A delivery partner's fee is a fee rule (M5), not a field of the person,
 * so there is no amount to set. One rule for the invite, the staff edit, the fee-rule link and the role cards (`payPolicy`).
 */
export const payPolicyFor = (role: UserRole) => role === 'delivery_agent'
  ? { methods: ['fee_rule', 'none'] as const, defaultMethod: 'fee_rule' as const, amountEditable: false }
  : { methods: PAY_METHODS, defaultMethod: 'none' as const, amountEditable: true };
