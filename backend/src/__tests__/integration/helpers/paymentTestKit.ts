import { prismaBase } from '../../../utils/prisma';
import type { TwoTenants } from './twoTenants';

/**
 * Shared by the payment webhook and payment hook suites (COD-32).
 * Mocks, as plain-function factories (resetMocks would wipe a jest.fn):
 *   jest.mock('../../services/metaCapiService', () => require('./helpers/paymentTestKit').metaCapiMock());
 */
export const metaCapiMock = () => ({
  metaCapiService: { fireCapiPurchaseEvent: () => Promise.resolve() },
});

let refSeq = 0;
let ipSeq = 1;

/** A payment reference no other test uses. */
export const newRef = (label: string) => `ref_${label}_${Date.now()}_${refSeq++}`;

/** A fresh client address per call, so the rate limiter never trips. */
export const ip = () => `10.9.${ipSeq++ % 250}.${ipSeq % 250}`;

export interface PendingOptions {
  total?: string;
  chargeMinor?: number;
  method?: string;
  orderType?: 'physical' | 'digital';
  currency?: string;
  status?: string;
  ageMinutes?: number;
  provider?: string;
  codAmount?: string;
  balanceDue?: string;
  productId?: number;
  lastCheckedMinutesAgo?: number;
}

/** A PendingCheckout row the way publicOrderController writes it, for one side of the two-tenant harness. */
export async function seedPending(pair: TwoTenants, side: 'a' | 'b', reference: string, o: PendingOptions = {}) {
  const t = pair[side];
  return prismaBase.pendingCheckout.create({
    data: {
      reference,
      tenantId: t.id,
      provider: o.provider ?? 'fake',
      customerId: t.ids.customer,
      formId: t.ids.checkoutForm,
      paymentMethod: o.method ?? 'online_full',
      orderType: o.orderType ?? 'physical',
      currency: o.currency ?? 'GHS',
      subtotal: o.total ?? '50',
      totalAmount: o.total ?? '50',
      codAmount: o.codAmount ?? '0',
      balanceDue: o.balanceDue ?? '0',
      paystackChargeMinor: o.chargeMinor ?? 5000,
      orderItems: [{ productId: o.productId ?? t.ids.product, quantity: 1, unitPrice: o.total ?? '50', totalPrice: o.total ?? '50', itemType: 'package' }],
      formData: { name: 'Ama Mensah', phoneNumber: t.phone, address: '1 Test St', state: 'Greater Accra', town: 'Osu' },
      selectedPackage: { name: 'One' },
      status: o.status ?? 'initiated',
      createdAt: new Date(Date.now() - (o.ageMinutes ?? 0) * 60_000),
      ...(o.lastCheckedMinutesAgo !== undefined ? { lastCheckedAt: new Date(Date.now() - o.lastCheckedMinutesAgo * 60_000) } : {}),
    },
  });
}
