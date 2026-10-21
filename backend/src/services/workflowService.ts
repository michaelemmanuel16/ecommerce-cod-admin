import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { WorkflowTriggerType, Prisma, Workflow } from '@prisma/client';
import logger from '../utils/logger';
import { workflowQueue } from '../queues/workflowQueue';
import assignmentService from './assignmentService';
import { systemActor } from './systemUserService';
import { addOrderTag, setOrderStatusByWorkflow, workflowStatus } from './workflowActions';
import { evaluateConditions as evaluateConditionRules } from '../utils/conditionEvaluator';
import crypto from 'crypto';
import { getTenantId, resolveTenantId, runInTenant } from '../utils/tenantContext';
import { AppEvent, OrderCreatedEvent, OrderStatusChangedEvent, onOrderEvent } from '../utils/appEvents';

/** M2-T17 loop guard: a workflow-caused move stops at this depth; one run per order per workflow per window. */
const LOOP_GUARD_MAX_DEPTH = 3;
const LOOP_GUARD_WINDOW_MS = 60_000;
export const LOOP_GUARD_MESSAGE = 'Skipped: loop guard';
const BACKDATED_MS = 24 * 60 * 60 * 1000;

/**
 * Why an order event fires no workflows, or null when it fires them (M2-T17). `runWorkflows: true` overrides:
 * - an imported order (or import re-import) with a status other than pending_confirmation
 * - an integration move (partner, MCP, sync) whose delivery date is more than 1 day in the past
 */
export function workflowSkipReason(evt: OrderCreatedEvent | OrderStatusChangedEvent): string | null {
  if (evt.runWorkflows) return null;
  const status = 'to' in evt ? evt.to : evt.status;
  if (evt.imported && status !== 'pending_confirmation') return 'imported order not pending_confirmation';
  if ('actor' in evt && (evt.actor.kind === 'integration' || evt.actor.kind === 'ai')
    && evt.deliveryDate && Date.now() - new Date(evt.deliveryDate).getTime() > BACKDATED_MS) {
    return 'integration change with a delivery date older than 1 day';
  }
  return null;
}


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

/** What the loop guard needs: the order, the depth, and which workflows already ran for it in the last minute. */
interface RunGuard {
  orderId: number;
  depth: number;
  recent: Set<number>;
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
        conditions: data.conditions || {},
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

    // Prisma ignores undefined fields on update. Explicitly convert to null
    // so clearing conditions/description actually persists to the DB.
    const data: any = { ...updateData };
    if ('conditions' in data && data.conditions === undefined) data.conditions = null;
    if ('description' in data && data.description === undefined) data.description = null;

    const updated = await prisma.workflow.update({
      where: { id: workflowId },
      data,
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

    return this.runLoaded(workflow, input);
  }

  /** Check the workflow's conditions against the input, then queue a run. `workflow` is already loaded and active. */
  private async runLoaded(workflow: Workflow, input?: any, guard?: RunGuard) {
    // For manual execution (no input), skip workflow-level conditions
    // The queue worker will handle finding orders that match conditions
    const isManualExecution = !input || Object.keys(input).length === 0;

    // Check conditions only for automatic triggers with input
    if (!isManualExecution && workflow.conditions && !this.evaluateConditions(workflow.conditions, input)) {
      logger.info('Workflow conditions not met', { workflowId: workflow.id, input });
      return { message: 'Workflow conditions not met' };
    }

    return this.enqueueRun(workflow, input, guard);
  }

  /**
   * Loop guard, execution record, queue: the one place a run is created (manual and triggered).
   * `guard` is given for runs caused by an order event (M2-T17).
   */
  private async enqueueRun(workflow: Workflow, input?: any, guard?: RunGuard) {
    if (guard && await this.loopGuardHit(workflow, input, guard)) {
      return { message: LOOP_GUARD_MESSAGE };
    }

    // Create execution record
    const execution = await prisma.workflowExecution.create({
      data: {
        tenantId: resolveTenantId(workflow.tenantId),
        workflowId: workflow.id,
        status: 'pending',
        input: input || {},
      }
    });

    // Capture tenant context so the queue worker can restore it
    const tenantId = getTenantId();

    // Add to queue for async processing (with 5s timeout to prevent API hang)
    await Promise.race([
      workflowQueue.add('execute-workflow', {
        executionId: execution.id,
        workflowId: workflow.id,
        actions: workflow.actions,
        conditions: workflow.conditions,
        input: input || {},
        tenantId,
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Workflow queue is currently unavailable. Please try again later.')), 5000)
      )
    ]);

    logger.info('Workflow execution started', {
      workflowId: workflow.id,
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

      case 'send_whatsapp':
        return this.executeSendWhatsApp(action, context);

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
    const { smsService } = await import('./smsService');
    const phone = action.phoneNumber || context.phoneNumber;
    const message = action.message;
    if (!phone || !message) {
      logger.warn('executeSendSMS: missing phone or message', { action, context });
      return { success: false, error: 'Missing phone or message' };
    }
    const result = await smsService.sendSms({
      to: phone,
      body: message,
      orderId: context.orderId,
      customerId: context.customerId,
    });
    return { success: true, messageLogId: result.messageLogId, to: phone };
  }

  /**
   * Execute send email action.
   * Delegates to the shared sendWorkflowEmail path (one config shape, one renderer,
   * MessageLog + idempotency) so this synchronous executor and the BullMQ worker
   * behave identically.
   */
  private async executeSendEmail(action: any, context: any): Promise<any> {
    const { sendWorkflowEmail } = await import('./emailService');
    const result = await sendWorkflowEmail(action.config || {}, { orderId: context.orderId });
    return { success: result.sent, skipped: result.skipped, messageLogId: result.messageLogId, reason: result.reason };
  }

  /**
   * Execute send WhatsApp action
   */
  private async executeSendWhatsApp(action: any, context: any): Promise<any> {
    const { sendWhatsAppForOrder } = await import('./whatsappService');
    const result = await sendWhatsAppForOrder(action.config?.templateKey, context.orderId, action.config?.customLink);

    logger.info('WhatsApp message sent via workflow', {
      orderId: context.orderId,
      messageLogId: result.messageLogId,
    });

    return { success: true, messageLogId: result.messageLogId };
  }

  /**
   * Execute update order action
   */
  private async executeUpdateOrder(action: any, context: any): Promise<any> {
    const orderId = action.orderId || context.orderId;

    if (!orderId) {
      throw new Error('Order ID not provided');
    }

    // The status moves through the state machine as the system user (M2-T16); `depth` is the loop guard count.
    await setOrderStatusByWorkflow(orderId, workflowStatus(action), context.depth);

    logger.info('Order updated via workflow', { orderId, status: workflowStatus(action) });
    return { success: true, orderId, updates: { status: workflowStatus(action) } };
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

    await assignmentService.assignByRole(orderId, agentId, 'delivery_agent', await systemActor());

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

    await addOrderTag(orderId, tag);

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

    // Assign through the service: order, history row and notification (M2-T16)
    await assignmentService.assignByRole(
      orderId, selectedUser.id, targetField === 'customerRepId' ? 'sales_rep' : 'delivery_agent', await systemActor(),
    );

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
      'send_whatsapp',
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
   * Ids of the given workflows that already ran for this order in the last minute (one query for all of them).
   * Empty at the depth limit: those runs are skipped without it.
   */
  private async recentRunIds(workflowIds: number[], orderId: number, depth: number): Promise<Set<number>> {
    if (depth >= LOOP_GUARD_MAX_DEPTH || workflowIds.length === 0) return new Set();
    const rows = await prisma.workflowExecution.findMany({
      where: {
        workflowId: { in: workflowIds },
        status: { not: 'skipped' },
        startedAt: { gte: new Date(Date.now() - LOOP_GUARD_WINDOW_MS) },
        input: { path: ['orderId'], equals: orderId },
      },
      select: { workflowId: true },
      distinct: ['workflowId'],
    });
    return new Set(rows.map((r) => r.workflowId));
  }

  /**
   * Loop guard (M2-T17): true when this run must not happen, and records the skip in the execution log.
   * Too deep (a chain of workflow-caused moves), or the workflow already ran for this order in the last minute.
   */
  private async loopGuardHit(workflow: Workflow, input: any, { orderId, depth, recent }: RunGuard): Promise<boolean> {
    const tooDeep = depth >= LOOP_GUARD_MAX_DEPTH;
    if (!tooDeep && !recent.has(workflow.id)) return false;

    await prisma.workflowExecution.create({
      data: {
        tenantId: resolveTenantId(workflow.tenantId),
        workflowId: workflow.id,
        status: 'skipped',
        input: input || {},
        error: LOOP_GUARD_MESSAGE,
        completedAt: new Date(),
      },
    });
    logger.warn(LOOP_GUARD_MESSAGE, { workflowId: workflow.id, orderId, depth, tooDeep });
    return true;
  }

  /**
   * Status change workflows triggered. Runs from the `order.status_changed` event (see `registerWorkflowListeners`).
   * `depth` is how many workflow-caused moves led here; it rides in the execution input so `update_order` can pass it on.
   */
  async triggerStatusChangeWorkflows(orderId: number, oldStatus: string, newStatus: string, depth: number = 0) {
    // Query both 'status' and 'targetStatus' paths since the wizard and editor
    // store the target status under different keys
    const workflows = await prisma.workflow.findMany({
      where: {
        isActive: true,
        triggerType: 'status_change',
        OR: [
          { triggerData: { path: ['status'], equals: newStatus } },
          { triggerData: { path: ['targetStatus'], equals: newStatus } },
        ],
      }
    }) || [];

    if (workflows.length === 0) {
      logger.info('Status change workflows triggered', { orderId, oldStatus, newStatus, workflowsTriggered: 0 });
      return;
    }

    // Load order with products for condition evaluation (e.g. product-specific workflows)
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { orderItems: { select: { product: { select: { name: true } } } } },
    });

    const input = {
      orderId,
      oldStatus,
      newStatus,
      depth,
      productName: order?.orderItems
        ?.map((item: any) => item.product?.name)
        .filter(Boolean)
        .join(', ') || '',
    };

    const recent = await this.recentRunIds(workflows.map((w) => w.id), orderId, depth);
    for (const workflow of workflows) {
      await this.runLoaded(workflow, input, { orderId, depth, recent });
    }

    logger.info('Status change workflows triggered', {
      orderId,
      oldStatus,
      newStatus,
      workflowsTriggered: workflows.length
    });
  }

  /**
   * Trigger workflows with order_created trigger type. Runs from the `order.created` event.
   */
  async triggerOrderCreatedWorkflows(order: { id: number }) {
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
        orderId: fullOrder.id,
        productName: (fullOrder.orderItems || []).map((item: any) => item.product?.name || 'Unknown Product').join(', ')
      };

      const recent = await this.recentRunIds(workflows.map((w) => w.id), order.id, 0);

      // Trigger each workflow. Workflow-level conditions are not checked for a new order (as before).
      for (const workflow of workflows) {
        try {
          await this.enqueueRun(workflow, orderContext, { orderId: order.id, depth: 0, recent });
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
   * Listener for `order.status_changed` (M2-T17). Applies the skip rules, then triggers inside the order's tenant.
   * Never throws: the status change is already committed.
   */
  async onStatusChanged(evt: OrderStatusChangedEvent): Promise<void> {
    try {
      const skip = workflowSkipReason(evt);
      if (skip) {
        logger.info('Status change workflows skipped', { orderId: evt.orderId, to: evt.to, reason: skip });
        return;
      }
      await runInTenant(evt.tenantId, () => this.triggerStatusChangeWorkflows(evt.orderId, evt.from, evt.to, evt.depth));
    } catch (error: any) {
      logger.error('Failed to trigger status change workflows', { orderId: evt.orderId, error: error.message });
    }
  }

  /** Listener for `order.created` (M2-T17). Same skip rules; never throws. */
  async onOrderCreated(evt: OrderCreatedEvent): Promise<void> {
    try {
      const skip = workflowSkipReason(evt);
      if (skip) {
        logger.info('Order created workflows skipped', { orderId: evt.orderId, status: evt.status, reason: skip });
        return;
      }
      await runInTenant(evt.tenantId, () => this.triggerOrderCreatedWorkflows({ id: evt.orderId }));
    } catch (error: any) {
      logger.error('Failed to trigger order_created workflows', { orderId: evt.orderId, error: error.message });
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

const workflowService = new WorkflowService();

let registered = false;
/** Listen to the state machine's events. Idempotent; the server calls it at bootstrap (tests call it or import the server). */
export function registerWorkflowListeners(): void {
  if (registered) return;
  registered = true;
  onOrderEvent(AppEvent.ORDER_STATUS_CHANGED, (evt) => { void workflowService.onStatusChanged(evt); });
  onOrderEvent(AppEvent.ORDER_CREATED, (evt) => { void workflowService.onOrderCreated(evt); });
}

export default workflowService;
