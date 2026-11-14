import { Router } from 'express';
import * as workflowController from '../controllers/workflowController';
import { authenticate, requireResourcePermission } from '../middleware/auth';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';
import { validate } from '../middleware/validation';
import { paginationValidation } from '../utils/validators';
import { workflowHookLimiter } from '../middleware/rateLimiter';

const router = Router();

// The webhook trigger has no login: the token in the path is the credential (M9-T22). 60 calls a minute per token.
router.post('/hooks/:token', workflowHookLimiter, workflowController.triggerWebhook);

router.use(authenticate);
router.use(tenantRateLimiter);

// Templates endpoint must come before /:id to avoid matching "templates" as an ID
router.get('/templates', requireResourcePermission('workflows', 'view'), workflowController.getWorkflowTemplates);

router.get('/', requireResourcePermission('workflows', 'view'), workflowController.getAllWorkflows);
router.post('/', requireResourcePermission('workflows', 'create'), workflowController.createWorkflow);
router.get('/:id', requireResourcePermission('workflows', 'view'), workflowController.getWorkflow);
router.put('/:id', requireResourcePermission('workflows', 'update'), workflowController.updateWorkflow);
router.delete('/:id', requireResourcePermission('workflows', 'delete'), workflowController.deleteWorkflow);
router.post('/:id/execute', requireResourcePermission('workflows', 'execute'), workflowController.executeWorkflow);
router.post('/:id/webhook-token/regenerate', requireResourcePermission('workflows', 'update', 'execute'), workflowController.regenerateWebhookToken);
router.get('/:id/executions', paginationValidation, validate, requireResourcePermission('workflows', 'view'), workflowController.getWorkflowExecutions);

export default router;
