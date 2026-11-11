import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { authenticate, requireResourcePermission } from '../middleware/auth';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';
import { validate } from '../middleware/validation';
import * as ctrl from '../controllers/marketingMappingController';
import * as kpi from '../controllers/marketingKpiController';

const router = Router();

router.use(authenticate);
router.use(tenantRateLimiter);

const canView = requireResourcePermission('marketing', 'view');
const canUpdate = requireResourcePermission('marketing', 'update');

// Campaign to product mapping (M8-T09)
router.get('/mappings', canView, ctrl.getMappings);
router.post(
  '/mappings/rules',
  canUpdate,
  [
    body('prefix').isString().trim().isLength({ min: 1, max: 40 }).withMessage('Prefix must be 1 to 40 characters'),
    body('productId').isInt({ min: 1 }).toInt(),
  ],
  validate,
  ctrl.postRule,
);
router.delete('/mappings/rules/:id', canUpdate, [param('id').isInt({ min: 1 }).toInt()], validate, ctrl.removeRule);
router.put(
  '/mappings/campaigns',
  canUpdate,
  [
    body('adAccountId').isInt({ min: 1 }).toInt(),
    body('campaignId').isString().trim().isLength({ min: 1, max: 64 }),
    body('productId').custom((v) => v === null || (Number.isInteger(v) && v > 0)).withMessage('productId must be a product id or null'),
  ],
  validate,
  ctrl.putCampaignPick,
);
router.get('/campaigns', canView, ctrl.getCampaigns);
router.get('/campaigns/unmapped', canView, ctrl.getUnmapped);

// Tiles and max CPA (M8-T10)
router.get('/summary', canView, kpi.getSummary);

// Funnel and campaign performance (M8-T11)
router.get('/funnel', canView, [query('productId').optional().isInt({ min: 1 }).withMessage('productId must be a product id')], validate, kpi.getFunnel);
router.get('/campaigns/performance', canView, kpi.getCampaignPerformance);

export default router;
