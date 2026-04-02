import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as platformService from '../services/platformService';

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
    const tenant = await platformService.createTenant(req.body);
    res.status(201).json(tenant);
  } catch (err) { next(err); }
};

export const updateTenant = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenant = await platformService.updateTenant(req.params.id, req.body);
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
    const { confirmSlug } = req.body;
    await platformService.deleteTenant(req.params.id, confirmSlug);
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
    const announcement = await platformService.createAnnouncement({
      ...req.body,
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

// ── Health ───────────────────────────────────────────────

export const getHealth = async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const health = await platformService.getSystemHealth();
    res.json(health);
  } catch (err) { next(err); }
};
