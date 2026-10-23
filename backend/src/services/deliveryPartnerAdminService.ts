/**
 * Delivery partners, write side (M4-T19; F-707, F-708, F-709).
 *
 * A partner is a `delivery_agent` user (kind person or company) with a StockLocation and a DeliveryPartnerProfile.
 * Create makes all three in one transaction. The user comes from adminService.createUser (the Staff modal swaps in at M6).
 * There is no coverage route and no fallback flag (decision O4). Fee rules are M5.
 */
import { randomBytes } from 'crypto';
import { PartnerDataSource, Prisma, UserKind } from '@prisma/client';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { Requester, isManagerUp } from '../utils/authUtils';
import { resolveTenantId } from '../utils/tenantContext';
import { getSocketInstance } from '../utils/socketInstance';
import { emitToTenant } from '../sockets';
import { adminService } from './adminService';
import { auditService } from './auditService';
import { DEFAULT_DAYS_TO_PAY } from './orderPaymentTag';
import { partnerTypeOf, type PartnerType } from './deliveryPartnerService';
import * as Money from '../utils/money';

/** Vehicle types the Staff person modal offers (F-707). */
export const VEHICLE_TYPES = ['Motorbike', 'Car', 'Tricycle', 'Bicycle', 'On foot'] as const;

/** Old values map to the new list (F-707): Motorcycle is Motorbike; Van and Truck are Car. Null for a value that fits none. */
export function normalizeVehicleType(value: string | null | undefined): string | null {
  const text = (value ?? '').trim().toLowerCase();
  if (!text) return null;
  if (text === 'motorcycle') return 'Motorbike';
  if (text === 'van' || text === 'truck') return 'Car';
  return VEHICLE_TYPES.find((v) => v.toLowerCase() === text) ?? null;
}

const requireVehicleType = (value: string): string => {
  const mapped = normalizeVehicleType(value);
  if (!mapped) throw new AppError(`Vehicle type must be one of: ${VEHICLE_TYPES.join(', ')}`, 400, 'INVALID_VEHICLE_TYPE');
  return mapped;
};

export interface CreatePartnerInput {
  kind: 'person' | 'company';
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber?: string;
  /** A person who signs in to the agent app sets one. Without it the account gets a random password nobody knows. */
  password?: string;
  baseTown?: string;
  daysToPay?: number;
  isTrial?: boolean;
  dataSource?: PartnerDataSource;
  vehicleType?: string;
  vehicleId?: string;
}

const clean = (v: string | undefined) => (v ?? '').trim();

/** Maps a unique-constraint failure to a plain 409. */
function conflictOf(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    const target = String(error.meta?.target ?? '');
    if (target.includes('email')) return new AppError('A user with this email already exists', 409, 'EMAIL_EXISTS');
    if (target.includes('name')) return new AppError('A stock location with this name already exists', 409, 'LOCATION_EXISTS');
    return new AppError('This partner already exists', 409, 'PARTNER_EXISTS');
  }
  return error;
}

export async function createPartner(requester: Requester, input: CreatePartnerInput) {
  const firstName = clean(input.firstName);
  const lastName = clean(input.lastName);
  if (!firstName) throw new AppError('First name is required', 400);
  if (input.kind !== 'person' && input.kind !== 'company') throw new AppError('Kind must be person or company', 400);
  const vehicleType = input.vehicleType ? requireVehicleType(input.vehicleType) : undefined;
  const daysToPay = input.daysToPay ?? DEFAULT_DAYS_TO_PAY;
  if (!Number.isInteger(daysToPay) || daysToPay < 0 || daysToPay > 365) throw new AppError('Days to pay must be a whole number from 0 to 365', 400);

  const tenantId = resolveTenantId();
  const type: PartnerType = partnerTypeOf(input.kind as UserKind);
  const name = `${firstName} ${lastName}`.trim();

  try {
    return await prisma.$transaction(async (tx) => {
      const user = (await adminService.createUser(requester, {
        email: clean(input.email),
        password: input.password ?? randomBytes(24).toString('base64url'),
        firstName,
        lastName,
        phoneNumber: clean(input.phoneNumber) || undefined,
        role: 'delivery_agent',
        kind: input.kind,
        vehicleType,
        vehicleId: clean(input.vehicleId) || undefined,
        tx,
      })) as unknown as { id: number; email: string; firstName: string; lastName: string };
      const location = await tx.stockLocation.create({
        data: { tenantId, type: type === '3pl' ? 'partner_3pl' : 'agent', name, userId: user.id },
      });
      const profile = await tx.deliveryPartnerProfile.create({
        data: {
          tenantId,
          userId: user.id,
          daysToPay,
          isTrial: input.isTrial ?? false,
          // A person with a login uses the app; a company sends a file (F-700, F-708)
          dataSource: input.dataSource ?? (input.kind === 'company' ? 'csv' : 'app'),
          baseTown: clean(input.baseTown) || null,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId, userId: requester.id, actorKind: 'person', channel: 'app',
          action: 'create', resource: 'delivery_partner', resourceId: String(user.id),
          metadata: { kind: input.kind, locationId: location.id },
        },
      });
      return { user, location, profile, type };
    });
  } catch (error) {
    throw conflictOf(error);
  }
}

export interface UpdatePartnerInput {
  daysToPay?: number;
  isTrial?: boolean;
  dataSource?: PartnerDataSource;
  baseTown?: string | null;
  vehicleType?: string;
  vehicleId?: string | null;
}

async function loadPartner(partnerId: number) {
  const user = await prisma.user.findFirst({
    where: { id: partnerId, role: 'delivery_agent', kind: { in: ['person', 'company'] } },
    select: {
      id: true, firstName: true, lastName: true, email: true, phoneNumber: true, kind: true, isActive: true, isAvailable: true,
      vehicleType: true, vehicleId: true,
      partnerProfile: true,
      stockLocations: { select: { id: true, name: true, type: true, isActive: true }, take: 1 },
    },
  });
  if (!user) throw new AppError('Delivery partner not found', 404);
  return user;
}

/** One partner with its profile and stock location. Fee rules are added by the caller when the role may see money. */
export async function getPartner(partnerId: number, opts: { showMoney: boolean }) {
  const user = await loadPartner(partnerId);
  const profile = user.partnerProfile;
  const feeRules = opts.showMoney ? await prisma.feeRule.findMany({ where: { partnerUserId: partnerId } }) : null;
  const feeRule = feeRules
    ? feeRules.reduce<Record<string, string | null>>((acc, r) => ({ ...acc, [r.outcome]: Money.toApi(r.amount) }), { delivered: null, failed: null, returned: null })
    : undefined;
  return {
    id: user.id,
    name: `${user.firstName} ${user.lastName}`.trim(),
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phoneNumber: user.phoneNumber,
    kind: user.kind,
    type: partnerTypeOf(user.kind),
    isActive: user.isActive,
    isAvailable: user.isAvailable,
    vehicleType: normalizeVehicleType(user.vehicleType),
    vehicleId: user.vehicleId,
    profile: {
      daysToPay: profile?.daysToPay ?? DEFAULT_DAYS_TO_PAY,
      isTrial: profile?.isTrial ?? false,
      dataSource: profile?.dataSource ?? (user.kind === 'company' ? 'csv' : 'app'),
      baseTown: profile?.baseTown ?? null,
    },
    stockLocation: user.stockLocations[0] ?? null,
    ...(feeRule ? { feeRule } : {}),
  };
}

/** Profile fields and the vehicle. Name, phone, pay and login are edited in the Staff modal. A partner with no profile gets one. */
export async function updatePartner(requester: Requester, partnerId: number, input: UpdatePartnerInput) {
  const before = await loadPartner(partnerId);
  if (input.daysToPay !== undefined && (!Number.isInteger(input.daysToPay) || input.daysToPay < 0 || input.daysToPay > 365)) {
    throw new AppError('Days to pay must be a whole number from 0 to 365', 400);
  }
  const vehicleType = input.vehicleType === undefined ? undefined : requireVehicleType(input.vehicleType);
  const tenantId = resolveTenantId();

  const profileData = {
    ...(input.daysToPay !== undefined && { daysToPay: input.daysToPay }),
    ...(input.isTrial !== undefined && { isTrial: input.isTrial }),
    ...(input.dataSource !== undefined && { dataSource: input.dataSource }),
    ...(input.baseTown !== undefined && { baseTown: clean(input.baseTown ?? '') || null }),
  };
  const userData = {
    ...(vehicleType !== undefined && { vehicleType }),
    ...(input.vehicleId !== undefined && { vehicleId: clean(input.vehicleId ?? '') || null }),
  };

  await prisma.$transaction(async (tx) => {
    if (Object.keys(profileData).length > 0) {
      await tx.deliveryPartnerProfile.upsert({
        where: { userId: partnerId },
        update: profileData,
        create: {
          tenantId, userId: partnerId,
          daysToPay: DEFAULT_DAYS_TO_PAY,
          dataSource: before.kind === 'company' ? 'csv' : 'app',
          ...profileData,
        },
      });
    }
    if (Object.keys(userData).length > 0) await tx.user.update({ where: { id: partnerId }, data: userData });
    await tx.auditLog.create({
      data: {
        tenantId, userId: requester.id, actorKind: 'person', channel: 'app',
        action: 'update', resource: 'delivery_partner', resourceId: String(partnerId),
        metadata: { changes: [...Object.keys(profileData), ...Object.keys(userData)] },
      },
    });
  });
  return getPartner(partnerId, { showMoney: false });
}

/**
 * The availability switch (F-709). An unavailable partner is skipped by assignment. Emits `agent:availability_changed`
 * to the tenant with { agentId, isAvailable } (the shape the Deliveries store listens for). Open orders do not move.
 */
export async function setPartnerAvailability(requester: Requester, partnerId: number, isAvailable: boolean) {
  if (typeof isAvailable !== 'boolean') throw new AppError('isAvailable must be true or false', 400);
  if (requester.id !== partnerId && !isManagerUp(requester)) {
    throw new AppError('You can only change your own availability', 403);
  }
  const user = await prisma.user.findFirst({ where: { id: partnerId, role: 'delivery_agent' }, select: { id: true, isAvailable: true } });
  if (!user) throw new AppError('Delivery partner not found', 404);

  await prisma.user.update({ where: { id: partnerId }, data: { isAvailable } });
  announceAvailability(partnerId, isAvailable);
  if (user.isAvailable !== isAvailable) {
    await auditService.record({
      actorId: requester.id, actorKind: 'person', channel: 'app',
      action: 'update', resource: 'delivery_partner', resourceId: String(partnerId),
      before: { isAvailable: user.isAvailable }, after: { isAvailable },
    });
  }
  return { id: partnerId, isAvailable };
}

/** Tells the tenant's open screens that a delivery agent's availability changed. */
export function announceAvailability(agentId: number, isAvailable: boolean): void {
  const io = getSocketInstance();
  if (io) emitToTenant(io, 'agent:availability_changed', { agentId: String(agentId), isAvailable });
}
