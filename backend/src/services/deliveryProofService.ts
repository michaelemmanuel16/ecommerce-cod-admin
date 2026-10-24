/**
 * Delivery proof for the admin view (M4-T20; F-711, F-713). Recipient, time, cash collected, attempts and the photo.
 *
 * The photo is never sent as its stored address. The API gives a signed link that expires (10 minutes): an HMAC of
 * tenant, delivery and expiry, keyed with JWT_SECRET. The link is served by `GET /api/deliveries/proof-photo/:deliveryId`
 * (an <img> cannot send a bearer token). A stored upload is streamed from our disk; a stored object-storage address is
 * redirected to only when it is on our own storage host.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import prisma from '../utils/prisma';
import * as Money from '../utils/money';
import { fullName } from '../utils/nameUtils';
import { resolveTenantId } from '../utils/tenantContext';

export const PROOF_LINK_TTL_SECONDS = 10 * 60;

const sign = (tenantId: string, deliveryId: number, exp: number): string => {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET environment variable is required');
  return createHmac('sha256', process.env.JWT_SECRET).update(`proof-photo:${tenantId}:${deliveryId}:${exp}`).digest('hex');
};

/** Signed, expiring link to one delivery's photo. `now` is a test seam. */
export function signedProofPhotoUrl(delivery: { id: number; tenantId: string }, now: number = Date.now()): string {
  const exp = Math.floor(now / 1000) + PROOF_LINK_TTL_SECONDS;
  const query = new URLSearchParams({ t: delivery.tenantId, exp: String(exp), sig: sign(delivery.tenantId, delivery.id, exp) });
  return `/api/deliveries/proof-photo/${delivery.id}?${query.toString()}`;
}

/** True when the link's signature is ours and it has not expired. */
export function verifyProofPhotoLink(
  link: { deliveryId: number; tenantId: unknown; exp: unknown; sig: unknown },
  now: number = Date.now(),
): boolean {
  const { deliveryId, tenantId, exp, sig } = link;
  if (typeof tenantId !== 'string' || typeof sig !== 'string' || typeof exp !== 'string' || !/^\d{1,12}$/.test(exp)) return false;
  const expiry = Number(exp);
  if (expiry * 1000 < now) return false;
  const expected = Buffer.from(sign(tenantId, deliveryId, expiry), 'hex');
  const given = Buffer.from(sig, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export interface ProofBlock {
  /** False when nothing was recorded: the page shows "No proof recorded". */
  recorded: boolean;
  proofType: string | null;
  recipientName: string | null;
  recipientPhone: string | null;
  /** When the delivery was completed. */
  time: string | null;
  /** Cash taken on delivery, major units with 2 decimals; null when none was recorded. */
  cashCollected: string | null;
  /** Signed link that expires; null when there is no photo. */
  photoUrl: string | null;
}

export interface AttemptView {
  id: number;
  attemptedAt: string;
  reason: string | null;
  note: string | null;
  partner: { id: number; name: string };
}

/** The proof fields of a delivery as `getDeliveryByOrderId` returns them (time as an ISO string). */
export interface LoadedDelivery {
  id: number;
  proofType: string | null;
  proofData: unknown;
  proofImageUrl: string | null;
  recipientName: string | null;
  recipientPhone: string | null;
  actualDeliveryTime: string | null;
}

/** The proof block and the attempt list of one order. The order must already have been checked by the caller, which passes the delivery it loaded. */
export async function proofAndAttempts(orderId: number, delivery: LoadedDelivery): Promise<{ proof: ProofBlock; attempts: AttemptView[] }> {
  const [attempts, cod] = await Promise.all([
    prisma.deliveryAttempt.findMany({
      where: { orderId },
      orderBy: [{ attemptedAt: 'asc' }, { id: 'asc' }],
      include: { partner: { select: { id: true, firstName: true, lastName: true } } },
    }),
    prisma.transaction.findFirst({ where: { orderId, type: 'cod_collection', status: 'collected' }, select: { amount: true } }),
  ]);

  return {
    proof: {
      // An order with no delivery row reads all null here, so it is not recorded
      recorded: !!(delivery.proofImageUrl || delivery.proofData || delivery.recipientName || delivery.actualDeliveryTime),
      proofType: delivery.proofType,
      recipientName: delivery.recipientName,
      recipientPhone: delivery.recipientPhone,
      time: delivery.actualDeliveryTime,
      cashCollected: cod ? Money.toApi(cod.amount) : null,
      photoUrl: delivery.proofImageUrl ? signedProofPhotoUrl({ id: delivery.id, tenantId: resolveTenantId() }) : null,
    },
    attempts: attempts.map((a) => ({
      id: a.id,
      attemptedAt: a.attemptedAt.toISOString(),
      reason: a.reason,
      note: a.note,
      partner: { id: a.partner.id, name: fullName(a.partner) },
    })),
  };
}

export interface OrderProofSummary {
  orderId: number;
  photoUrl: string | null;
  attemptCount: number;
}

/**
 * The photo link and the attempt count of several orders in one read, for the partner drawer list. Only orders of this partner
 * come back (an id of another partner, another tenant or no order is left out). `/by-order/:orderId` stays the full detail.
 */
export async function proofSummaries(partnerId: number, orderIds: number[]): Promise<OrderProofSummary[]> {
  const orders = await prisma.order.findMany({
    where: { id: { in: orderIds }, deliveryAgentId: partnerId },
    select: { id: true, delivery: { select: { id: true, proofImageUrl: true } } },
    orderBy: { id: 'asc' },
  });
  const ids = orders.map((o) => o.id);
  const counts = await prisma.deliveryAttempt.groupBy({ by: ['orderId'], where: { orderId: { in: ids } }, _count: { _all: true } });
  const attemptsOf = new Map(counts.map((c) => [c.orderId, c._count._all]));
  const tenantId = resolveTenantId();
  return orders.map((o) => ({
    orderId: o.id,
    photoUrl: o.delivery?.proofImageUrl ? signedProofPhotoUrl({ id: o.delivery.id, tenantId }) : null,
    attemptCount: attemptsOf.get(o.id) ?? 0,
  }));
}
