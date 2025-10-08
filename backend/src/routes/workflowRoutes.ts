import { Router } from 'express';
import * as workflowController from '../controllers/workflowController';
import { authenticate, requirePermission } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { paginationValidation } from '../utils/validators';

const router = Router();

router.use(authenticate);

router.get('/', workflowController.getAllWorkflows);
router.post('/', requirePermission(['super_admin', 'admin']), workflowController.createWorkflow);
router.get('/:id', workflowController.getWorkflow);
router.put('/:id', requirePermission(['super_admin', 'admin']), workflowController.updateWorkflow);
router.delete('/:id', requirePermission(['super_admin', 'admin']), workflowController.deleteWorkflow);
router.post('/:id/execute', workflowController.executeWorkflow);
router.get('/:id/executions', paginationValidation, validate, workflowController.getWorkflowExecutions);

export default router;
