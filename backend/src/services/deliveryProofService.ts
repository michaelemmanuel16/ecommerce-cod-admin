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

/** The proof block and the attempt list of one order. The order must already have been checked by the caller. */
export async function proofAndAttempts(orderId: number): Promise<{ proof: ProofBlock; attempts: AttemptView[] }> {
  const [delivery, attempts, cod] = await Promise.all([
    prisma.delivery.findUnique({
      where: { orderId },
      select: { id: true, tenantId: true, proofType: true, proofImageUrl: true, proofData: true, recipientName: true, recipientPhone: true, actualDeliveryTime: true },
    }),
    prisma.deliveryAttempt.findMany({
      where: { orderId },
      orderBy: [{ attemptedAt: 'asc' }, { id: 'asc' }],
      include: { partner: { select: { id: true, firstName: true, lastName: true } } },
    }),
    prisma.transaction.findFirst({ where: { orderId, type: 'cod_collection', status: 'collected' }, select: { amount: true } }),
  ]);

  const hasPhoto = !!delivery?.proofImageUrl && !!delivery.tenantId;
  const recorded = !!delivery && !!(delivery.proofImageUrl || delivery.proofData || delivery.recipientName || delivery.actualDeliveryTime);
  return {
    proof: {
      recorded,
      proofType: delivery?.proofType ?? null,
      recipientName: delivery?.recipientName ?? null,
      recipientPhone: delivery?.recipientPhone ?? null,
      time: delivery?.actualDeliveryTime?.toISOString() ?? null,
      cashCollected: cod ? Money.toApi(cod.amount) : null,
      photoUrl: hasPhoto ? signedProofPhotoUrl({ id: delivery!.id, tenantId: delivery!.tenantId! }) : null,
    },
    attempts: attempts.map((a) => ({
      id: a.id,
      attemptedAt: a.attemptedAt.toISOString(),
      reason: a.reason,
      note: a.note,
      partner: { id: a.partner.id, name: `${a.partner.firstName} ${a.partner.lastName}`.trim() },
    })),
  };
}
