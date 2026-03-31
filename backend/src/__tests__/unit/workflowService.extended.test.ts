/**
 * Extended WorkflowService tests for branch coverage
 * Focuses on untested methods and branches
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { prismaMock } from '../mocks/prisma.mock';
import { WorkflowService } from '../../services/workflowService';
import { AppError } from '../../middleware/errorHandler';
import { WorkflowTriggerType } from '@prisma/client';

jest.mock('../../queues/workflowQueue', () => ({
  workflowQueue: { add: jest.fn().mockResolvedValue({}) },
}));

jest.mock('../../services/smsService', () => ({
  smsService: { sendSms: jest.fn().mockResolvedValue({ messageLogId: 1 }) },
  sendSmsForOrder: jest.fn().mockResolvedValue({ messageLogId: 1 }),
  clearSmsConfigCache: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const makeWorkflow = (overrides: any = {}) => ({
  id: 1,
  name: 'Test Workflow',
  description: 'Test',
  triggerType: 'status_change' as WorkflowTriggerType,
  triggerData: {},
  actions: [{ type: 'update_order', config: { orderId: '{{orderId}}', status: 'confirmed' } }],
  conditions: {},
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('WorkflowService (extended branch coverage)', () => {
  let workflowService: WorkflowService;

  beforeEach(() => {
    jest.clearAllMocks();
    workflowService = new WorkflowService();
  });

  // ───────────────────────────── getAllWorkflows ─────────────────────────────
  describe('getAllWorkflows', () => {
    it('returns all workflows without filters', async () => {
      (prismaMock.workflow.findMany as any).mockResolvedValue([makeWorkflow()] as any);
      const result = await workflowService.getAllWorkflows({});
      expect(result).toHaveLength(1);
    });

    it('filters by isActive', async () => {
      (prismaMock.workflow.findMany as any).mockResolvedValue([makeWorkflow()] as any);
      const result = await workflowService.getAllWorkflows({ isActive: true });
      expect(prismaMock.workflow.findMany).toHaveBeenCalled();
    });

    it('filters by triggerType', async () => {
      (prismaMock.workflow.findMany as any).mockResolvedValue([makeWorkflow()] as any);
      const result = await workflowService.getAllWorkflows({ triggerType: 'order_created' as WorkflowTriggerType });
      expect(result).toHaveLength(1);
    });

    it('filters by both isActive and triggerType', async () => {
      (prismaMock.workflow.findMany as any).mockResolvedValue([] as any);
      const result = await workflowService.getAllWorkflows({ isActive: false, triggerType: 'status_change' as WorkflowTriggerType });
      expect(result).toHaveLength(0);
    });
  });

  // ───────────────────────────── getWorkflowById ─────────────────────────────
  describe('getWorkflowById', () => {
    it('returns workflow when found', async () => {
      (prismaMock.workflow.findUnique as any).mockResolvedValue(makeWorkflow() as any);
      const result = await workflowService.getWorkflowById(1);
      expect(result.id).toBe(1);
    });

    it('throws 404 when workflow not found', async () => {
      (prismaMock.workflow.findUnique as any).mockResolvedValue(null);
      await expect(workflowService.getWorkflowById(999)).rejects.toThrow(AppError);
    });
  });

  // ───────────────────────────── updateWorkflow ─────────────────────────────
  describe('updateWorkflow', () => {
    it('throws 404 when workflow not found', async () => {
      (prismaMock.workflow.findUnique as any).mockResolvedValue(null);
      await expect(workflowService.updateWorkflow(999, { name: 'New Name' })).rejects.toThrow(AppError);
    });

    it('updates workflow without actions change', async () => {
      (prismaMock.workflow.findUnique as any).mockResolvedValue(makeWorkflow() as any);
      (prismaMock.workflow.update as any).mockResolvedValue(makeWorkflow({ name: 'Updated' }) as any);

      const result = await workflowService.updateWorkflow(1, { name: 'Updated' });
      expect(result.name).toBe('Updated');
    });

    it('updates workflow with valid actions', async () => {
      (prismaMock.workflow.findUnique as any).mockResolvedValue(makeWorkflow() as any);
      (prismaMock.workflow.update as any).mockResolvedValue(makeWorkflow() as any);

      const result = await workflowService.updateWorkflow(1, {
        actions: [{ type: 'send_sms', config: { message: 'Hello {{name}}' } }],
      });
      expect(result).toBeDefined();
    });

    it('throws error when updating with invalid action type', async () => {
      (prismaMock.workflow.findUnique as any).mockResolvedValue(makeWorkflow() as any);

      await expect(
        workflowService.updateWorkflow(1, {
          actions: [{ type: 'invalid_action_type', config: {} }],
        })
      ).rejects.toThrow(AppError);
    });
  });

  // ───────────────────────────── toggleWorkflowStatus ─────────────────────────────
  describe('toggleWorkflowStatus', () => {
    it('throws 404 when workflow not found', async () => {
      (prismaMock.workflow.findUnique as any).mockResolvedValue(null);
      await expect(workflowService.toggleWorkflowStatus(999, false)).rejects.toThrow(AppError);
    });

    it('activates a workflow', async () => {
      (prismaMock.workflow.findUnique as any).mockResolvedValue(makeWorkflow({ isActive: false }) as any);
      (prismaMock.workflow.update as any).mockResolvedValue(makeWorkflow({ isActive: true }) as any);

      const result = await workflowService.toggleWorkflowStatus(1, true);
      expect(result.isActive).toBe(true);
    });

    it('deactivates a workflow', async () => {
      (prismaMock.workflow.findUnique as any).mockResolvedValue(makeWorkflow({ isActive: true }) as any);
      (prismaMock.workflow.update as any).mockResolvedValue(makeWorkflow({ isActive: false }) as any);

      const result = await workflowService.toggleWorkflowStatus(1, false);
      expect(result.isActive).toBe(false);
    });
  });

  // ───────────────────────────── getWorkflowExecutions ─────────────────────────────
  describe('getWorkflowExecutions', () => {
    it('returns executions with default pagination', async () => {
      (prismaMock.workflowExecution.findMany as any).mockResolvedValue([] as any);
      (prismaMock.workflowExecution.count as any).mockResolvedValue(0);

      const result = await workflowService.getWorkflowExecutions(1);
      expect(result.pagination.total).toBe(0);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(20);
    });

    it('paginates executions with custom page and limit', async () => {
      (prismaMock.workflowExecution.findMany as any).mockResolvedValue([] as any);
      (prismaMock.workflowExecution.count as any).mockResolvedValue(100);

      const result = await workflowService.getWorkflowExecutions(1, { page: 3, limit: 10 });
      expect(result.pagination.pages).toBe(10);
      expect(result.pagination.page).toBe(3);
    });
  });

  // ───────────────────────────── triggerOrderCreatedWorkflows ─────────────────────────────
  describe('triggerOrderCreatedWorkflows', () => {
    it('returns early when no order_created workflows active', async () => {
      (prismaMock.workflow.findMany as any).mockResolvedValue([] as any);

      await workflowService.triggerOrderCreatedWorkflows({ id: 1, status: 'pending_confirmation' });
      expect(prismaMock.workflow.findMany).toHaveBeenCalled();
      expect(prismaMock.workflowExecution.create).not.toHaveBeenCalled();
    });

    it('triggers workflows for each active order_created workflow', async () => {
      const workflow = makeWorkflow({ triggerType: 'order_created' as WorkflowTriggerType });
      (prismaMock.workflow.findMany as any).mockResolvedValue([workflow] as any);

      // Mock executeWorkflow path - findUnique returns the workflow again
      (prismaMock.workflow.findUnique as any).mockResolvedValue({ ...workflow, conditions: null } as any);
      (prismaMock.workflowExecution.create as any).mockResolvedValue({ id: 100 } as any);
      (prismaMock.workflowExecution.update as any).mockResolvedValue({} as any);
      (prismaMock.order.findUnique as any).mockResolvedValue({ id: 1 } as any);
      (prismaMock.order.update as any).mockResolvedValue({ id: 1 } as any);
      (prismaMock.auditLog.create as any).mockResolvedValue({} as any);

      await workflowService.triggerOrderCreatedWorkflows({ id: 1, status: 'pending_confirmation' });
      expect(prismaMock.workflow.findMany).toHaveBeenCalled();
    });

    it('handles errors in workflow execution gracefully', async () => {
      const workflow = makeWorkflow({ triggerType: 'order_created' as WorkflowTriggerType });
      (prismaMock.workflow.findMany as any).mockResolvedValue([workflow] as any);
      (prismaMock.workflow.findUnique as any).mockRejectedValue(new Error('DB error'));

      // Should not throw even if execution fails
      await expect(
        workflowService.triggerOrderCreatedWorkflows({ id: 1, status: 'pending_confirmation' })
      ).resolves.not.toThrow();
    });
  });

  // ───────────────────────────── triggerStatusChangeWorkflows ─────────────────────────────
  describe('triggerStatusChangeWorkflows - extended', () => {
    it('loads order with products when workflows exist', async () => {
      const workflow = makeWorkflow();
      (prismaMock.workflow.findMany as any).mockResolvedValue([workflow] as any);
      (prismaMock.order.findUnique as any)
        .mockResolvedValueOnce({
          id: 1,
          orderItems: [{ product: { name: 'Magic Groove Copybook' } }],
        } as any) // for triggerStatusChangeWorkflows order load
        .mockResolvedValueOnce({ id: 1, conditions: null } as any); // executeWorkflow findUnique

      // Mock executeWorkflow chain
      (prismaMock.workflow.findUnique as any).mockResolvedValue({ ...workflow, conditions: null } as any);
      (prismaMock.workflowExecution.create as any).mockResolvedValue({ id: 100 } as any);
      (prismaMock.workflowExecution.update as any).mockResolvedValue({} as any);
      (prismaMock.order.update as any).mockResolvedValue({ id: 1 } as any);
      (prismaMock.auditLog.create as any).mockResolvedValue({} as any);

      await workflowService.triggerStatusChangeWorkflows(1, 'pending_confirmation', 'confirmed');
      expect(prismaMock.workflow.findMany).toHaveBeenCalled();
    });
  });

  // ───────────────────────────── createWorkflow - coverage for valid action types ─────────────────────────────
  describe('createWorkflow - all valid action types', () => {
    const validActions = [
      { type: 'send_sms', config: { message: 'Hello' } },
      { type: 'send_email', config: { subject: 'Test', body: 'Body' } },
      { type: 'send_whatsapp', config: { message: 'Hi' } },
      { type: 'assign_agent', config: { agentId: '{{agentId}}' } },
      { type: 'add_tag', config: { tag: 'vip' } },
      { type: 'http_request', config: { url: 'https://example.com', method: 'POST' } },
      { type: 'assign_user', config: { userType: 'sales_rep' } },
    ];

    for (const action of validActions) {
      it(`creates workflow with ${action.type} action`, async () => {
        (prismaMock.workflow.create as any).mockResolvedValue(makeWorkflow({ actions: [action] }) as any);

        const result = await workflowService.createWorkflow({
          name: 'Test',
          description: '',
          triggerType: 'status_change' as WorkflowTriggerType,
          triggerData: {},
          actions: [action],
          conditions: {},
        });
        expect(result).toBeDefined();
      });
    }
  });
});
