import Bull from 'bull';
import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { evaluateConditions } from '../utils/conditionEvaluator';
import { getSocketInstance } from '../utils/socketInstance';
import { emitToTenant } from '../sockets/index';
import { runJobInTenant, getTenantId } from '../utils/tenantContext';
import assignmentService from '../services/assignmentService';
import { systemActor } from '../services/systemUserService';
import { runHttpRequestAction, updateOrderByWorkflow } from '../services/workflowActions';

// Send actions read tenant-scoped provider config (SystemConfig) and write
// tenant-scoped MessageLog rows. They refuse to run with no tenant context.
const TENANT_SCOPED_SEND_ACTIONS = new Set([
  'send_email',
  'send_sms',
  'send_whatsapp',
  'send_auto_confirm',
  'send_digital_product', // forward-looking: action lands in MAN-80; guard is in place first
]);

const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD,
};

/** A run that has been executing (waits not counted) for longer than this stops and is marked failed `time_limit` (M9-T21). */
export const MAX_RUN_ACTIVE_MS = 10 * 60 * 1000;
export const TIME_LIMIT_REASON = 'time_limit';
export const EXECUTE_JOB = 'execute-workflow';
export const RESUME_JOB = 'resume-workflow';
/** Repeat job: add the runs waiting in the trigger outbox (queue was down when they fired). */
export const DRAIN_OUTBOX_JOB = 'drain-workflow-outbox';
/** Repeat job of one schedule workflow (M9-T22), see workflowSchedule.ts. */
export const SCHEDULE_JOB = 'run-scheduled-workflow';
/** Bull keeps a delay in a 32-bit field. */
const MAX_DELAY_MS = 2 ** 31 - 1;

/** Deterministic: adding the same resume twice does nothing. `stepIndex` is the step the run continues from. */
export const resumeJobId = (executionId: number, stepIndex: number) => `wf-resume:${executionId}:${stepIndex}`;

export function createWorkflowQueue(name = 'workflow-execution', redis: typeof redisConfig = redisConfig): Bull.Queue {
  return new Bull(name, {
    redis,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000
      }
    }
  });
}

// Use dummy queue for tests to avoid Redis connection errors
export const workflowQueue = process.env.NODE_ENV === 'test'
  ? ({
    process: () => { },
    on: () => { },
    add: () => { },
    close: () => Promise.resolve(),
  } as any)
  : createWorkflowQueue();

/** What a run needs from the queue: to schedule the resume after a wait. */
type ResumeScheduler = Pick<Bull.Queue, 'add'>;

interface RunState {
  executionId: number;
  workflowId: number;
  actions: any[];
  conditions?: any;
  input: any;
  tenantId?: string | null;
  /** Step to start from: 0 for a new run, the step after the wait for a resume. */
  startIndex: number;
  steps: any[];
  /** Milliseconds this run has spent executing before this segment (waits not counted). */
  activeMs: number;
}

/** Run the steps from `startIndex`. A `wait` saves the state, schedules the resume as a delayed job and returns: no worker is held. */
async function runSteps(state: RunState, queue: ResumeScheduler): Promise<void> {
  const { executionId, workflowId, actions, conditions, input, tenantId, startIndex } = state;
  const steps = [...state.steps];
  const segmentStart = Date.now();
  const spentMs = () => state.activeMs + (Date.now() - segmentStart);
  const io = getSocketInstance();

  const emitFinished = (payload: Record<string, unknown>) => {
    if (io) emitToTenant(io, 'workflow:execution_completed', { workflowId, executionId, ...payload });
  };
  const failRun = async (message: string, failedStepIndex?: number) => {
    await prisma.workflowExecution.update({
      where: { id: executionId },
      data: {
        status: 'failed', error: message, steps, output: { activeMs: spentMs() }, resumeAt: null, completedAt: new Date(),
        ...(failedStepIndex !== undefined ? { failedStepIndex } : {}),
      }
    });
    emitFinished({ status: 'failed', error: message });
  };

  let i = startIndex;
  try {
    for (; i < actions.length; i++) {
      if (spentMs() > MAX_RUN_ACTIVE_MS) {
        logger.warn('Workflow run stopped: time limit', { executionId, workflowId, activeMs: spentMs() });
        await failRun(TIME_LIMIT_REASON, i);
        return; // a stopped run is final: no throw, so Bull does not retry it
      }
      const action = actions[i];

      if (action.type === 'wait') {
        // Seconds, as the editor says ("Wait Duration (seconds)")
        const seconds = Number(action.config?.duration ?? action.duration ?? 0);
        const delayMs = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, MAX_DELAY_MS) : 0;
        if (delayMs > 0) {
          const resumeAt = new Date(Date.now() + delayMs);
          steps.push({ action: 'wait', success: true, result: { waitSeconds: seconds, resumeAt: resumeAt.toISOString() } });
          // Step state lives in the `steps` and `resumeAt` columns; the time spent so far (waits not counted) in `output.activeMs`.
          await prisma.workflowExecution.update({
            where: { id: executionId },
            data: { status: 'waiting', steps, resumeAt, output: { activeMs: spentMs() } }
          });
          await queue.add(RESUME_JOB, {
            executionId, workflowId, actions, conditions, input, tenantId, nextIndex: i + 1,
          }, { delay: delayMs, jobId: resumeJobId(executionId, i + 1) });
          logger.info('Workflow waiting', { executionId, nextIndex: i + 1, resumeAt: resumeAt.toISOString() });
          return;
        }
        steps.push({ action: 'wait', success: true, result: { message: 'No wait time set' } });
        continue;
      }

      try {
        const result = await executeAction(action, input, conditions);
        steps.push({ action: action.type, success: true, result });
      } catch (error: any) {
        steps.push({ action: action.type, success: false, error: error.message });

        // If action fails, stop execution
        throw error;
      }
    }

    if (spentMs() > MAX_RUN_ACTIVE_MS) {
      await failRun(TIME_LIMIT_REASON, actions.length - 1);
      return;
    }

    await prisma.workflowExecution.update({
      where: { id: executionId },
      data: {
        status: 'completed',
        steps,
        output: { activeMs: spentMs() },
        resumeAt: null,
        completedAt: new Date()
      }
    });

    logger.info('Workflow execution completed', { executionId });
    emitFinished({ status: 'completed', completedAt: new Date() });
  } catch (error: any) {
    logger.error('Workflow execution failed', { executionId, error: error.message });
    await failRun(error.message, i);
    throw error;
  }
}

export const processExecuteWorkflow = async (job: Bull.Job, queue: ResumeScheduler = workflowQueue) => {
  const { executionId, workflowId, actions, conditions, input, tenantId } = job.data;

  // Restore tenant context so all Prisma queries (MessageLog, SystemConfig, etc.)
  // are scoped to the correct tenant
  const processJob = async () => {
    logger.info('Processing workflow execution', { executionId, workflowId, tenantId, hasConditions: !!conditions });

    const io = getSocketInstance();
    if (io) {
      emitToTenant(io, 'workflow:execution_started', { workflowId, executionId });
    }

    await prisma.workflowExecution.update({
      where: { id: executionId },
      data: { status: 'running' }
    });

    await runSteps({ executionId, workflowId, actions, conditions, input, tenantId, startIndex: 0, steps: [], activeMs: 0 }, queue);
  };

  return runJobInTenant(`Workflow job ${job.id} (execution ${executionId})`, tenantId, processJob);
};

/**
 * The delayed job a `wait` leaves behind (M9-T21): load the execution and go on from the step after the wait.
 * Only a `waiting` execution resumes, and it is claimed in one update, so a double add or a Bull retry cannot run the steps twice.
 */
export const processResumeWorkflow = async (job: Bull.Job, queue: ResumeScheduler = workflowQueue) => {
  const { executionId, workflowId, actions, conditions, input, tenantId, nextIndex } = job.data;

  const resumeJob = async () => {
    const execution = await prisma.workflowExecution.findUnique({ where: { id: executionId } });
    if (!execution || execution.status !== 'waiting') {
      logger.info('Workflow resume skipped: not waiting', { executionId, status: execution?.status ?? 'missing' });
      return;
    }
    const claimed = await prisma.workflowExecution.updateMany({
      where: { id: executionId, status: 'waiting' },
      data: { status: 'running' }
    });
    if (claimed.count === 0) return;

    // Executions saved before the columns existed kept their steps in `output.steps`: read those when `steps` is empty.
    const saved: any = execution.output ?? {};
    const columnSteps = Array.isArray(execution.steps) ? execution.steps : [];
    await runSteps({
      executionId, workflowId, actions, conditions, input, tenantId,
      startIndex: nextIndex,
      steps: columnSteps.length > 0 ? columnSteps : Array.isArray(saved.steps) ? saved.steps : [],
      activeMs: Number(saved.activeMs) || 0,
    }, queue);
  };

  return runJobInTenant(`Workflow resume ${job.id} (execution ${executionId})`, tenantId, resumeJob);
};

/** Attach both processors to a queue. The module does it for the shared queue; a test does it for its own. */
export function registerWorkflowProcessors(queue: Bull.Queue): void {
  queue.process(EXECUTE_JOB, (job: Bull.Job) => processExecuteWorkflow(job, queue));
  queue.process(RESUME_JOB, (job: Bull.Job) => processResumeWorkflow(job, queue));
  // Loaded when the job runs: workflowEnqueue imports this module
  queue.process(DRAIN_OUTBOX_JOB, async () => (await import('./workflowEnqueue')).drainWorkflowOutbox());
  // Same reason: workflowSchedule imports this module
  queue.process(SCHEDULE_JOB, async (job: Bull.Job) => (await import('./workflowSchedule')).processScheduledJob(job));
}

/** Start the 30 s outbox drain. Replaces an older repeat of the same job, so a restart never doubles it. */
export async function setupWorkflowOutboxCron(queue: Bull.Queue = workflowQueue): Promise<void> {
  if (process.env.NODE_ENV === 'test') return;
  for (const repeat of await queue.getRepeatableJobs()) {
    if (repeat.name === DRAIN_OUTBOX_JOB) await queue.removeRepeatableByKey(repeat.key);
  }
  const { DRAIN_EVERY_MS } = await import('./workflowEnqueue');
  await queue.add(DRAIN_OUTBOX_JOB, {}, { repeat: { every: DRAIN_EVERY_MS }, removeOnComplete: true, removeOnFail: true, attempts: 1 });
  logger.info('Workflow outbox drain scheduled (every 30 s).');
}
if (process.env.NODE_ENV !== 'test') registerWorkflowProcessors(workflowQueue);

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

  // F-709: an unavailable delivery partner is skipped; so is one blocked for unpaid cash (T36)
  if (userType === 'delivery_agent') {
    const available = await prisma.user.findMany({
      where: { id: { in: assignments.map((a: any) => a.userId) }, isActive: true, isAvailable: true },
      select: { id: true },
    });
    const blocked = await prisma.agentBalance.findMany({ where: { agentId: { in: available.map((u) => u.id) }, isBlocked: true }, select: { agentId: true } });
    const blockedIds = new Set(blocked.map((b) => b.agentId));
    const availableIds = new Set(available.filter((u) => !blockedIds.has(u.id)).map((u) => u.id));
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
      if (!smsResult.sent) throw new Error('SMS is not set up: message not sent');
      return { sent: true, messageLogId: smsResult.messageLogId };
    }

    case 'send_email': {
      const { sendWorkflowEmail } = await import('../services/emailService');
      return sendWorkflowEmail(action.config || {}, { orderId: input.orderId });
    }

    case 'send_whatsapp': {
      const { sendWhatsAppForOrder } = await import('../services/whatsappService');
      const result = await sendWhatsAppForOrder(action.config.templateKey, input.orderId, action.config.customLink);
      // sent === false: channel not set up. (An opted-out customer returns no `sent` field and stays a quiet skip.)
      if (result.sent === false) throw new Error('WhatsApp is not set up: message not sent');
      return { sent: true, messageLogId: result.messageLogId };
    }

    case 'send_auto_confirm': {
      const { runAutoConfirmAction } = await import('../services/autoConfirmService');
      const result = await runAutoConfirmAction(input.orderId, getTenantId(), action.config);
      // Ineligible / already sent is a skip, not a failure
      if (result.skipped) return { sent: false, skipped: true, reason: result.reason };
      return { sent: true, channel: result.channel };
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
      return runHttpRequestAction(action);

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
