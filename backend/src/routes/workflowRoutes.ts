import { Router } from 'express';
import * as workflowController from '../controllers/workflowController';
import { authenticate, requireResourcePermission } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { paginationValidation } from '../utils/validators';

const router = Router();

router.use(authenticate);

// Templates endpoint must come before /:id to avoid matching "templates" as an ID
router.get('/templates', requireResourcePermission('workflows', 'view'), workflowController.getWorkflowTemplates);

router.get('/', requireResourcePermission('workflows', 'view'), workflowController.getAllWorkflows);
router.post('/', requireResourcePermission('workflows', 'create'), workflowController.createWorkflow);
router.get('/:id', requireResourcePermission('workflows', 'view'), workflowController.getWorkflow);
router.put('/:id', requireResourcePermission('workflows', 'update'), workflowController.updateWorkflow);
router.delete('/:id', requireResourcePermission('workflows', 'delete'), workflowController.deleteWorkflow);
router.post('/:id/execute', requireResourcePermission('workflows', 'execute'), workflowController.executeWorkflow);
router.get('/:id/executions', paginationValidation, validate, requireResourcePermission('workflows', 'view'), workflowController.getWorkflowExecutions);

export default router;
