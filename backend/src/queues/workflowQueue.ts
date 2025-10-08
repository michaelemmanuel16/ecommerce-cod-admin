import Bull from 'bull';
import prisma from '../utils/prisma';
import logger from '../utils/logger';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export const workflowQueue = new Bull('workflow-execution', REDIS_URL, {
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000
    }
  }
});

workflowQueue.process('execute-workflow', async (job) => {
  const { executionId, workflowId, actions, input } = job.data;

  logger.info('Processing workflow execution', { executionId, workflowId });

  try {
    await prisma.workflowExecution.update({
      where: { id: executionId },
      data: { status: 'running' }
    });

    const output: any = { steps: [] };

    // Execute actions sequentially
    for (const action of actions) {
      try {
        const result = await executeAction(action, input);
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
  } catch (error: any) {
    logger.error('Workflow execution failed', { executionId, error: error.message });

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

async function executeAction(action: any, input: any): Promise<any> {
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

workflowQueue.on('completed', (job) => {
  logger.info('Workflow job completed', { jobId: job.id });
});

workflowQueue.on('failed', (job, err) => {
  logger.error('Workflow job failed', { jobId: job?.id, error: err.message });
});

export default workflowQueue;
