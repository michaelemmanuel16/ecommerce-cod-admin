import Bull from 'bull';
import { Workflow, WorkflowExecution } from '@prisma/client';
import crypto from 'crypto';
import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { AppError } from '../middleware/errorHandler';
import { evaluateConditions } from '../utils/conditionEvaluator';
import { getTenantId, resolveTenantId, runJobInTenant } from '../utils/tenantContext';
import { workflowQueue, MANUAL_RUN_JOB, actionsHash } from '../queues/workflowQueue';
import { enqueueWorkflowRun } from '../queues/workflowEnqueue';
import workflowService from './workflowService';

/**
 * Run history, retry, manual Run and test run (M9-T24, F-502, F-503, F-514).
 * Every run, however it started, is one `WorkflowExecution` row; `steps` holds one entry per step.
 */

export const MANUAL_RUN_BATCH = 50;
export const MANUAL_RUN_MAX_ORDERS = 500;
/** A run in one of these states counts as "already ran" for the manual-run warning. */
const LIVE_OR_DONE = ['pending', 'running', 'waiting', 'completed'];

/** What a client sees of one step: the queue writes `{ action, success, result, error }`. */
export function presentStep(step: any, index: number) {
  const status = step?.status ?? (step?.success === false ? 'failed' : 'completed');
  return { index, type: step?.type ?? step?.action ?? null, status, result: step?.result ?? null, error: step?.error ?? null };
}

/** One execution for the run history: status, source, order, start and finish, and the step list with each result and error. */
export function presentExecution(execution: WorkflowExecution) {
  const steps = Array.isArray(execution.steps) ? execution.steps : [];
  const output: any = execution.output ?? {};
  return {
    id: execution.id,
    workflowId: execution.workflowId,
    status: execution.status,
    mode: execution.mode,
    triggerSource: execution.triggerSource,
    orderId: execution.orderId,
    startedAt: execution.startedAt,
    finishedAt: execution.completedAt,
    completedAt: execution.completedAt,
    input: execution.input,
    error: execution.error,
    failedStepIndex: execution.failedStepIndex,
    retryOf: output.retryOf ?? null,
    steps: steps.map(presentStep),
  };
}

/** `GET /api/workflows/executions/:executionId`. Another tenant's run is not found. */
export async function getExecution(executionId: number) {
  const execution = await prisma.workflowExecution.findUnique({ where: { id: executionId } });
  if (!execution) throw new AppError('Execution not found', 404);
  return presentExecution(execution);
}

async function loadWorkflow(workflowId: number): Promise<Workflow> {
  const workflow = await prisma.workflow.findUnique({ where: { id: workflowId } });
  if (!workflow) throw new AppError('Workflow not found', 404);
  return workflow;
}

/**
 * `POST /api/workflows/executions/:executionId/retry`: only a failed run, again from `failedStepIndex`, through the queue.
 * The new run is a new execution row linked to the old one in `output.retryOf`; its idempotency key is `retry:<executionId>`,
 * so a second retry of the same run (pending or finished) is a 409. A workflow that is off, or edited since the run started
 * (the actions hash in `output.actionsHash` differs), is a 409 too; conditions that no longer match write a `skipped` run.
 */
export async function retryExecution(executionId: number) {
  const old = await prisma.workflowExecution.findUnique({ where: { id: executionId } });
  if (!old) throw new AppError('Execution not found', 404);
  if (old.mode === 'test') throw new AppError('A test run cannot be retried', 409);
  if (old.status !== 'failed') throw new AppError('Only a failed run can be retried', 409);
  const workflow = await loadWorkflow(old.workflowId);
  if (!workflow.isActive) throw new AppError('Switch the workflow on before retrying a run', 409);
  // The run resumes by step index: the steps must be the ones it started with. A run from before the hash was kept is not checked.
  const startedWith = (old.output as any)?.actionsHash;
  if (startedWith && startedWith !== actionsHash(workflow.actions)) {
    throw new AppError('The workflow changed since this run. Run it again instead.', 409);
  }
  // The conditions are checked again, on the order as it is now, through the same gate as every run
  const fresh = old.orderId ? await workflowService.loadOrderContext(old.orderId) : null;
  const skipped = await workflowService.skipUnlessConditionsMet(workflow, fresh ? { ...fresh, depth: 0 } : old.input, { triggerSource: 'retry', orderId: old.orderId });
  if (skipped) return { message: skipped.message, execution: skipped.execution ? presentExecution(skipped.execution) : null };

  const startIndex = old.failedStepIndex ?? 0;
  const priorSteps = (Array.isArray(old.steps) ? old.steps : []).slice(0, startIndex);
  const execution = await workflowService.createExecution(workflow, old.input, {
    triggerSource: 'retry', orderId: old.orderId, idempotencyKey: `retry:${executionId}`,
  }, { status: 'pending', output: { retryOf: executionId } });
  if (!execution) throw new AppError('This run was already retried', 409);

  await enqueueWorkflowRun({
    executionId: execution.id, workflowId: workflow.id, actions: workflow.actions as any[], conditions: workflow.conditions,
    input: old.input, tenantId: getTenantId(), startIndex, priorSteps, retryOf: executionId,
  });
  logger.info('Workflow run retried', { executionId, retryExecutionId: execution.id, startIndex });
  return { message: 'Retry started', execution: presentExecution(execution) };
}

/**
 * `POST /api/workflows/:id/run`: run the workflow on 1 to 500 orders, `triggerSource = manual`, 50 orders a job.
 * When an order already has a live or completed run of this workflow, the first call runs nothing and answers
 * `{ warning: 'already_ran', orderIds }`; the same call with `confirm: true` runs them all.
 */
export async function runOnOrders(workflowId: number, body: { orderIds?: unknown; confirm?: unknown }) {
  const { orderIds: raw, confirm } = body ?? {};
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MANUAL_RUN_MAX_ORDERS
    || !raw.every((id) => Number.isInteger(id) && id > 0)) {
    throw new AppError(`orderIds must be a list of 1 to ${MANUAL_RUN_MAX_ORDERS} order ids`, 400);
  }
  const orderIds = [...new Set(raw as number[])];
  const workflow = await loadWorkflow(workflowId);
  if (!workflow.isActive) throw new AppError('Switch the workflow on before running it', 409);

  // Tenant-scoped: an id from another store is simply not found
  const found = await prisma.order.findMany({ where: { id: { in: orderIds }, deletedAt: null }, select: { id: true } });
  const missing = orderIds.filter((id) => !found.some((o) => o.id === id));
  if (missing.length > 0) throw new AppError(`Orders not found: ${missing.join(', ')}`, 404);

  if (confirm !== true) {
    const rows = await prisma.workflowExecution.findMany({
      where: { workflowId, mode: 'live', orderId: { in: orderIds }, status: { in: LIVE_OR_DONE } },
      select: { orderId: true }, distinct: ['orderId'],
    });
    if (rows.length > 0) return { warning: 'already_ran', orderIds: rows.map((r) => r.orderId as number).sort((a, b) => a - b) };
  }

  const tenantId = getTenantId();
  const batchKey = crypto.randomUUID();
  let batches = 0;
  try {
    for (let i = 0; i < orderIds.length; i += MANUAL_RUN_BATCH) {
      await workflowQueue.add(MANUAL_RUN_JOB, { workflowId, tenantId, orderIds: orderIds.slice(i, i + MANUAL_RUN_BATCH) }, {
        jobId: `wf-manual:${workflowId}:${batchKey}:${i}`, removeOnComplete: true,
      });
      batches++;
    }
  } catch (error: any) {
    logger.error('Workflow manual run could not be queued', { workflowId, error: error.message });
    throw new AppError('The queue is unavailable. Try again in a minute.', 503);
  }
  logger.info('Workflow manual run queued', { workflowId, orders: orderIds.length, batches });
  return { queued: orderIds.length, batches };
}

/** The processor of one manual batch: one execution per order. */
export async function processManualRunBatch(job: Bull.Job): Promise<void> {
  const { workflowId, tenantId, orderIds } = job.data as { workflowId: number; tenantId: string; orderIds: number[] };
  await runJobInTenant(`Workflow manual run ${job.id} (workflow ${workflowId})`, tenantId, async () => {
    const workflow = await prisma.workflow.findUnique({ where: { id: workflowId } });
    if (!workflow || !workflow.isActive) {
      logger.info('Workflow manual batch skipped: workflow gone or off', { workflowId });
      return;
    }
    for (const orderId of orderIds) {
      try {
        const context = await workflowService.loadOrderContext(orderId);
        if (!context) continue;
        await workflowService.enqueueRun(workflow, { ...context, depth: 0 }, undefined, { triggerSource: 'manual', orderId });
      } catch (error: any) {
        logger.error('Workflow manual run failed to start', { workflowId, orderId, error: error.message });
      }
    }
  });
}

/** What one action would do, in a sentence. Reads the config only: it never calls a sender. */
export function describeAction(action: any): string {
  const c = action?.config ?? {};
  switch (action?.type) {
    case 'send_sms': return `Send an SMS to ${c.phoneNumber ?? c.to ?? 'the customer'}: "${c.message ?? ''}"`;
    case 'send_email': return `Send an email to ${c.to ?? c.email ?? 'the customer'}${c.subject ? ` with subject "${c.subject}"` : ''}`;
    case 'send_whatsapp': return `Send the WhatsApp template "${c.templateKey ?? ''}"`;
    case 'send_auto_confirm': return 'Send the auto-confirm message';
    case 'update_order': return `Update the order: ${JSON.stringify(c.updates ?? c.fields ?? c)}`;
    case 'assign_to': return `Assign the order to a ${c.role} (${(c.userIds ?? []).length} user(s), ${c.split ?? 'even'} split)`;
    case 'assign_user': return `Assign the order to a ${c.userType} (${c.distributionMode ?? 'even'})`;
    case 'wait': return `Wait ${Number(c.duration ?? action?.duration ?? 0)} seconds`;
    case 'http_request': return `Call ${String(c.method ?? 'POST').toUpperCase()} ${c.url ?? ''}`;
    default: return `Run ${action?.type}`;
  }
}

/**
 * `POST /api/workflows/:id/test`: a dry run of a draft or active workflow. It checks the conditions against the order (when one is given)
 * and returns the plan. The run is written with `mode = test`. Nothing is sent, assigned or changed: no sender, no assignment
 * service, no queue and no HTTP call is touched.
 */
export async function testRun(workflowId: number, body: { orderId?: unknown }) {
  const workflow = await loadWorkflow(workflowId);
  const { orderId } = body ?? {};
  if (orderId !== undefined && (!Number.isInteger(orderId) || (orderId as number) <= 0)) throw new AppError('orderId must be a whole number', 400);

  let input: any = {};
  if (orderId !== undefined) {
    const context = await workflowService.loadOrderContext(orderId as number);
    if (!context) throw new AppError('Order not found', 404);
    input = { ...context, depth: 0 };
  }

  const conditions: any = workflow.conditions;
  const hasConditions = workflowHasRules(conditions);
  const evaluated = orderId !== undefined;
  const matches = !hasConditions ? true : evaluated ? evaluateConditions(conditions, input) : null;
  const plan = ((workflow.actions as any[]) ?? []).map((action, index) => ({
    index, type: action?.type, willDo: describeAction(action),
  }));
  const blocked = matches === false;

  const steps = blocked ? [] : plan.map((p) => ({ action: p.type, type: p.type, status: 'planned', success: true, result: { dryRun: true, willDo: p.willDo } }));
  const execution = await prisma.workflowExecution.create({
    data: {
      tenantId: resolveTenantId(workflow.tenantId),
      workflowId: workflow.id,
      mode: 'test',
      status: blocked ? 'skipped' : 'completed',
      error: blocked ? 'conditions_not_met' : null,
      input: orderId !== undefined ? { orderId } : {},
      orderId: (orderId as number | undefined) ?? null,
      triggerSource: 'manual',
      steps,
      completedAt: new Date(),
    },
  });
  return {
    executionId: execution.id,
    mode: 'test',
    conditions: { evaluated, matches, reason: hasConditions && !evaluated ? 'no_order' : blocked ? 'conditions_not_met' : null },
    plan: blocked ? [] : plan,
    sent: false,
  };
}

function workflowHasRules(conditions: any): boolean {
  if (!conditions || typeof conditions !== 'object') return false;
  if (Array.isArray(conditions.rules)) return conditions.rules.length > 0;
  return Object.keys(conditions).length > 0;
}
