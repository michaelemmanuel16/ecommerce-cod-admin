import Bull from 'bull';
import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { evaluateConditions } from '../utils/conditionEvaluator';
import { getSocketInstance } from '../utils/socketInstance';
import { emitOrderUpdated, emitOrderAssigned } from '../sockets/index';

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


workflowQueue.process('execute-workflow', async (job: Bull.Job) => {
  const { executionId, workflowId, actions, conditions, input } = job.data;

  logger.info('Processing workflow execution', { executionId, workflowId, hasConditions: !!conditions });

  const io = getSocketInstance();
  if (io) {
    io.emit('workflow:execution_started', { workflowId, executionId });
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
      io.emit('workflow:execution_completed', {
        workflowId,
        executionId,
        status: 'completed',
        completedAt: new Date()
      });
    }
  } catch (error: any) {
    logger.error('Workflow execution failed', { executionId, error: error.message });

    if (io) {
      io.emit('workflow:execution_completed', {
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
});

async function executeAssignUserAction(action: any, _input: any, conditions?: any): Promise<any> {
  const config = action.config || {};
  const userType = config.userType; // 'sales_rep' | 'delivery_agent'
  const distributionMode = config.distributionMode || 'even';
  const assignments = config.assignments || [];
  const onlyUnassigned = config.onlyUnassigned !== undefined ? config.onlyUnassigned : true;

  // Determine which field to update
  const targetField = userType === 'sales_rep' ? 'customerRepId' : 'deliveryAgentId';

  logger.info('Executing assign_user action', {
    userType,
    distributionMode,
    assignmentsCount: assignments.length,
    onlyUnassigned,
    hasConditions: !!conditions
  });

  // Find orders that need assignment - include product data for condition evaluation
  const whereClause: any = {};
  if (onlyUnassigned) {
    whereClause[targetField] = null;
  }

  const orders = await prisma.order.findMany({
    where: whereClause,
    include: {
      orderItems: {
        include: {
          product: true
        }
      }
    },
    orderBy: { createdAt: 'asc' }
  });

  logger.info(`Found ${orders.length} unassigned orders to check`);

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
    const io = getSocketInstance();

    for (let i = 0; i < ordersToAssign.length; i++) {
      const assignmentIndex = i % assignments.length;
      const assignment = assignments[assignmentIndex];

      const updatedOrder = await prisma.order.update({
        where: { id: ordersToAssign[i].id },
        data: { [targetField]: assignment.userId }
      });

      assignedCount++;
      results.push({
        orderId: ordersToAssign[i].id,
        assignedTo: assignment.userId
      });

      logger.info('Order assigned (even)', {
        orderId: ordersToAssign[i].id,
        userId: assignment.userId
      });

      // Emit Socket.io events for real-time updates
      if (io) {
        emitOrderUpdated(io, updatedOrder);
        emitOrderAssigned(io, updatedOrder, assignment.userId, userType);
        logger.debug('Socket.io events emitted for order assignment', {
          orderId: updatedOrder.id
        });
      }
    }
  }
  // Weighted distribution
  else if (distributionMode === 'weighted') {
    const totalWeight = assignments.reduce((sum: number, a: any) => sum + (a.weight || 0), 0);

    if (totalWeight === 0) {
      return { assigned: 0, message: 'Total weight is 0, cannot distribute' };
    }

    const io = getSocketInstance();

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

      const updatedOrder = await prisma.order.update({
        where: { id: order.id },
        data: { [targetField]: selectedUserId }
      });

      assignedCount++;
      results.push({
        orderId: order.id,
        assignedTo: selectedUserId
      });

      logger.info('Order assigned (weighted)', {
        orderId: order.id,
        userId: selectedUserId
      });

      // Emit Socket.io events for real-time updates
      if (io) {
        emitOrderUpdated(io, updatedOrder);
        emitOrderAssigned(io, updatedOrder, selectedUserId, userType);
        logger.debug('Socket.io events emitted for order assignment', {
          orderId: updatedOrder.id
        });
      }
    }
  }

  return {
    assigned: assignedCount,
    results,
    message: `Successfully assigned ${assignedCount} orders`
  };
}

async function executeAction(action: any, input: any, conditions?: any): Promise<any> {
  switch (action.type) {
    case 'send_sms':
      logger.info('Sending SMS', { to: action.config.to, message: action.config.message });
      // Integrate with SMS service here
      return { sent: true };

    case 'send_email':
      logger.info('Sending email', { to: action.config.to, subject: action.config.subject });
      // Integrate with email service here
      return { sent: true };

    case 'update_order':
      const order = await prisma.order.update({
        where: { id: action.config.orderId },
        data: action.config.updates
      });
      return { orderId: order.id };

    case 'assign_agent':
      await prisma.order.update({
        where: { id: action.config.orderId },
        data: { deliveryAgentId: action.config.agentId }
      });
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
