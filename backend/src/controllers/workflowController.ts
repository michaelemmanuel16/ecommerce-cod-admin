import { Response } from 'express';
import { AuthRequest } from '../types';
import { WorkflowTriggerType } from '@prisma/client';
import workflowService from '../services/workflowService';

export const getAllWorkflows = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { isActive, triggerType } = req.query;

    const workflows = await workflowService.getAllWorkflows({
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
      triggerType: triggerType as WorkflowTriggerType | undefined
    });

    res.json({ workflows });
  } catch (error) {
    throw error;
  }
};

export const createWorkflow = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, description, triggerType, triggerData, actions, conditions } = req.body;

    const workflow = await workflowService.createWorkflow({
      name,
      description,
      triggerType,
      triggerData,
      actions,
      conditions
    });

    res.status(201).json({ workflow });
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
    const workflow = await workflowService.updateWorkflow(workflowId, updateData);
    res.json({ workflow });
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
