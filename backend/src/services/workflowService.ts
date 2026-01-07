import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { WorkflowTriggerType, Prisma } from '@prisma/client';
import logger from '../utils/logger';
import { workflowQueue } from '../queues/workflowQueue';
import { evaluateConditions as evaluateConditionRules } from '../utils/conditionEvaluator';
import crypto from 'crypto';

interface CreateWorkflowData {
  name: string;
  description?: string;
  triggerType: WorkflowTriggerType;
  triggerData: any;
  actions: any[];
  conditions?: any;
}

interface WorkflowFilters {
  isActive?: boolean;
  triggerType?: WorkflowTriggerType;
}

export class WorkflowService {
  /**
   * Get all workflows with filters
   */
  async getAllWorkflows(filters: WorkflowFilters) {
    const { isActive, triggerType } = filters;

    const where: Prisma.WorkflowWhereInput = {};
    if (isActive !== undefined) where.isActive = isActive;
    if (triggerType) where.triggerType = triggerType;

    const workflows = await prisma.workflow.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    return workflows;
  }

  /**
   * Create new workflow
   */
  async createWorkflow(data: CreateWorkflowData) {
    // Validate actions
    this.validateWorkflowActions(data.actions);

    const workflow = await prisma.workflow.create({
      data: {
        name: data.name,
        description: data.description,
        triggerType: data.triggerType,
        triggerData: data.triggerData,
        actions: data.actions,
        conditions: data.conditions || {}
      }
    });

    logger.info('Workflow created', {
      workflowId: workflow.id,
      name: workflow.name,
      triggerType: workflow.triggerType
    });

    return workflow;
  }

  /**
   * Get workflow by ID
   * Note: Executions are fetched separately via getWorkflowExecutions endpoint
   * to improve performance and avoid loading unnecessary data
   */
  async getWorkflowById(workflowId: number) {
    const workflow = await prisma.workflow.findUnique({
      where: { id: workflowId }
    });

    if (!workflow) {
      throw new AppError('Workflow not found', 404);
    }

    return workflow;
  }

  /**
   * Update workflow
   */
  async updateWorkflow(workflowId: number, updateData: Partial<CreateWorkflowData>) {
    const workflow = await prisma.workflow.findUnique({
      where: { id: workflowId }
    });

    if (!workflow) {
      throw new AppError('Workflow not found', 404);
    }

    // Validate actions if provided
    if (updateData.actions) {
      this.validateWorkflowActions(updateData.actions);
    }

    const updated = await prisma.workflow.update({
      where: { id: workflowId },
      data: updateData
    });

    logger.info('Workflow updated', { workflowId });
    return updated;
  }

  /**
   * Delete workflow
   */
  async deleteWorkflow(workflowId: number) {
    const workflow = await prisma.workflow.findUnique({
      where: { id: workflowId }
    });

    if (!workflow) {
      throw new AppError('Workflow not found', 404);
    }

    await prisma.workflow.delete({
      where: { id: workflowId }
    });

    logger.info('Workflow deleted', { workflowId });
    return { message: 'Workflow deleted successfully' };
  }

  /**
   * Toggle workflow active status
   */
  async toggleWorkflowStatus(workflowId: number, isActive: boolean) {
    const workflow = await prisma.workflow.findUnique({
      where: { id: workflowId }
    });

    if (!workflow) {
      throw new AppError('Workflow not found', 404);
    }

    const updated = await prisma.workflow.update({
      where: { id: workflowId },
      data: { isActive }
    });

    logger.info('Workflow status toggled', { workflowId, isActive });
    return updated;
  }

  /**
   * Execute workflow
   */
  async executeWorkflow(workflowId: number, input?: any) {
    const workflow = await prisma.workflow.findUnique({
      where: { id: workflowId }
    });

    if (!workflow) {
      throw new AppError('Workflow not found', 404);
    }

    if (!workflow.isActive) {
      throw new AppError('Workflow is not active', 400);
    }

    // For manual execution (no input), skip workflow-level conditions
    // The queue worker will handle finding orders that match conditions
    const isManualExecution = !input || Object.keys(input).length === 0;

    // Check conditions only for automatic triggers with input
    if (!isManualExecution && workflow.conditions && !this.evaluateConditions(workflow.conditions, input)) {
      logger.info('Workflow conditions not met', { workflowId, input });
      return { message: 'Workflow conditions not met' };
    }

    // Create execution record
    const execution = await prisma.workflowExecution.create({
      data: {
        workflowId,
        status: 'pending',
        input: input || {}
      }
    });

    // Add to queue for async processing (with 5s timeout to prevent API hang)
    await Promise.race([
      workflowQueue.add('execute-workflow', {
        executionId: execution.id,
        workflowId: workflow.id,
        actions: workflow.actions,
        conditions: workflow.conditions,
        input: input || {}
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Workflow queue is currently unavailable. Please try again later.')), 5000)
      )
    ]);

    logger.info('Workflow execution started', {
      workflowId,
      executionId: execution.id
    });

    return {
      message: 'Workflow execution started',
      execution
    };
  }

  /**
   * Process workflow execution (called by queue worker)
   */
  async processWorkflowExecution(executionId: number, workflowId: number, actions: any[], input: any) {
    try {
      await prisma.workflowExecution.update({
        where: { id: executionId },
        data: { status: 'running' }
      });

      const results: any[] = [];

      // Execute actions sequentially
      for (const action of actions) {
        try {
          const result = await this.executeAction(action, input);
          results.push({ action: action.type, success: true, result });

          // If action is wait, delay execution
          if (action.type === 'wait' && action.duration) {
            await this.delay(action.duration);
          }
        } catch (error: any) {
          results.push({ action: action.type, success: false, error: error.message });

          // Continue or stop based on action config
          if (action.stopOnError) {
            throw error;
          }
        }
      }

      // Mark execution as completed
      await prisma.workflowExecution.update({
        where: { id: executionId },
        data: {
          status: 'completed',
          output: results,
          completedAt: new Date()
        }
      });

      logger.info('Workflow execution completed', { executionId, workflowId });
      return results;
    } catch (error: any) {
      await prisma.workflowExecution.update({
        where: { id: executionId },
        data: {
          status: 'failed',
          error: error.message,
          completedAt: new Date()
        }
      });

      logger.error('Workflow execution failed', {
        executionId,
        workflowId,
        error: error.message
      });

      throw error;
    }
  }

  /**
   * Execute single workflow action
   */
  private async executeAction(action: any, context: any): Promise<any> {
    // Check if action has conditions
    if (action.conditions) {
      const conditionsMet = this.evaluateConditions(action.conditions, context);

      if (!conditionsMet) {
        logger.info('Action conditions not met, skipping', {
          actionType: action.type,
          conditions: action.conditions
        });

        // If conditions not met and there's an else branch, execute it
        if (action.elseBranch && Array.isArray(action.elseBranch)) {
          logger.info('Executing else branch', { actionType: action.type });
          const elseResults = [];

          for (const elseAction of action.elseBranch) {
            const result = await this.executeAction(elseAction, context);
            elseResults.push(result);
          }

          return {
            conditionsMet: false,
            elseBranchExecuted: true,
            results: elseResults
          };
        }

        return { conditionsMet: false, skipped: true };
      }

      logger.info('Action conditions met, proceeding', { actionType: action.type });
    }

    switch (action.type) {
      case 'send_sms':
        return this.executeSendSMS(action, context);

      case 'send_email':
        return this.executeSendEmail(action, context);

      case 'update_order':
        return this.executeUpdateOrder(action, context);

      case 'assign_agent':
        return this.executeAssignAgent(action, context);

      case 'assign_user':
        return this.executeAssignUserAction(action, context);

      case 'add_tag':
        return this.executeAddTag(action, context);

      case 'http_request':
        return this.executeHttpRequest(action, context);

      case 'wait':
        return { message: 'Wait action acknowledged' };

      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }
  }

  /**
   * Execute send SMS action
   */
  private async executeSendSMS(action: any, context: any): Promise<any> {
    // TODO: Integrate with SMS provider (Twilio, etc.)
    logger.info('SMS action executed (mock)', {
      to: action.phoneNumber || context.phoneNumber,
      message: action.message
    });

    return {
      success: true,
      message: 'SMS sent (mock)',
      to: action.phoneNumber || context.phoneNumber
    };
  }

  /**
   * Execute send email action
   */
  private async executeSendEmail(action: any, context: any): Promise<any> {
    // TODO: Integrate with email provider (SendGrid, etc.)
    logger.info('Email action executed (mock)', {
      to: action.email || context.email,
      subject: action.subject,
      body: action.body
    });

    return {
      success: true,
      message: 'Email sent (mock)',
      to: action.email || context.email
    };
  }

  /**
   * Execute update order action
   */
  private async executeUpdateOrder(action: any, context: any): Promise<any> {
    const orderId = action.orderId || context.orderId;

    if (!orderId) {
      throw new Error('Order ID not provided');
    }

    const updateData: any = {};
    if (action.status) updateData.status = action.status;
    if (action.notes) updateData.notes = action.notes;
    if (action.priority !== undefined) updateData.priority = action.priority;

    await prisma.order.update({
      where: { id: orderId },
      data: updateData
    });

    logger.info('Order updated via workflow', { orderId, updateData });
    return { success: true, orderId, updates: updateData };
  }

  /**
   * Execute assign agent action
   */
  private async executeAssignAgent(action: any, context: any): Promise<any> {
    const orderId = action.orderId || context.orderId;
    const agentId = action.agentId;

    if (!orderId || !agentId) {
      throw new Error('Order ID or Agent ID not provided');
    }

    await prisma.order.update({
      where: { id: orderId },
      data: { deliveryAgentId: agentId }
    });

    logger.info('Agent assigned via workflow', { orderId, agentId });
    return { success: true, orderId, agentId };
  }

  /**
   * Execute add tag action
   */
  private async executeAddTag(action: any, context: any): Promise<any> {
    const orderId = action.orderId || context.orderId;
    const tag = action.tag;

    if (!orderId || !tag) {
      throw new Error('Order ID or tag not provided');
    }

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      throw new Error('Order not found');
    }

    const updatedTags = Array.from(new Set([...order.tags, tag]));

    await prisma.order.update({
      where: { id: orderId },
      data: { tags: updatedTags }
    });

    logger.info('Tag added via workflow', { orderId, tag });
    return { success: true, orderId, tag };
  }

  /**
   * Execute HTTP request action
   */
  private async executeHttpRequest(action: any, _context: any): Promise<any> {
    // TODO: Implement HTTP request with proper error handling
    logger.info('HTTP request action executed (mock)', {
      url: action.url,
      method: action.method,
      headers: action.headers
    });

    return {
      success: true,
      message: 'HTTP request sent (mock)',
      url: action.url
    };
  }

  /**
   * Execute assign user action (round-robin or weighted)
   */
  private async executeAssignUserAction(action: any, context: any): Promise<any> {
    const config = action.config || {};
    const orderId = action.orderId || context.orderId;
    const targetField = action.targetField || (config.userType === 'sales_rep' ? 'customerRepId' : 'deliveryAgentId');
    const userType = config.userType; // 'sales_rep' | 'delivery_agent'
    const distributionMode = config.distributionMode || 'even'; // 'even' | 'weighted'
    const assignments = config.assignments || [];
    const onlyUnassigned = config.onlyUnassigned !== undefined ? config.onlyUnassigned : true;

    if (!orderId) {
      throw new Error('Order ID not provided for assign_user action');
    }

    if (!userType) {
      throw new Error('User type not specified for assign_user action');
    }

    // If onlyUnassigned is true, check if order already has an assigned user
    if (onlyUnassigned) {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: { customerRepId: true, deliveryAgentId: true }
      });

      if (order) {
        const hasAssignment = userType === 'sales_rep'
          ? order.customerRepId !== null
          : order.deliveryAgentId !== null;

        if (hasAssignment) {
          logger.info('Order already has assigned user, skipping', { orderId, userType });
          return {
            success: true,
            skipped: true,
            reason: 'Order already has assigned user'
          };
        }
      }
    }

    // Get users from assignments
    if (assignments.length === 0) {
      throw new Error('No users selected in assignments');
    }

    // Fetch full user details for selected IDs
    const userIds = assignments.map((a: any) => a.userId);
    const users = await prisma.user.findMany({
      where: {
        id: { in: userIds },
        isActive: true
      }
    });

    if (users.length === 0) {
      throw new Error(`No available users with type: ${userType}`);
    }

    let selectedUser;

    if (distributionMode === 'weighted') {
      // Use weighted selection based on assignments
      const totalWeight = assignments.reduce((sum: number, a: any) => sum + a.weight, 0);
      const random = (crypto.randomInt(0, 1000000) / 1000000) * totalWeight;

      let cumulativeWeight = 0;
      for (const assignment of assignments) {
        cumulativeWeight += assignment.weight;
        if (random <= cumulativeWeight) {
          selectedUser = users.find(u => u.id === assignment.userId);
          break;
        }
      }
    } else {
      // Even distribution - simple round-robin
      const randomIndex = crypto.randomInt(0, users.length);
      selectedUser = users[randomIndex];
    }

    if (!selectedUser) {
      throw new Error('Failed to select user for assignment');
    }

    // Build update data
    const updateData: any = {
      [targetField]: selectedUser.id
    };

    // Update the order
    await prisma.order.update({
      where: { id: orderId },
      data: updateData
    });

    logger.info('User assigned via workflow', {
      orderId,
      userId: selectedUser.id,
      userName: `${selectedUser.firstName} ${selectedUser.lastName}`,
      userType,
      targetField,
      distributionMode
    });

    return {
      success: true,
      orderId,
      assignedUserId: selectedUser.id,
      assignedUserName: `${selectedUser.firstName} ${selectedUser.lastName}`,
      targetField,
      distributionMode
    };
  }

  /**
   * Evaluate workflow conditions
   */
  private evaluateConditions(conditions: any, input: any): boolean {
    // No conditions means always true
    if (!conditions) {
      return true;
    }

    // Empty object or no rules means always true
    if (typeof conditions === 'object' && Object.keys(conditions).length === 0) {
      return true;
    }

    // If conditions has an 'id' field, it's the new structure with rules
    if (conditions.id && conditions.rules) {
      // Use the condition evaluator utility
      return evaluateConditionRules(conditions, input);
    }

    // Fallback for simple key-value conditions
    for (const [key, value] of Object.entries(conditions)) {
      if (input[key] !== value) {
        return false;
      }
    }

    return true;
  }

  /**
   * Validate workflow actions
   */
  private validateWorkflowActions(actions: any[]): void {
    if (!Array.isArray(actions) || actions.length === 0) {
      throw new AppError('Workflow must have at least one action', 400);
    }

    const validActionTypes = [
      'send_sms',
      'send_email',
      'update_order',
      'assign_agent',
      'assign_user',
      'add_tag',
      'wait',
      'http_request'
    ];

    for (const action of actions) {
      if (!action.type || !validActionTypes.includes(action.type)) {
        throw new AppError(`Invalid action type: ${action.type}`, 400);
      }

      // Validate assign_user action
      if (action.type === 'assign_user') {
        if (!action.config?.userType) {
          throw new AppError('assign_user action requires userType in config', 400);
        }

        if (action.config?.distributionMode === 'weighted' && (!action.config?.assignments || action.config.assignments.length === 0)) {
          throw new AppError('Weighted assignment requires assignments array', 400);
        }
      }
    }
  }

  /**
   * Get workflow executions
   */
  async getWorkflowExecutions(
    workflowId: number,
    filters?: { page?: number; limit?: number }
  ) {
    const { page = 1, limit = 20 } = filters || {};
    const skip = (page - 1) * limit;

    const [executions, total] = await Promise.all([
      prisma.workflowExecution.findMany({
        where: { workflowId },
        skip,
        take: limit,
        orderBy: { startedAt: 'desc' }
      }),
      prisma.workflowExecution.count({
        where: { workflowId }
      })
    ]);

    return {
      executions,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * Status change workflows triggered
   */
  async triggerStatusChangeWorkflows(orderId: string, oldStatus: string, newStatus: string) {
    const workflows = await prisma.workflow.findMany({
      where: {
        isActive: true,
        triggerType: 'status_change',
        triggerData: {
          path: ['status'],
          equals: newStatus
        }
      }
    }) || [];

    for (const workflow of workflows) {
      await this.executeWorkflow(workflow.id, {
        orderId,
        oldStatus,
        newStatus
      });
    }

    logger.info('Status change workflows triggered', {
      orderId,
      oldStatus,
      newStatus,
      workflowsTriggered: workflows.length
    });
  }

  /**
   * Trigger workflows with order_created trigger type
   */
  async triggerOrderCreatedWorkflows(order: any) {
    try {
      // Find active workflows with order_created trigger
      const workflows = await prisma.workflow.findMany({
        where: {
          triggerType: 'order_created',
          isActive: true
        }
      }) || [];

      if (workflows.length === 0) {
        logger.debug('No active order_created workflows found');
        return;
      }

      logger.info(`Found ${workflows.length} active order_created workflows`, {
        orderId: order.id,
        workflows: workflows.map(w => w.id)
      });

      // Fetch full order data with products for workflow evaluation
      const fullOrder = await prisma.order.findUnique({
        where: { id: order.id },
        include: {
          orderItems: {
            include: {
              product: true
            }
          },
          customer: true
        }
      });

      if (!fullOrder) {
        logger.error('Order not found for workflow triggering', { orderId: order.id });
        return;
      }

      // Prepare context for workflow evaluation
      const orderContext = {
        ...fullOrder,
        productName: (fullOrder.orderItems || []).map((item: any) => item.product?.name || 'Unknown Product').join(', ')
      };

      // Trigger each workflow
      for (const workflow of workflows) {
        try {
          // Create execution record
          const execution = await prisma.workflowExecution.create({
            data: {
              workflowId: workflow.id,
              status: 'pending',
              input: orderContext
            }
          });

          // Add to queue for async processing (with 5s timeout to prevent hanging order creation)
          await Promise.race([
            workflowQueue.add('execute-workflow', {
              executionId: execution.id,
              workflowId: workflow.id,
              actions: workflow.actions,
              conditions: workflow.conditions,
              input: orderContext
            }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Workflow queue timeout')), 5000)
            )
          ]);

          logger.info('Workflow triggered for new order', {
            workflowId: workflow.id,
            executionId: execution.id,
            orderId: order.id
          });
        } catch (error: any) {
          logger.error('Failed to trigger workflow', {
            workflowId: workflow.id,
            orderId: order.id,
            error: error.message
          });
        }
      }
    } catch (error: any) {
      logger.error('Error in triggerOrderCreatedWorkflows', {
        orderId: order.id,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get workflow templates
   */
  async getTemplates(category?: string) {
    const {
      workflowTemplates,
      getTemplateCategories,
      getTemplatesByCategory
    } = await import('../data/workflowTemplates');

    const templates = category
      ? getTemplatesByCategory(category)
      : workflowTemplates;

    const categories = getTemplateCategories();

    return {
      templates,
      categories
    };
  }

  /**
   * Utility: Delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default new WorkflowService();
