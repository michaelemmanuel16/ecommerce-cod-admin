import Bull from 'bull';
import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { evaluateConditions } from '../utils/conditionEvaluator';
import { getSocketInstance } from '../utils/socketInstance';
import { emitToTenant } from '../sockets/index';
import { runJobInTenant, getTenantId } from '../utils/tenantContext';
import assignmentService from '../services/assignmentService';
import { systemActor } from '../services/systemUserService';
import { updateOrderByWorkflow } from '../services/workflowActions';

// Send actions read tenant-scoped provider config (SystemConfig) and write
// tenant-scoped MessageLog rows. They refuse to run with no tenant context.
const TENANT_SCOPED_SEND_ACTIONS = new Set([
  'send_email',
  'send_sms',
  'send_whatsapp',
  'send_digital_product', // forward-looking: action lands in MAN-80; guard is in place first
]);

const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD,
};

// Use dummy queue for tests to avoid Redis connection errors
export const workflowQueue = process.env.NODE_ENV === 'test'
  ? ({
    process: () => { },
    on: () => { },
    add: () => { },
    close: () => Promise.resolve(),
  } as any)
  : new Bull('workflow-execution', {
    redis: redisConfig,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000
      }
    }
  });


export const processExecuteWorkflow = async (job: Bull.Job) => {
  const { executionId, workflowId, actions, conditions, input, tenantId } = job.data;

  // Restore tenant context so all Prisma queries (MessageLog, SystemConfig, etc.)
  // are scoped to the correct tenant
  const processJob = async () => {
    logger.info('Processing workflow execution', { executionId, workflowId, tenantId, hasConditions: !!conditions });

    const io = getSocketInstance();
    if (io) {
      emitToTenant(io, 'workflow:execution_started', { workflowId, executionId });
    }

    try {
      await prisma.workflowExecution.update({
        where: { id: executionId },
        data: { status: 'running' }
      });

      const output: any = { steps: [] };

      // Execute actions sequentially
      for (const action of actions) {
        try {
          const result = await executeAction(action, input, conditions);
          output.steps.push({
            action: action.type,
            success: true,
            result
          });

          // If action has a wait, delay
          if (action.type === 'wait' && action.config.duration) {
            await new Promise(resolve => setTimeout(resolve, action.config.duration));
          }
        } catch (error: any) {
          output.steps.push({
            action: action.type,
            success: false,
            error: error.message
          });

          // If action fails, stop execution
          throw error;
        }
      }

      await prisma.workflowExecution.update({
        where: { id: executionId },
        data: {
          status: 'completed',
          output,
          completedAt: new Date()
        }
      });

      logger.info('Workflow execution completed', { executionId });

      if (io) {
        emitToTenant(io, 'workflow:execution_completed', {
          workflowId,
          executionId,
          status: 'completed',
          completedAt: new Date()
        });
      }
    } catch (error: any) {
      logger.error('Workflow execution failed', { executionId, error: error.message });

      if (io) {
        emitToTenant(io, 'workflow:execution_completed', {
          workflowId,
          executionId,
          status: 'failed',
          error: error.message
        });
      }

      await prisma.workflowExecution.update({
        where: { id: executionId },
        data: {
          status: 'failed',
          error: error.message,
          completedAt: new Date()
        }
      });

      throw error;
    }
  };

  return runJobInTenant(`Workflow job ${job.id} (execution ${executionId})`, tenantId, processJob);
};
workflowQueue.process('execute-workflow', processExecuteWorkflow);

async function executeAssignUserAction(action: any, input: any, conditions?: any): Promise<any> {
  const config = action.config || {};
  const userType = config.userType; // 'sales_rep' | 'delivery_agent'
  const distributionMode = config.distributionMode || 'even';
  let assignments = config.assignments || [];
  // Backfill is opt-in and OFF by default. When false (the default), this action is
  // forward-only: it assigns ONLY the order that triggered the workflow. When true, it
  // performs a one-time sweep of every order currently unassigned for this role.
  // In BOTH modes it never overwrites an order that already has a user (no swapping).
  const applyToAllUnassigned = config.applyToAllUnassigned === true;

  // Determine which field to update
  const targetField = userType === 'sales_rep' ? 'customerRepId' : 'deliveryAgentId';

  // Writes the order, the history row and the notification through the assignment service, as the system user.
  const actor = await systemActor();
  const assignTo = (orderId: number, userId: number) => assignmentService.assignByRole(orderId, userId, userType, actor);

  logger.info('Executing assign_user action', {
    userType,
    distributionMode,
    assignmentsCount: assignments.length,
    applyToAllUnassigned,
    hasConditions: !!conditions
  });

  if (assignments.length === 0) {
    return { assigned: 0, message: 'No users configured for assignment' };
  }

  // F-709: an unavailable delivery partner is skipped
  if (userType === 'delivery_agent') {
    const available = await prisma.user.findMany({
      where: { id: { in: assignments.map((a: any) => a.userId) }, isActive: true, isAvailable: true },
      select: { id: true },
    });
    const availableIds = new Set(available.map((u) => u.id));
    assignments = assignments.filter((a: any) => availableIds.has(a.userId));
    if (assignments.length === 0) {
      return { assigned: 0, message: 'No available delivery partner in the assignment list' };
    }
  }

  const orderInclude = { orderItems: { include: { product: true } } };
  let orders: any[];

  if (applyToAllUnassigned) {
    // One-time backfill (explicit opt-in): every order currently unassigned for this role.
    orders = await prisma.order.findMany({
      where: { [targetField]: null } as any,
      include: orderInclude,
      orderBy: { createdAt: 'asc' }
    });
    logger.info(`assign_user backfill: found ${orders.length} unassigned orders`);
  } else {
    // Forward-only (default): act ONLY on the order that triggered this workflow.
    const triggerOrderId = input?.orderId ?? input?.id;
    if (!triggerOrderId) {
      logger.info('assign_user forward-only: no triggering order in context, nothing to do');
      return { assigned: 0, message: 'Forward-only assign_user: no triggering order in context' };
    }
    const order = await prisma.order.findUnique({
      where: { id: triggerOrderId },
      include: orderInclude
    });
    if (!order) {
      return { assigned: 0, message: `Forward-only assign_user: order ${triggerOrderId} not found` };
    }
    // Never swap: leave an order that already has a user for this role untouched.
    if ((order as any)[targetField] != null) {
      logger.info('assign_user forward-only: order already assigned, leaving as-is', { orderId: triggerOrderId, userType });
      return { assigned: 0, message: 'Order already has an assigned user; left unchanged' };
    }
    orders = [order];
  }

  if (orders.length === 0) {
    return { assigned: 0, message: 'No orders found to assign' };
  }

  // Filter orders by workflow conditions
  let ordersToAssign = orders;
  if (conditions) {
    ordersToAssign = orders.filter(order => {
      // Transform order to include productName field for condition evaluation
      const orderContext = {
        ...order,
        productName: order.orderItems.map((item: any) => item.product.name).join(', ')
      };

      const matches = evaluateConditions(conditions, orderContext);
      logger.debug('Order condition check', {
        orderId: order.id,
        productName: orderContext.productName,
        matches
      });
      return matches;
    });

    logger.info(`After condition filtering: ${ordersToAssign.length} of ${orders.length} orders match`);
  }

  if (ordersToAssign.length === 0) {
    return { assigned: 0, message: 'No orders match the workflow conditions' };
  }

  if (assignments.length === 0) {
    return { assigned: 0, message: 'No users configured for assignment' };
  }

  let assignedCount = 0;
  const results = [];

  // Even distribution
  if (distributionMode === 'even') {
    for (let i = 0; i < ordersToAssign.length; i++) {
      const assignmentIndex = i % assignments.length;
      const assignment = assignments[assignmentIndex];

      await assignTo(ordersToAssign[i].id, assignment.userId);

      assignedCount++;
      results.push({
        orderId: ordersToAssign[i].id,
        assignedTo: assignment.userId
      });

      logger.info('Order assigned (even)', {
        orderId: ordersToAssign[i].id,
        userId: assignment.userId
      });
    }
  }
  // Weighted distribution
  else if (distributionMode === 'weighted') {
    const totalWeight = assignments.reduce((sum: number, a: any) => sum + (a.weight || 0), 0);

    if (totalWeight === 0) {
      return { assigned: 0, message: 'Total weight is 0, cannot distribute' };
    }

    for (const order of ordersToAssign) {
      // Generate random number and select user based on weight
      const random = Math.random() * totalWeight;
      let cumulative = 0;
      let selectedUserId = assignments[0].userId;

      for (const assignment of assignments) {
        cumulative += assignment.weight || 0;
        if (random <= cumulative) {
          selectedUserId = assignment.userId;
          break;
        }
      }

      await assignTo(order.id, selectedUserId);

      assignedCount++;
      results.push({
        orderId: order.id,
        assignedTo: selectedUserId
      });

      logger.info('Order assigned (weighted)', {
        orderId: order.id,
        userId: selectedUserId
      });
    }
  }

  return {
    assigned: assignedCount,
    results,
    message: `Successfully assigned ${assignedCount} orders`
  };
}

// Exported for unit testing of the fail-closed tenant guard.
export async function executeAction(action: any, input: any, conditions?: any): Promise<any> {
  // Fail closed: never run a tenant-scoped send without tenant context (C1).
  if (TENANT_SCOPED_SEND_ACTIONS.has(action.type) && !getTenantId()) {
    throw new Error(`Refusing to run "${action.type}" with no tenant context`);
  }

  switch (action.type) {
    case 'send_sms': {
      const { smsService } = await import('../services/smsService');
      const phone = action.config.phoneNumber || action.config.to;
      const message = action.config.message;
      if (!phone || !message) {
        logger.warn('send_sms action missing phone or message', { config: action.config });
        return { sent: false, error: 'Missing phone or message' };
      }
      const smsResult = await smsService.sendSms({
        to: phone,
        body: message,
        orderId: input.orderId,
        customerId: input.customerId,
      });
      return { sent: true, messageLogId: smsResult.messageLogId };
    }

    case 'send_email': {
      const { sendWorkflowEmail } = await import('../services/emailService');
      return sendWorkflowEmail(action.config || {}, { orderId: input.orderId });
    }

    case 'send_whatsapp': {
      const { sendWhatsAppForOrder } = await import('../services/whatsappService');
      const result = await sendWhatsAppForOrder(action.config.templateKey, input.orderId, action.config.customLink);
      return { sent: true, messageLogId: result.messageLogId };
    }

    case 'update_order': {
      const orderId = action.config?.orderId ?? input?.orderId;
      const result = await updateOrderByWorkflow(orderId, action, input?.depth);
      return { orderId, updated: result.changed, updates: result.updates };
    }

    case 'assign_agent':
      await assignmentService.assignByRole(
        action.config?.orderId ?? input?.orderId, action.config.agentId, 'delivery_agent', await systemActor(), { checkAvailable: true },
      );
      return { assigned: true };

    case 'assign_user':
      return await executeAssignUserAction(action, input, conditions);

    case 'add_tag':
      const customer = await prisma.customer.findUnique({
        where: { id: action.config.customerId }
      });
      if (customer) {
        await prisma.customer.update({
          where: { id: action.config.customerId },
          data: {
            tags: [...customer.tags, action.config.tag]
          }
        });
      }
      return { tagged: true };

    case 'http_request':
      logger.info('Making HTTP request', { url: action.config.url });
      // Make HTTP request here
      return { success: true };

    default:
      throw new Error(`Unknown action type: ${action.type}`);
  }
}

workflowQueue.on('completed', (job: Bull.Job) => {
  logger.info('Workflow job completed', { jobId: job.id });
});

workflowQueue.on('failed', (job: Bull.Job | undefined, err: Error) => {
  logger.error('Workflow job failed', { jobId: job?.id, error: err.message });
});

export default workflowQueue;
