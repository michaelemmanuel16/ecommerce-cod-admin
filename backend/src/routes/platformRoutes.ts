import { Router } from 'express';
import { apiLimiter } from '../middleware/rateLimiter';
import { authenticate } from '../middleware/auth';
import { requirePlatformAdmin } from '../middleware/platformAuth';
import * as pc from '../controllers/platformController';

const router = Router();

// All platform routes require authentication
router.use(apiLimiter, authenticate);

// Active announcements — any authenticated user (for banner display)
router.get('/announcements/active', pc.getActiveAnnouncements);

// Everything below requires platform admin (super_admin + null tenant context)
router.use(requirePlatformAdmin);

// Metrics
router.get('/metrics', pc.getMetrics);
router.get('/metrics/trends', pc.getTrends);

// Tenant management
router.get('/tenants', pc.listTenants);
router.post('/tenants', pc.createTenant);
router.get('/tenants/:id', pc.getTenant);
router.put('/tenants/:id', pc.updateTenant);
router.post('/tenants/:id/suspend', pc.suspendTenant);
router.post('/tenants/:id/reactivate', pc.reactivateTenant);
router.delete('/tenants/:id', pc.removeTenant);

// Announcements management
router.get('/announcements', pc.listAnnouncements);
router.post('/announcements', pc.addAnnouncement);
router.delete('/announcements/:id', pc.removeAnnouncement);

// Plans
router.get('/plans', pc.listPlans);

// System health
router.get('/health', pc.getHealth);

export default router;
