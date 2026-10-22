import crypto from 'crypto';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { Requester } from '../utils/authUtils';
import { currencyForCountry } from '../utils/currency';
import { changeStoreCurrency } from './fxService';
import { adminService } from './adminService';
import { normalizeInternationalPhone } from '../utils/phone';

export interface StoreInput {
  businessName?: string;
  country?: string;
  currency?: string;
  businessEmail?: string;
  businessPhone?: string;
  businessAddress?: string;
  taxId?: string;
}

export interface PartnerInput {
  name?: string;
  type?: string;
  email?: string;
  phone?: string;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** Step 1 "Your store" (F-124): picking the country sets the store currency (O3); the currency can change later (O6). */
export async function saveStore(tenantId: string, input: StoreInput) {
  const country = str(input.country);
  const businessName = str(input.businessName);
  let storeCurrency = str(input.currency);
  if (country) {
    const countryCurrency = currencyForCountry(country);
    if (!countryCurrency) throw new AppError('Unknown country', 400, 'INVALID_COUNTRY');
    storeCurrency = storeCurrency ?? countryCurrency;
  }

  const tenant = await prisma.tenant.update({
    where: { id: tenantId },
    data: { ...(country && { region: country }), ...(businessName && { name: businessName }) },
  });
  // Saves the code and fetches rates for the new pairs; a provider outage does not fail onboarding.
  if (storeCurrency) tenant.currency = await changeStoreCurrency(tenantId, storeCurrency);

  const details = {
    businessName: businessName ?? tenant.name,
    ...(str(input.businessEmail) && { businessEmail: str(input.businessEmail) }),
    ...(str(input.businessPhone) && { businessPhone: str(input.businessPhone) }),
    ...(str(input.businessAddress) && { businessAddress: str(input.businessAddress) }),
    ...(str(input.taxId) && { taxId: str(input.taxId) }),
  };
  await prisma.systemConfig.upsert({
    where: { tenantId },
    update: details,
    create: { ...details, tenantId },
  });
  return tenant;
}

/**
 * Step 2 "Connect your 3PL" (F-124): the first delivery partner, created through the user service.
 * Both types are `delivery_agent` users; `User.kind` (company) arrives with the Deliveries work in M4, so the
 * type is kept in preferences until then. No StockLocation yet (M4).
 */
export async function addPartner(requester: Requester, input: PartnerInput) {
  const name = str(input.name);
  const email = str(input.email);
  if (!name) throw new AppError('Partner name is required', 400);
  if (!email) throw new AppError('Partner email is required', 400);
  const type = input.type === undefined ? 'agent' : input.type;
  if (type !== '3pl' && type !== 'agent') throw new AppError('Partner type must be 3pl or agent', 400);
  const phone = str(input.phone);
  if (phone && !normalizeInternationalPhone(phone) && !/^[\d\s\-+().]{7,20}$/.test(phone)) {
    throw new AppError('Partner phone is not valid', 400);
  }

  const [firstName, ...rest] = name.split(/\s+/);
  const created = (await adminService.createUser(requester, {
    email: email.toLowerCase(),
    // Nobody knows this password; the partner sets one with "Forgot password" if they ever sign in.
    password: crypto.randomBytes(18).toString('base64url'),
    firstName,
    lastName: rest.join(' ') || firstName,
    phoneNumber: phone,
    role: 'delivery_agent',
  })) as unknown as { id: number };
  const updated = await prisma.user.update({ where: { id: created.id }, data: { preferences: { partnerType: type } } });
  return { id: updated.id, email: updated.email, firstName: updated.firstName, lastName: updated.lastName, role: updated.role, partnerType: type };
}

/** Done state of each wizard step. Steps 3 to 6 belong to the North Star setup (area 12). */
export async function getStatus(tenantId: string, userId: number) {
  const [tenant, config, partners, owner] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { region: true, currency: true } }),
    prisma.systemConfig.findUnique({ where: { tenantId }, select: { businessName: true } }),
    prisma.user.count({ where: { tenantId, role: 'delivery_agent' } }),
    prisma.user.findUnique({ where: { id: userId }, select: { preferences: true } }),
  ]);
  const prefs = (owner?.preferences as Record<string, any> | null) ?? {};
  return {
    onboardingCompleted: prefs.onboardingCompleted ?? false,
    country: tenant?.region ?? null,
    currency: tenant?.currency ?? null,
    steps: [
      { step: 1, key: 'store', done: !!tenant?.region && !!config?.businessName },
      { step: 2, key: 'partner', done: partners > 0, skipped: prefs.onboardingPartnerSkipped === true },
    ],
  };
}

/** Merge keys into the signed-in user's preferences (wizard progress lives there). */
export async function setOwnerPrefs(userId: number, patch: Record<string, unknown>) {
  const row = await prisma.user.findUnique({ where: { id: userId }, select: { preferences: true } });
  await prisma.user.update({
    where: { id: userId },
    data: { preferences: { ...((row?.preferences as Record<string, unknown> | null) ?? {}), ...patch } },
  });
}
