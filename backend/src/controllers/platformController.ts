import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../types';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import * as platformService from '../services/platformService';

const createTenantSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(2).max(100).regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'Slug must be lowercase alphanumeric with hyphens, min 2 chars'),
  planName: z.string().optional(),
  region: z.string().max(100).optional(),
  currency: z.string().max(10).optional(),
});

const updateTenantSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  slug: z.string().min(2).max(100).regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/).optional(),
  region: z.string().max(100).optional(),
  currency: z.string().max(10).optional(),
  currentPlanId: z.string().uuid().optional(),
  rateLimitEnabled: z.boolean().optional(),
  rateLimitConfig: z.object({
    requestsPer15Min: z.number().int().min(1),
    burstPerSec: z.number().int().min(1),
  }).nullable().optional(),
});

const createAnnouncementSchema = z.object({
  title: z.string().min(1).max(255),
  body: z.string().min(1).max(5000),
  type: z.enum(['info', 'warning', 'maintenance']).optional(),
  expiresAt: z.string().datetime().optional(),
});

const deleteTenantSchema = z.object({
  confirmSlug: z.string().min(1),
});

// ── Metrics ──────────────────────────────────────────────

export const getMetrics = async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const metrics = await platformService.getPlatformMetrics();
    res.json(metrics);
  } catch (err) { next(err); }
};

export const getTrends = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const period = (req.query.period as string) || '30d';
    const trends = await platformService.getPlatformTrends(period);
    res.json(trends);
  } catch (err) { next(err); }
};

// ── Tenants ──────────────────────────────────────────────

export const listTenants = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { search, plan, status, page, limit } = req.query;
    const result = await platformService.listTenants({
      search: search as string,
      plan: plan as string,
      status: status as string,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
    res.json(result);
  } catch (err) { next(err); }
};

export const getTenant = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenant = await platformService.getTenantDetail(req.params.id);
    res.json(tenant);
  } catch (err) { next(err); }
};

export const createTenant = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createTenantSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.issues[0].message, 400);
    const tenant = await platformService.createTenant(parsed.data);
    res.status(201).json(tenant);
  } catch (err) { next(err); }
};

export const updateTenant = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updateTenantSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.issues[0].message, 400);
    const tenant = await platformService.updateTenant(req.params.id, parsed.data);
    res.json(tenant);
  } catch (err) { next(err); }
};

export const suspendTenant = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenant = await platformService.suspendTenant(req.params.id);
    res.json({ message: 'Tenant suspended', tenant });
  } catch (err) { next(err); }
};

export const reactivateTenant = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenant = await platformService.reactivateTenant(req.params.id);
    res.json({ message: 'Tenant reactivated', tenant });
  } catch (err) { next(err); }
};

export const removeTenant = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = deleteTenantSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.issues[0].message, 400);
    await platformService.deleteTenant(req.params.id, parsed.data.confirmSlug);
    res.json({ message: 'Tenant deleted' });
  } catch (err) { next(err); }
};

// ── Announcements ────────────────────────────────────────

export const listAnnouncements = async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const announcements = await platformService.listAnnouncements();
    res.json({ announcements });
  } catch (err) { next(err); }
};

export const getActiveAnnouncements = async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const announcements = await platformService.getActiveAnnouncements();
    res.json({ announcements });
  } catch (err) { next(err); }
};

export const addAnnouncement = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createAnnouncementSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.issues[0].message, 400);
    const announcement = await platformService.createAnnouncement({
      ...parsed.data,
      createdBy: req.user?.id,
    });
    res.status(201).json(announcement);
  } catch (err) { next(err); }
};

export const removeAnnouncement = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    await platformService.deleteAnnouncement(req.params.id);
    res.json({ message: 'Announcement deleted' });
  } catch (err) { next(err); }
};

// ── Plans ───────────────────────────────────────────────

export const listPlans = async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const plans = await prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { priceGHS: 'asc' },
      select: { id: true, name: true, displayName: true, priceGHS: true },
    });
    res.json({ plans });
  } catch (err) { next(err); }
};

// ── Health ───────────────────────────────────────────────

export const getHealth = async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const health = await platformService.getSystemHealth();
    res.json(health);
  } catch (err) { next(err); }
};
