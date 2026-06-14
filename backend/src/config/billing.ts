/** Canonical plan names — must match the `name` column in the `plans` table. */
export const PLAN_NAMES = {
  FREE: 'free',
  GROWTH: 'growth',
  SCALE: 'scale',
  ENTERPRISE: 'enterprise',
  // Legacy GHS tiers, deactivated by MAN-61 (kept for FK/history).
  STARTER: 'starter',
  PRO: 'pro',
} as const;

export type PlanName = (typeof PLAN_NAMES)[keyof typeof PLAN_NAMES];

/** Self-serve paid tiers a tenant can register onto via pricing-first signup. */
export const SELF_SERVE_PLAN_NAMES: PlanName[] = [PLAN_NAMES.GROWTH, PLAN_NAMES.SCALE];

/** Subscription lifecycle statuses stored on Tenant.subscriptionStatus. */
export const SUBSCRIPTION_STATUS = {
  ACTIVE: 'active',
  TRIALING: 'trialing',
  PENDING: 'pending', // registered, awaiting first successful charge
  PAST_DUE: 'past_due',
  CANCELLED: 'cancelled',
  SUSPENDED: 'suspended', // admin-suspended (platform tenant screen)
} as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUS)[keyof typeof SUBSCRIPTION_STATUS];
