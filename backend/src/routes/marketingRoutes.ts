import { Router } from 'express';
import { body, param } from 'express-validator';
import { authenticate, requireResourcePermission } from '../middleware/auth';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';
import { validate } from '../middleware/validation';
import * as ctrl from '../controllers/marketingMappingController';

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

export default router;
