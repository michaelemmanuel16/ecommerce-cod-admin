import { Request, Response } from 'express';
import { AuthRequest } from '../types';
import { UserRole } from '@prisma/client';
import workflowService, { normalizeTriggerType, SCHEDULE_TRIGGER } from '../services/workflowService';
import { AppError } from '../middleware/errorHandler';

/** Who may edit a schedule or regenerate a webhook token (M9-T22): the owner, admins and managers. */
const MANAGER_ROLES: UserRole[] = ['super_admin', 'admin', 'manager'];
const assertManager = (req: AuthRequest) => {
  if (!req.user || !MANAGER_ROLES.includes(req.user.role)) {
    throw new AppError('Only the owner, an admin or a manager can do this', 403);
  }
};

export const getAllWorkflows = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { isActive, triggerType } = req.query;

    const workflows = await workflowService.getAllWorkflows({
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
      triggerType: triggerType ? normalizeTriggerType(triggerType) : undefined
    });

    res.json({ workflows });
  } catch (error) {
    throw error;
  }
};

export const createWorkflow = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, description, triggerType, triggerData, actions, conditions } = req.body;
    if (normalizeTriggerType(triggerType) === SCHEDULE_TRIGGER) assertManager(req);

    // A webhook workflow's token is in this response and nowhere else
    const { webhookToken, ...workflow } = await workflowService.createWorkflow({
      name,
      description,
      triggerType,
      triggerData,
      actions,
      conditions
    }) as any;

    res.status(201).json({ workflow, ...(webhookToken ? { webhookToken } : {}) });
  } catch (error) {
    throw error;
  }
};

export const getWorkflow = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const workflowId = parseInt(id, 10);
    if (isNaN(workflowId)) {
      res.status(400).json({ error: 'Invalid workflow ID' });
      return;
    }
    const workflow = await workflowService.getWorkflowById(workflowId);
    res.json({ workflow });
  } catch (error) {
    throw error;
  }
};

export const updateWorkflow = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const workflowId = parseInt(id, 10);
    if (isNaN(workflowId)) {
      res.status(400).json({ error: 'Invalid workflow ID' });
      return;
    }
    const updateData = req.body;
    // A schedule is edited by a manager or above: the one it is, and the one it becomes
    const current = await workflowService.getWorkflowById(workflowId);
    if (current.triggerType === SCHEDULE_TRIGGER || normalizeTriggerType(updateData?.triggerType) === SCHEDULE_TRIGGER) assertManager(req);
    const { webhookToken, ...workflow } = await workflowService.updateWorkflow(workflowId, updateData) as any;
    res.json({ workflow, ...(webhookToken ? { webhookToken } : {}) });
  } catch (error) {
    throw error;
  }
};

export const deleteWorkflow = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const workflowId = parseInt(id, 10);
    if (isNaN(workflowId)) {
      res.status(400).json({ error: 'Invalid workflow ID' });
      return;
    }
    const current = await workflowService.getWorkflowById(workflowId);
    if (current.triggerType === SCHEDULE_TRIGGER) assertManager(req);
    const result = await workflowService.deleteWorkflow(workflowId);
    res.json(result);
  } catch (error) {
    throw error;
  }
};

export const executeWorkflow = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const workflowId = parseInt(id, 10);
    if (isNaN(workflowId)) {
      res.status(400).json({ error: 'Invalid workflow ID' });
      return;
    }
    const { input } = req.body;

    const result = await workflowService.executeWorkflow(workflowId, input);
    res.json(result);
  } catch (error) {
    throw error;
  }
};

export const getWorkflowExecutions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const workflowId = parseInt(id, 10);
    if (isNaN(workflowId)) {
      res.status(400).json({ error: 'Invalid workflow ID' });
      return;
    }
    const { page = 1, limit = 20 } = req.query;

    const result = await workflowService.getWorkflowExecutions(workflowId, {
      page: Number(page),
      limit: Number(limit)
    });

    res.json(result);
  } catch (error) {
    throw error;
  }
};

export const getWorkflowTemplates = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { category } = req.query;

    const result = await workflowService.getTemplates(category as string | undefined);

    res.json(result);
  } catch (error) {
    throw error;
  }
};

/** `POST /api/workflows/:id/webhook-token/regenerate`: a new token, returned once. The old one stops working. */
export const regenerateWebhookToken = async (req: AuthRequest, res: Response): Promise<void> => {
  assertManager(req);
  const workflowId = parseInt(req.params.id, 10);
  if (isNaN(workflowId)) {
    res.status(400).json({ error: 'Invalid workflow ID' });
    return;
  }
  res.json(await workflowService.regenerateWebhookToken(workflowId));
};

/** `POST /api/workflows/hooks/:token`: the webhook trigger. No login: the token is the credential. */
export const triggerWebhook = async (req: Request, res: Response): Promise<void> => {
  const result: any = await workflowService.triggerWebhook(req.params.token, req.body ?? {}, req.get('Idempotency-Key') ?? undefined);
  res.status(202).json({ message: result.message, executionId: result.execution?.id ?? null });
};
