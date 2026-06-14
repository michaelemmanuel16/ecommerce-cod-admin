import apiClient from './api';

export interface BillingPlan {
  id: string;
  name: string;
  displayName: string;
  maxOrders: number | null;
  maxUsers: number | null;
  priceGHS: number;
  priceNGN: number | null;
  paystackPlanCode: string | null;
  features: Record<string, boolean>;
  isActive: boolean;
}

export interface Subscription {
  plan: BillingPlan | null;
  subscriptionStatus: string;
  trialEndsAt: string | null;
  subscriptionCode: string | null;
  renewsAt: string | null;
  paymentFailedAt: string | null;
  cardLast4: string | null;
  freeAccessExpiresAt: string | null;
  nextChargeAmount: number | null;
  billingEnabled: boolean;
  usage: {
    ordersThisMonth: number;
    maxOrders: number | null;
  };
}

export const billingService = {
  getPlans: () =>
    apiClient.get<{ plans: BillingPlan[] }>('/api/billing/plans').then((r) => r.data.plans),

  getSubscription: () =>
    apiClient.get<Subscription>('/api/billing/subscription').then((r) => r.data),

  /** Start a Paystack subscription for the chosen tier; returns the redirect URL. */
  startSubscription: (planName: string) =>
    apiClient
      .post<{ authorizationUrl: string; reference: string }>('/api/billing/start-subscription', { planName })
      .then((r) => r.data),

  verifySubscription: (reference: string) =>
    apiClient
      .get<{ status: string }>(`/api/billing/verify-subscription/${encodeURIComponent(reference)}`)
      .then((r) => r.data),

  cancelSubscription: () =>
    apiClient
      .post<{ status: string; accessUntil: string | null }>('/api/billing/cancel-subscription')
      .then((r) => r.data),
};
