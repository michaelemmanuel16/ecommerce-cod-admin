import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { WorkflowTriggerType, Prisma, Workflow } from '@prisma/client';
import logger from '../utils/logger';
import { enqueueWorkflowRun } from '../queues/workflowEnqueue';
import { evaluateConditions as evaluateConditionRules } from '../utils/conditionEvaluator';
import { getTenantId, resolveTenantId, runInTenant, withoutTenant } from '../utils/tenantContext';
import { AppEvent, OrderCreatedEvent, OrderStatusChangedEvent, onOrderEvent } from '../utils/appEvents';
import { onPaymentSettled, PaymentSettledEvent } from './payments/settlementHooks';
import { syncWorkflowSchedule, validateSchedule } from '../queues/workflowSchedule';
import * as Money from '../utils/money';
import { validateAssignToConfig } from './workflowAssignTo';
import { assertValidWorkflow } from './workflowValidation';
import crypto from 'crypto';

/** M2-T17 loop guard: a workflow-caused move stops at this depth; one run per order per workflow per window. */
const LOOP_GUARD_MAX_DEPTH = 3;
const LOOP_GUARD_WINDOW_MS = 60_000;
export const LOOP_GUARD_MESSAGE = 'Skipped: loop guard';
export const CONDITIONS_NOT_MET = 'conditions_not_met';
const BACKDATED_MS = 24 * 60 * 60 * 1000;

/**
 * Why an order event fires no workflows, or null when it fires them (M2-T17). `runWorkflows: true` overrides:
 * - an import that says `runWorkflows: false` (the spreadsheet upload, unless the uploader asks)
 * - an imported order (or import re-import) with a status other than pending_confirmation
 * - an integration move (partner, MCP, sync) whose delivery date is more than 1 day in the past
 */
export function workflowSkipReason(evt: OrderCreatedEvent | OrderStatusChangedEvent): string | null {
  if (evt.runWorkflows) return null;
  const status = 'to' in evt ? evt.to : evt.status;
  if (evt.imported && evt.runWorkflows === false) return 'import without runWorkflows';
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

/**
 * The schedule trigger is stored as `time_based` (the schema has no `schedule` value; lane A owns the schema).
 * The API accepts `schedule` as another word for it.
 */
export const SCHEDULE_TRIGGER: WorkflowTriggerType = 'time_based';
export function normalizeTriggerType(value: unknown): WorkflowTriggerType {
  return (value === 'schedule' ? SCHEDULE_TRIGGER : value) as WorkflowTriggerType;
}

/** sha256 hex of a webhook token: the only form that is stored. */
export const hashWebhookToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
/** 32 random bytes, base64url. */
export const newWebhookToken = () => crypto.randomBytes(32).toString('base64url');

/** What a workflow looks like to a client: never the token hash. A webhook workflow says whether it has a token. */
export function publicWorkflow<T extends { webhookTokenHash?: string | null; triggerType?: string }>(workflow: T) {
  const { webhookTokenHash, ...rest } = workflow;
  return workflow.triggerType === 'webhook' ? { ...rest, hasWebhookToken: !!webhookTokenHash } : rest;
}

/** True when the conditions hold at least one rule (the old key-value shape counts each key). */
export function hasConditionRules(conditions: any): boolean {
  if (!conditions || typeof conditions !== 'object') return false;
  if (Array.isArray(conditions.rules)) {
    return conditions.rules.some((r: any) => (r && Array.isArray(r.rules) ? hasConditionRules(r) : true));
  }
  return Object.keys(conditions).some((k) => k !== 'id' && k !== 'logic');
}

const WEBHOOK_DATA_MAX_CHARS = 64_000;
const IDEMPOTENCY_HEADER_MAX = 200;
const UPDATABLE_FIELDS = ['name', 'description', 'triggerType', 'triggerData', 'actions', 'conditions', 'isActive'] as const;

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

/** Where an execution came from, and the key that stops a double run (a second insert with the same key does nothing). */
export interface RunMeta {
  triggerSource: string;
  idempotencyKey?: string;
  orderId?: number | null;
}

/** The run history's `triggerSource` for an order event: the event's own word, else a guess from who made it. */
export function triggerSourceOf(evt: OrderCreatedEvent | OrderStatusChangedEvent): string {
  if (evt.triggerSource) return evt.triggerSource;
  if (evt.imported) return 'import';
  if ('actor' in evt) {
    if (evt.actor.kind === 'ai') return 'mcp';
    if (evt.actor.kind === 'integration') return 'webhook';
  }
  return 'screen';
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

    return workflows.map(publicWorkflow);
  }

  /**
   * The checks a trigger needs at save (M9-T22). A schedule has a valid cron and time zone (the zone defaults to the
   * store's) and no conditions: it runs with no order, so a rule on an order field could never be true.
   * Returns the trigger data to store.
   */
  private async validateTrigger(triggerType: WorkflowTriggerType, triggerData: any, conditions: any): Promise<any> {
    if (triggerType !== SCHEDULE_TRIGGER) return triggerData;
    if (hasConditionRules(conditions)) {
      throw new AppError('A schedule workflow runs with no order, so it cannot have conditions on order fields', 400);
    }
    const config = await prisma.systemConfig.findFirst({ select: { timeZone: true } });
    const schedule = validateSchedule(triggerData, config?.timeZone || undefined);
    return { ...(triggerData ?? {}), cron: schedule.cron, timeZone: schedule.timeZone };
  }

  /**
   * Create new workflow
   */
  async createWorkflow(data: CreateWorkflowData) {

    // Validate actions
    assertValidWorkflow({ actions: data.actions, conditions: data.conditions });
    this.validateWorkflowActions(data.actions);
    const triggerType = normalizeTriggerType(data.triggerType);
    const triggerData = await this.validateTrigger(triggerType, data.triggerData, data.conditions);
    // A webhook workflow gets its token now; the raw token is returned once and only its hash is kept.
    const webhookToken = triggerType === 'webhook' ? newWebhookToken() : undefined;

    const workflow = await prisma.workflow.create({
      data: {
        name: data.name,
        description: data.description,
        triggerType,
        triggerData,
        actions: data.actions,
        conditions: data.conditions || {},
        ...(webhookToken ? { webhookTokenHash: hashWebhookToken(webhookToken) } : {}),
      }
    });
    await syncWorkflowSchedule(workflow);

    logger.info('Workflow created', {
      workflowId: workflow.id,
      name: workflow.name,
      triggerType: workflow.triggerType
    });

    return { ...publicWorkflow(workflow), ...(webhookToken ? { webhookToken } : {}) };
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

    return publicWorkflow(workflow);
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
    assertValidWorkflow({ actions: updateData.actions, conditions: updateData.conditions });
    if (updateData.actions) {
      this.validateWorkflowActions(updateData.actions);
    }

    // Only the editable fields are written: never the token hash, the tenant or the schedule bookkeeping.
    // Prisma ignores undefined fields on update. Explicitly convert to null
    // so clearing conditions/description actually persists to the DB.
    const data: any = {};
    for (const field of UPDATABLE_FIELDS) if (field in updateData) data[field] = (updateData as any)[field];
    if ('conditions' in data && data.conditions === undefined) data.conditions = null;
    if ('description' in data && data.description === undefined) data.description = null;
    if ('triggerType' in data) data.triggerType = normalizeTriggerType(data.triggerType);

    // The trigger is checked as it will be saved: new values over the old ones
    const triggerType: WorkflowTriggerType = data.triggerType ?? workflow.triggerType;
    const conditions = 'conditions' in data ? data.conditions : workflow.conditions;
    if ('triggerType' in data || 'triggerData' in data || 'conditions' in data) {
      data.triggerData = await this.validateTrigger(triggerType, 'triggerData' in data ? data.triggerData : workflow.triggerData, conditions);
    }
    // Switching to a webhook trigger on a workflow with no token: it gets one, returned once.
    const webhookToken = triggerType === 'webhook' && !workflow.webhookTokenHash ? newWebhookToken() : undefined;
    if (webhookToken) data.webhookTokenHash = hashWebhookToken(webhookToken);

    const updated = await prisma.workflow.update({
      where: { id: workflowId },
      data,
    });
    await syncWorkflowSchedule(updated);

    logger.info('Workflow updated', { workflowId });
    return { ...publicWorkflow(updated), ...(webhookToken ? { webhookToken } : {}) };
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
    await syncWorkflowSchedule({ ...workflow, isActive: false });

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
    await syncWorkflowSchedule(updated);

    logger.info('Workflow status toggled', { workflowId, isActive });
    return publicWorkflow(updated);
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

    return this.runLoaded(workflow, input, undefined, { triggerSource: 'manual' });
  }

  /** Queue a run. `workflow` is already loaded and active. The conditions are checked once, in `enqueueRun`. */
  private async runLoaded(workflow: Workflow, input: any, guard: RunGuard | undefined, meta: RunMeta) {
    return this.enqueueRun(workflow, input, guard, meta);
  }

  /** Insert an execution row. Null when the idempotency key is already taken. */
  async createExecution(workflow: Workflow, input: any, meta: RunMeta, extra: { status: string; error?: string; completedAt?: Date; output?: Prisma.InputJsonValue; mode?: 'live' | 'test'; steps?: Prisma.InputJsonValue }) {
    try {
      return await prisma.workflowExecution.create({
        data: {
          tenantId: resolveTenantId(workflow.tenantId),
          workflowId: workflow.id,
          input: input || {},
          orderId: meta.orderId ?? input?.orderId ?? null,
          triggerSource: meta.triggerSource,
          idempotencyKey: meta.idempotencyKey ?? null,
          ...extra,
        },
      });
    } catch (error: any) {
      if (error?.code === 'P2002' && meta.idempotencyKey) return null;
      throw error;
    }
  }

  /**
   * Every trigger checks the workflow's conditions once, before the first step (M9-T21 fix). Null when the run may go on.
   * A run that does not match writes a `skipped` execution with `conditions_not_met`. A run with no input (a manual or
   * schedule run with no order) has nothing to read, so it skips the check as before.
   */
  async skipUnlessConditionsMet(workflow: Workflow, input: any, meta: RunMeta) {
    const hasInput = !!input && Object.keys(input).length > 0;
    if (!hasInput || !workflow.conditions || this.evaluateConditions(workflow.conditions, input)) return null;
    // A skip is not a run: it carries no idempotency key, so it never blocks the real run for the same key.
    const skipped = await this.createExecution(workflow, input, { triggerSource: meta.triggerSource, orderId: meta.orderId ?? input?.orderId ?? null }, {
      status: 'skipped', error: CONDITIONS_NOT_MET, completedAt: new Date(),
    });
    logger.info('Workflow conditions not met', { workflowId: workflow.id, orderId: meta.orderId ?? input?.orderId });
    return { message: 'Workflow conditions not met', execution: skipped };
  }

  /**
   * Loop guard, execution record, queue: the one place a run is created (manual and triggered).
   * `guard` is given for runs caused by an order event (M2-T17).
   */
  async enqueueRun(workflow: Workflow, input: any, guard: RunGuard | undefined, meta: RunMeta) {
    const skipped = await this.skipUnlessConditionsMet(workflow, input, meta);
    if (skipped) return skipped;

    if (guard && await this.loopGuardHit(workflow, input, guard, meta)) {
      return { message: LOOP_GUARD_MESSAGE };
    }

    // Create execution record. The unique (tenant, idempotencyKey) index makes a second run for the same key a no-op.
    const execution = await this.createExecution(workflow, input, meta, { status: 'pending' });
    if (!execution) {
      logger.info('Workflow run skipped: duplicate idempotency key', { workflowId: workflow.id, key: meta.idempotencyKey });
      return { message: 'Duplicate run ignored' };
    }

    // Capture tenant context so the queue worker can restore it
    const tenantId = getTenantId();

    // Add to queue for async processing. A queue that is down never fails the caller: the run goes to the outbox (M9-T21).
    await enqueueWorkflowRun({
      executionId: execution.id,
      workflowId: workflow.id,
      actions: workflow.actions as any[],
      conditions: workflow.conditions,
      input: input || {},
      tenantId,
    });

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
    if (Array.isArray(conditions.rules)) {
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
      'send_auto_confirm',
      'update_order',
      'assign_user',
      'assign_to',
      'wait',
      'http_request'
    ];

    for (const action of actions) {
      if (!action.type || !validActionTypes.includes(action.type)) {
        throw new AppError(`Invalid action type: ${action.type}`, 400);
      }

      if (action.type === 'assign_to') validateAssignToConfig(action.config);

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
    // A workflow of another tenant is not found
    await this.getWorkflowById(workflowId);
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

    const { presentExecution } = await import('./workflowRunService');
    return {
      executions: executions.map(presentExecution),
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
  private async loopGuardHit(workflow: Workflow, input: any, { orderId, depth, recent }: RunGuard, meta: RunMeta): Promise<boolean> {
    const tooDeep = depth >= LOOP_GUARD_MAX_DEPTH;
    if (!tooDeep && !recent.has(workflow.id)) return false;

    // A skip is not a run: it carries no idempotency key, so it never blocks the real run for the same key.
    await this.createExecution(workflow, input, { triggerSource: meta.triggerSource, orderId }, {
      status: 'skipped', error: LOOP_GUARD_MESSAGE, completedAt: new Date(),
    });
    logger.warn(LOOP_GUARD_MESSAGE, { workflowId: workflow.id, orderId, depth, tooDeep });
    return true;
  }

  /**
   * Status change workflows triggered. Runs from the `order.status_changed` event (see `registerWorkflowListeners`).
   * `depth` is how many workflow-caused moves led here; it rides in the execution input so `update_order` can pass it on.
   */
  async triggerStatusChangeWorkflows(orderId: number, oldStatus: string, newStatus: string, depth: number = 0, triggerSource: string = 'screen') {
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

    // The order as the conditions read it (region, total, product names), plus what the move says
    const order = await this.loadOrderContext(orderId);
    const input = {
      ...(order ?? {}),
      orderId,
      oldStatus,
      newStatus,
      depth,
      productName: order?.productName ?? '',
    };

    const recent = await this.recentRunIds(workflows.map((w) => w.id), orderId, depth);
    for (const workflow of workflows) {
      await this.runLoaded(workflow, input, { orderId, depth, recent }, { triggerSource, orderId });
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
  async triggerOrderCreatedWorkflows(order: { id: number }, triggerSource: string = 'screen') {
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

      // Full order data with products for workflow evaluation
      const orderContext = await this.loadOrderContext(order.id);
      if (!orderContext) {
        logger.error('Order not found for workflow triggering', { orderId: order.id });
        return;
      }

      const recent = await this.recentRunIds(workflows.map((w) => w.id), order.id, 0);

      // Trigger each workflow. enqueueRun checks the workflow's conditions.
      for (const workflow of workflows) {
        try {
          await this.enqueueRun(workflow, orderContext, { orderId: order.id, depth: 0, recent }, { triggerSource, orderId: order.id });
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
   * The order as a workflow run's input: the order with its items and customer, plus `orderId` and `productName`
   * (what conditions read: `region` reads `deliveryState`). Null when the order is gone.
   */
  async loadOrderContext(orderId: number) {
    const fullOrder = await prisma.order.findUnique({
      where: { id: orderId },
      include: { orderItems: { include: { product: true } }, customer: true },
    });
    if (!fullOrder) return null;
    return {
      ...fullOrder,
      orderId: fullOrder.id,
      productName: (fullOrder.orderItems || []).map((item: any) => item.product?.name || 'Unknown Product').join(', '),
    };
  }

  /**
   * `payment_received` workflows (M9-T22): fired once when an online payment settles and the order's payment is paid.
   * `idempotencyKey = payment:<orderId>:<reference>`, so a duplicate webhook that settles the same reference twice runs once.
   * The workflow's conditions are checked against the order. Never throws: the payment is already booked.
   */
  async onPaymentSettled(evt: PaymentSettledEvent): Promise<void> {
    try {
      await runInTenant(evt.tenantId, async () => {
        const workflows = await prisma.workflow.findMany({ where: { isActive: true, triggerType: 'payment_received' } }) || [];
        if (workflows.length === 0) return;
        const context = await this.loadOrderContext(evt.orderId);
        if (!context) return;
        const input = { ...context, depth: 0, paymentReference: evt.reference, paymentProvider: evt.provider, paymentAmount: Money.toApi(evt.amount) };
        for (const workflow of workflows) {
          try {
            await this.runLoaded(workflow, input, undefined, {
              triggerSource: 'payment', orderId: evt.orderId, idempotencyKey: `payment:${evt.orderId}:${evt.reference}`,
            });
          } catch (error: any) {
            logger.error('Failed to trigger payment_received workflow', { workflowId: workflow.id, orderId: evt.orderId, error: error.message });
          }
        }
      });
    } catch (error: any) {
      logger.error('Failed to trigger payment_received workflows', { orderId: evt.orderId, error: error.message });
    }
  }

  /** A new webhook token for a workflow (M9-T22). The old one stops working. Returned once; only its hash is kept. */
  async regenerateWebhookToken(workflowId: number) {
    const workflow = await prisma.workflow.findUnique({ where: { id: workflowId } });
    if (!workflow) throw new AppError('Workflow not found', 404);
    if (workflow.triggerType !== 'webhook') throw new AppError('Only a webhook workflow has a token', 400);
    const webhookToken = newWebhookToken();
    await prisma.workflow.update({ where: { id: workflowId }, data: { webhookTokenHash: hashWebhookToken(webhookToken) } });
    logger.info('Workflow webhook token regenerated', { workflowId });
    return { webhookToken };
  }

  /**
   * `POST /api/workflows/hooks/:token` (M9-T22), no login: the token finds the workflow by its hash.
   * Unknown token: 404. Workflow off: 409. An `orderId` that is not an order of the workflow's tenant: 404.
   * `Idempotency-Key` makes the run `webhook:<workflowId>:<key>`; a second call with it starts nothing.
   */
  async triggerWebhook(token: string, body: { orderId?: unknown; data?: unknown }, idempotencyHeader?: string) {
    const workflow = await withoutTenant('workflow webhook token lookup', () => prisma.workflow.findFirst({
      where: { webhookTokenHash: hashWebhookToken(token), triggerType: 'webhook' },
    }));
    if (!workflow || !workflow.tenantId) throw new AppError('Not found', 404);
    if (!workflow.isActive) throw new AppError('Workflow is off', 409);

    const { orderId, data } = body ?? {};
    if (orderId !== undefined && (!Number.isInteger(orderId) || (orderId as number) <= 0)) throw new AppError('orderId must be a whole number', 400);
    if (data !== undefined && JSON.stringify(data).length > WEBHOOK_DATA_MAX_CHARS) throw new AppError('data is too large', 400);
    const header = typeof idempotencyHeader === 'string' ? idempotencyHeader.trim() : '';
    if (header.length > IDEMPOTENCY_HEADER_MAX) throw new AppError('Idempotency-Key is too long', 400);

    return runInTenant(workflow.tenantId, async () => {
      let input: any = { data: data ?? null };
      if (orderId !== undefined) {
        // Tenant-scoped read: another tenant's order is not found
        const context = await this.loadOrderContext(orderId as number);
        if (!context) throw new AppError('Order not found', 404);
        input = { ...context, depth: 0, data: data ?? null };
      }
      return this.runLoaded(workflow, input, undefined, {
        triggerSource: 'webhook', orderId: orderId as number | undefined,
        ...(header ? { idempotencyKey: `webhook:${workflow.id}:${header}` } : {}),
      });
    });
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
      await runInTenant(evt.tenantId, () => this.triggerStatusChangeWorkflows(evt.orderId, evt.from, evt.to, evt.depth, triggerSourceOf(evt)));
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
      await runInTenant(evt.tenantId, () => this.triggerOrderCreatedWorkflows({ id: evt.orderId }, triggerSourceOf(evt)));
    } catch (error: any) {
      logger.error('Failed to trigger order_created workflows', { orderId: evt.orderId, error: error.message });
    }
  }

  /**
   * Get workflow templates (M9-T25). Each says which connections it needs (`needs`: sms, email, whatsapp, from its actions).
   * A template that needs WhatsApp is `available: false` with a reason when the store has no WhatsApp connection.
   */
  async getTemplates(category?: string) {
    const {
      workflowTemplates,
      getTemplateCategories,
      getTemplatesByCategory
    } = await import('../data/workflowTemplates');
    const { getDbWhatsappConfig } = await import('./whatsappService');

    const templates = category
      ? getTemplatesByCategory(category)
      : workflowTemplates;

    const whatsapp = await getDbWhatsappConfig();
    const hasWhatsapp = !!(whatsapp?.accessToken && whatsapp?.phoneNumberId);

    const categories = getTemplateCategories();

    return {
      templates: templates.map((template) => {
        const needs = templateConnections(template.actions);
        const missing = needs.includes('whatsapp') && !hasWhatsapp;
        return { ...template, needs, available: !missing, ...(missing ? { unavailableReason: 'Needs WhatsApp in Connections' } : {}) };
      }),
      categories
    };
  }
}

/** The connections the actions use. */
export function templateConnections(actions: any[]): string[] {
  const byAction: Record<string, string> = { send_sms: 'sms', send_email: 'email', send_whatsapp: 'whatsapp', send_auto_confirm: 'whatsapp' };
  return [...new Set((actions ?? []).map((a) => byAction[a?.type]).filter(Boolean))];
}

const workflowService = new WorkflowService();

let registered = false;
/** Listen to the state machine's events. Idempotent; the server calls it at bootstrap (tests call it or import the server). */
export function registerWorkflowListeners(): void {
  if (registered) return;
  registered = true;
  onOrderEvent(AppEvent.ORDER_STATUS_CHANGED, (evt) => { void workflowService.onStatusChanged(evt); });
  onOrderEvent(AppEvent.ORDER_CREATED, (evt) => { void workflowService.onOrderCreated(evt); });
  onPaymentSettled((evt) => workflowService.onPaymentSettled(evt));
}

export default workflowService;
