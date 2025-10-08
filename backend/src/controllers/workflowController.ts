import { Response } from 'express';
import { AuthRequest } from '../types';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { workflowQueue } from '../queues/workflowQueue';

export const getAllWorkflows = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { isActive, triggerType } = req.query;

    const where: any = {};
    if (isActive !== undefined) where.isActive = isActive === 'true';
    if (triggerType) where.triggerType = triggerType;

    const workflows = await prisma.workflow.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    res.json({ workflows });
  } catch (error) {
    throw error;
  }
};

export const createWorkflow = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, description, triggerType, triggerData, actions, conditions } = req.body;

    const workflow = await prisma.workflow.create({
      data: {
        name,
        description,
        triggerType,
        triggerData,
        actions,
        conditions
      }
    });

    res.status(201).json({ workflow });
  } catch (error) {
    throw error;
  }
};

export const getWorkflow = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const workflow = await prisma.workflow.findUnique({
      where: { id },
      include: {
        executions: {
          orderBy: { startedAt: 'desc' },
          take: 10
        }
      }
    });

    if (!workflow) {
      throw new AppError('Workflow not found', 404);
    }

    res.json({ workflow });
  } catch (error) {
    throw error;
  }
};

export const updateWorkflow = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const workflow = await prisma.workflow.update({
      where: { id },
      data: updateData
    });

    res.json({ workflow });
  } catch (error) {
    throw error;
  }
};

export const deleteWorkflow = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    await prisma.workflow.delete({
      where: { id }
    });

    res.json({ message: 'Workflow deleted successfully' });
  } catch (error) {
    throw error;
  }
};

export const executeWorkflow = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { input } = req.body;

    const workflow = await prisma.workflow.findUnique({
      where: { id }
    });

    if (!workflow) {
      throw new AppError('Workflow not found', 404);
    }

    if (!workflow.isActive) {
      throw new AppError('Workflow is not active', 400);
    }

    // Create execution record
    const execution = await prisma.workflowExecution.create({
      data: {
        workflowId: id,
        status: 'pending',
        input: input || {}
      }
    });

    // Add to queue
    await workflowQueue.add('execute-workflow', {
      executionId: execution.id,
      workflowId: workflow.id,
      actions: workflow.actions,
      input: input || {}
    });

    res.json({
      message: 'Workflow execution started',
      execution
    });
  } catch (error) {
    throw error;
  }
};

export const getWorkflowExecutions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const skip = (Number(page) - 1) * Number(limit);

    const [executions, total] = await Promise.all([
      prisma.workflowExecution.findMany({
        where: { workflowId: id },
        skip,
        take: Number(limit),
        orderBy: { startedAt: 'desc' }
      }),
      prisma.workflowExecution.count({
        where: { workflowId: id }
      })
    ]);

    res.json({
      executions,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error) {
    throw error;
  }
};
