import { Response } from 'express';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { hasPermission } from '../middleware/auth';
import { resolveTenantId } from '../utils/tenantContext';
import { invalidRange, readId, readRange } from '../utils/kpiRequest';
import { getStoreTimeZone, localDate, monthRange } from '../services/kpi/dates';
import {
  failureReasonBreakdown, listPartners, partnerSummary, waitingList, PartnerTypeFilter,
} from '../services/deliveryPartnerService';
import {
  createPartner, getPartner, setPartnerAvailability, updatePartner,
} from '../services/deliveryPartnerAdminService';
import { createFeeRule, createFeeRules, listFeeRules } from '../services/feeRuleService';
import { unmappedRegions } from '../services/regionService';
import { proofSummaries } from '../services/deliveryProofService';

/** Money (fee rules, revenue, order totals) shows only to a role with financial:view (the M3 permission matrix). */
const canSeeMoney = (req: AuthRequest) => hasPermission(req.user!, 'financial', 'view');

/** The range from `from` and `to` (store-zone days, `to` inclusive); both absent means this month (F-710). */
function rangeOf(req: AuthRequest, tenantId: string): { from: Date; to: Date } {
  if (req.query.from === undefined && req.query.to === undefined) {
    const zone = getStoreTimeZone(tenantId);
    const [year, month] = localDate(new Date(), zone).split('-').map(Number);
    return monthRange(year, month, zone);
  }
  return readRange(req, tenantId);
}

const partnerIdOf = (req: AuthRequest): number => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid partner ID', 400);
  return id;
};

/** GET /api/delivery-partners?from&to&type=all|agent|3pl */
export const list = async (req: AuthRequest, res: Response): Promise<void> => {
  const tenantId = resolveTenantId();
  const type = (req.query.type ?? 'all') as string;
  if (!['all', 'agent', '3pl'].includes(type)) throw invalidRange('type must be all, agent or 3pl');
  const { from, to } = rangeOf(req, tenantId);
  res.json(await listPartners(tenantId, from, to, { type: type as PartnerTypeFilter, showMoney: await canSeeMoney(req) }));
};

/** GET /api/delivery-partners/summary?from&to */
export const summary = async (req: AuthRequest, res: Response): Promise<void> => {
  const tenantId = resolveTenantId();
  const { from, to } = rangeOf(req, tenantId);
  res.json(await partnerSummary(tenantId, from, to, { showMoney: await canSeeMoney(req) }));
};

/** GET /api/delivery-partners/waiting */
export const waiting = async (req: AuthRequest, res: Response): Promise<void> => {
  const limit = req.query.limit === undefined ? undefined : Number(req.query.limit);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 500)) throw invalidRange('limit must be a whole number from 1 to 500');
  res.json(await waitingList(resolveTenantId(), { limit, showMoney: await canSeeMoney(req) }));
};

/** GET /api/delivery-partners/failure-reasons?from&to&partnerId */
export const failureReasons = async (req: AuthRequest, res: Response): Promise<void> => {
  const tenantId = resolveTenantId();
  const { from, to } = rangeOf(req, tenantId);
  const partnerId = readId(req.query.partnerId, 'partnerId');
  res.json(await failureReasonBreakdown(tenantId, from, to, partnerId));
};

/** GET /api/delivery-partners/region-review: order regions that are not in the store country's list (O3). */
export const regionReview = async (_req: AuthRequest, res: Response): Promise<void> => {
  res.json({ regions: await unmappedRegions() });
};

/** GET /api/delivery-partners/:id */
export const getOne = async (req: AuthRequest, res: Response): Promise<void> => {
  res.json({ partner: await getPartner(partnerIdOf(req), { showMoney: await canSeeMoney(req) }) });
};

const MAX_PROOF_ORDERS = 50;

/** GET /api/delivery-partners/:id/order-proofs?orderIds=1,2,3 (up to 50): photo link and attempt count of this partner's orders. */
export const orderProofs = async (req: AuthRequest, res: Response): Promise<void> => {
  const partnerId = partnerIdOf(req);
  const ids = String(req.query.orderIds ?? '').split(',').filter(Boolean).map(Number);
  if (ids.length === 0 || ids.some((n) => !Number.isInteger(n) || n <= 0)) throw new AppError('orderIds must be order IDs separated by commas', 400);
  if (ids.length > MAX_PROOF_ORDERS) throw new AppError(`orderIds takes at most ${MAX_PROOF_ORDERS} orders`, 400);
  res.json({ proofs: await proofSummaries(partnerId, ids) });
};

/** POST /api/delivery-partners */
export const create = async (req: AuthRequest, res: Response): Promise<void> => {
  const created = await createPartner(req.user!, req.body);
  res.status(201).json({ partner: await getPartner(created.user.id, { showMoney: await canSeeMoney(req), isNew: true }) });
};

/** PATCH /api/delivery-partners/:id */
export const update = async (req: AuthRequest, res: Response): Promise<void> => {
  const id = partnerIdOf(req);
  await updatePartner(req.user!, id, req.body);
  res.json({ partner: await getPartner(id, { showMoney: await canSeeMoney(req) }) });
};

/** PATCH /api/delivery-partners/:id/availability */
export const availability = async (req: AuthRequest, res: Response): Promise<void> => {
  res.json({ partner: await setPartnerAvailability(req.user!, partnerIdOf(req), req.body?.isAvailable) });
};

/** GET /api/delivery-partners/:id/fee-rules: rule history and the rule in force today per outcome (F-703). */
export const feeRules = async (req: AuthRequest, res: Response): Promise<void> => {
  res.json(await listFeeRules(partnerIdOf(req)));
};

/** POST /api/delivery-partners/:id/fee-rules: one rule for one outcome, or `{ rules: [...] }` for several together, valid from a date (F-703). */
export const addFeeRule = async (req: AuthRequest, res: Response): Promise<void> => {
  // `{ rules: [...] }` saves the changed outcomes together and answers with the list as GET gives it; one rule keeps the old shape
  if (Array.isArray(req.body?.rules)) {
    res.status(201).json(await createFeeRules(req.user!, partnerIdOf(req), req.body.rules));
    return;
  }
  res.status(201).json({ rule: await createFeeRule(req.user!, partnerIdOf(req), req.body ?? {}) });
};
