import { CustomerRiskLevel } from '@prisma/client';

export const REFUSALS_HIGH_RISK = 2;
export const REFUSALS_COD_BLOCKED = 3;

/**
 * M7-T06 (COD-64, F-357).
 * Refusal rule:
 * 1 refusal: no change (normal risk, not blocked)
 * 2 refusals: riskLevel = high
 * 3 refusals: codBlocked = true
 */
export function riskLevelOf(refusedOrders: number): CustomerRiskLevel {
  return refusedOrders >= REFUSALS_HIGH_RISK ? 'high' : 'normal';
}

export function isCodBlocked(customer: {
  codBlocked?: boolean | null;
  refusedOrders?: number | null;
  codOverride?: boolean | null;
  codOverrideAt?: Date | null;
} | null | undefined): boolean {
  if (!customer) return false;
  if (customer.codBlocked !== undefined && customer.codBlocked !== null) {
    return Boolean(customer.codBlocked);
  }
  if (customer.codOverride === true) return false;
  if (customer.codOverrideAt && customer.codOverride === false) return true;
  return typeof customer.refusedOrders === 'number' && customer.refusedOrders >= REFUSALS_COD_BLOCKED;
}

/**
 * Helper for lane A and order creation.
 * Returns true if customer is COD-blocked, requiring a manual call first
 * and skipping auto-confirm.
 */
export function customerNeedsManualCall(customer: {
  codBlocked?: boolean | null;
  riskLevel?: CustomerRiskLevel | string | null;
  refusedOrders?: number | null;
  codOverride?: boolean | null;
  codOverrideAt?: Date | null;
} | null | undefined): boolean {
  return isCodBlocked(customer);
}
