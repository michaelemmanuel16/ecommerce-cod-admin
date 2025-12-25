import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { prismaMock } from '../mocks/prisma.mock';
import { WorkflowService } from '../../services/workflowService';
import { AppError } from '../../middleware/errorHandler';
import { WorkflowTriggerType } from '@prisma/client';

// Mock the workflow queue
jest.mock('../../queues/workflowQueue', () => ({
  workflowQueue: {
    add: jest.fn().mockResolvedValue({})
  }
}));

describe('WorkflowService', () => {
  let workflowService: WorkflowService;

  beforeEach(() => {
    workflowService = new WorkflowService();
  });

  describe('createWorkflow', () => {
    const createWorkflowData = {
      name: 'Order Confirmation SMS',
      description: 'Send SMS when order is confirmed',
      triggerType: 'status_change' as WorkflowTriggerType,
      triggerData: { status: 'confirmed' },
      actions: [
        {
          type: 'send_sms',
          phoneNumber: '{{customer.phone}}',
          message: 'Your order {{order.number}} has been confirmed'
        }
      ],
      conditions: {}
    };

    it('should create workflow with valid data', async () => {
      const mockWorkflow = {
        id: 'workflow-1',
        ...createWorkflowData,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      prismaMock.workflow.create.mockResolvedValue(mockWorkflow as any);

      const workflow = await workflowService.createWorkflow(createWorkflowData);

      expect(workflow).toBeDefined();
      expect(workflow.name).toBe('Order Confirmation SMS');
      expect(workflow.actions).toHaveLength(1);
      expect(prismaMock.workflow.create).toHaveBeenCalled();
    });

    it('should throw error with invalid action type', async () => {
      const invalidData = {
        ...createWorkflowData,
        actions: [{ type: 'invalid_action' }]
      };

      await expect(
        workflowService.createWorkflow(invalidData as any)
      ).rejects.toThrow(new AppError('Invalid action type: invalid_action', 400));
    });

    it('should throw error with empty actions array', async () => {
      const invalidData = {
        ...createWorkflowData,
        actions: []
      };

      await expect(
        workflowService.createWorkflow(invalidData)
      ).rejects.toThrow(new AppError('Workflow must have at least one action', 400));
    });
  });

  describe('executeWorkflow', () => {
    const mockWorkflow = {
      id: 'workflow-1',
      name: 'Test Workflow',
      isActive: true,
      conditions: {},
      actions: [
        { type: 'send_sms', message: 'Test' }
      ]
    };

    it('should execute active workflow successfully', async () => {
      prismaMock.workflow.findUnique.mockResolvedValue(mockWorkflow as any);

      const mockExecution = {
        id: 'execution-1',
        workflowId: 'workflow-1',
        status: 'pending',
        input: {},
        startedAt: new Date()
      };

      prismaMock.workflowExecution.create.mockResolvedValue(mockExecution as any);

      const result = await workflowService.executeWorkflow('workflow-1', {
        orderId: 'order-1'
      });

      expect(result.message).toBe('Workflow execution started');
      expect(result.execution).toBeDefined();
      expect(prismaMock.workflowExecution.create).toHaveBeenCalled();
    });

    it('should throw error when workflow not found', async () => {
      prismaMock.workflow.findUnique.mockResolvedValue(null);

      await expect(
        workflowService.executeWorkflow('workflow-1')
      ).rejects.toThrow(new AppError('Workflow not found', 404));
    });

    it('should throw error when workflow is not active', async () => {
      prismaMock.workflow.findUnique.mockResolvedValue({
        ...mockWorkflow,
        isActive: false
      } as any);

      await expect(
        workflowService.executeWorkflow('workflow-1')
      ).rejects.toThrow(new AppError('Workflow is not active', 400));
    });

    it('should return early when conditions not met', async () => {
      prismaMock.workflow.findUnique.mockResolvedValue({
        ...mockWorkflow,
        conditions: { status: 'delivered' }
      } as any);

      const result = await workflowService.executeWorkflow('workflow-1', {
        status: 'pending'
      });

      expect(result.message).toBe('Workflow conditions not met');
      expect(prismaMock.workflowExecution.create).not.toHaveBeenCalled();
    });
  });

  describe('processWorkflowExecution', () => {
    const executionId = 'execution-1';
    const workflowId = 'workflow-1';

    it('should process workflow actions sequentially', async () => {
      const actions = [
        { type: 'update_order', orderId: 'order-1', status: 'confirmed' },
        { type: 'send_sms', phoneNumber: '+1234567890', message: 'Test' }
      ];

      prismaMock.workflowExecution.update.mockResolvedValue({} as any);
      prismaMock.order.update.mockResolvedValue({} as any);

      const results = await workflowService.processWorkflowExecution(
        executionId,
        workflowId,
        actions,
        { orderId: 'order-1' }
      );

      expect(results).toHaveLength(2);
      expect(results[0].action).toBe('update_order');
      expect(results[0].success).toBe(true);
      expect(results[1].action).toBe('send_sms');
      expect(results[1].success).toBe(true);
    });

    it('should handle action errors gracefully', async () => {
      const actions = [
        { type: 'update_order', orderId: 'invalid-order', status: 'confirmed' }
      ];

      prismaMock.workflowExecution.update.mockResolvedValue({} as any);
      prismaMock.order.update.mockRejectedValue(new Error('Order not found'));

      const results = await workflowService.processWorkflowExecution(
        executionId,
        workflowId,
        actions,
        {}
      );

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toBe('Order not found');
    });

    it('should stop execution on error when stopOnError is true', async () => {
      const actions = [
        {
          type: 'update_order',
          orderId: 'invalid-order',
          status: 'confirmed',
          stopOnError: true
        }
      ];

      prismaMock.workflowExecution.update.mockResolvedValue({} as any);
      prismaMock.order.update.mockRejectedValue(new Error('Order not found'));

      await expect(
        workflowService.processWorkflowExecution(
          executionId,
          workflowId,
          actions,
          {}
        )
      ).rejects.toThrow('Order not found');
    });

    it('should mark execution as completed on success', async () => {
      const actions = [
        { type: 'send_sms', phoneNumber: '+1234567890', message: 'Test' }
      ];

      let finalStatus: string | undefined;
      prismaMock.workflowExecution.update.mockImplementation((args: any) => {
        if (args.data.status) {
          finalStatus = args.data.status;
        }
        return Promise.resolve({} as any);
      });

      await workflowService.processWorkflowExecution(
        executionId,
        workflowId,
        actions,
        {}
      );

      expect(finalStatus).toBe('completed');
    });

    it('should mark execution as failed on error', async () => {
      const actions = [
        {
          type: 'update_order',
          orderId: 'invalid-order',
          stopOnError: true
        }
      ];

      let finalStatus: string | undefined;
      prismaMock.workflowExecution.update.mockImplementation((args: any) => {
        if (args.data.status) {
          finalStatus = args.data.status;
        }
        return Promise.resolve({} as any);
      });
      prismaMock.order.update.mockRejectedValue(new Error('Order not found'));

      await expect(
        workflowService.processWorkflowExecution(
          executionId,
          workflowId,
          actions,
          {}
        )
      ).rejects.toThrow();

      expect(finalStatus).toBe('failed');
    });
  });

  describe('evaluateConditions', () => {
    it('should return true when conditions match', async () => {
      const workflow = {
        id: 'workflow-1',
        conditions: { status: 'delivered', amount: 100 }
      };

      prismaMock.workflow.findUnique.mockResolvedValue(workflow as any);

      const input = { status: 'delivered', amount: 100 };
      const result = (workflowService as any).evaluateConditions(
        workflow.conditions,
        input
      );

      expect(result).toBe(true);
    });

    it('should return false when conditions do not match', async () => {
      const workflow = {
        id: 'workflow-1',
        conditions: { status: 'delivered' }
      };

      prismaMock.workflow.findUnique.mockResolvedValue(workflow as any);

      const input = { status: 'pending' };
      const result = (workflowService as any).evaluateConditions(
        workflow.conditions,
        input
      );

      expect(result).toBe(false);
    });

    it('should return true when no conditions specified', async () => {
      const result = (workflowService as any).evaluateConditions({}, {});

      expect(result).toBe(true);
    });
  });

  describe('executeAction - update_order', () => {
    it('should update order successfully', async () => {
      const action = {
        type: 'update_order',
        orderId: 'order-1',
        status: 'confirmed',
        notes: 'Auto-confirmed'
      };

      const mockOrder = {
        id: 'order-1',
        orderNumber: '1001',
        status: 'confirmed'
      };

      prismaMock.order.update.mockResolvedValue(mockOrder as any);

      const result = await (workflowService as any).executeAction(
        action,
        { orderId: 'order-1' }
      );

      expect(result.success).toBe(true);
      expect(result.orderId).toBe('order-1');
      expect(prismaMock.order.update).toHaveBeenCalled();
    });

    it('should throw error when order ID not provided', async () => {
      const action = {
        type: 'update_order',
        status: 'confirmed'
      };

      await expect(
        (workflowService as any).executeAction(action, {})
      ).rejects.toThrow('Order ID not provided');
    });
  });

  describe('executeAction - assign_agent', () => {
    it('should assign agent to order successfully', async () => {
      const action = {
        type: 'assign_agent',
        orderId: 'order-1',
        agentId: 'agent-1'
      };

      const mockOrder = {
        id: 'order-1',
        deliveryAgentId: 'agent-1'
      };

      prismaMock.order.update.mockResolvedValue(mockOrder as any);

      const result = await (workflowService as any).executeAction(action, {});

      expect(result.success).toBe(true);
      expect(result.agentId).toBe('agent-1');
      expect(prismaMock.order.update).toHaveBeenCalled();
    });

    it('should throw error when agent ID not provided', async () => {
      const action = {
        type: 'assign_agent',
        orderId: 'order-1'
      };

      await expect(
        (workflowService as any).executeAction(action, {})
      ).rejects.toThrow('Order ID or Agent ID not provided');
    });
  });

  describe('executeAction - add_tag', () => {
    it('should add tag to order successfully', async () => {
      const action = {
        type: 'add_tag',
        orderId: 'order-1',
        tag: 'urgent'
      };

      const mockOrder = {
        id: 'order-1',
        tags: ['normal']
      };

      prismaMock.order.findUnique.mockResolvedValue(mockOrder as any);
      prismaMock.order.update.mockResolvedValue({
        ...mockOrder,
        tags: ['normal', 'urgent']
      } as any);

      const result = await (workflowService as any).executeAction(action, {});

      expect(result.success).toBe(true);
      expect(result.tag).toBe('urgent');
      expect(prismaMock.order.update).toHaveBeenCalled();
    });

    it('should not duplicate tags', async () => {
      const action = {
        type: 'add_tag',
        orderId: 'order-1',
        tag: 'urgent'
      };

      const mockOrder = {
        id: 'order-1',
        tags: ['urgent']
      };

      prismaMock.order.findUnique.mockResolvedValue(mockOrder as any);
      prismaMock.order.update.mockResolvedValue(mockOrder as any);

      await (workflowService as any).executeAction(action, {});

      const updateCall = (prismaMock.order.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data.tags).toEqual(['urgent']);
    });
  });

  describe('triggerStatusChangeWorkflows', () => {
    it('should trigger workflows on status change', async () => {
      const mockWorkflows = [
        {
          id: 'workflow-1',
          name: 'Order Confirmed Workflow',
          isActive: true,
          triggerType: 'status_change',
          actions: [{ type: 'send_sms' }]
        }
      ];

      prismaMock.workflow.findMany.mockResolvedValue(mockWorkflows as any);
      prismaMock.workflow.findUnique.mockResolvedValue(mockWorkflows[0] as any);
      prismaMock.workflowExecution.create.mockResolvedValue({} as any);

      await workflowService.triggerStatusChangeWorkflows(
        'order-1',
        'pending_confirmation',
        'confirmed'
      );

      expect(prismaMock.workflow.findMany).toHaveBeenCalled();
      expect(prismaMock.workflowExecution.create).toHaveBeenCalled();
    });

    it('should not trigger workflows when none match', async () => {
      prismaMock.workflow.findMany.mockResolvedValue([]);

      await workflowService.triggerStatusChangeWorkflows(
        'order-1',
        'pending',
        'confirmed'
      );

      expect(prismaMock.workflowExecution.create).not.toHaveBeenCalled();
    });
  });

  describe('deleteWorkflow', () => {
    it('should delete workflow successfully', async () => {
      const mockWorkflow = {
        id: 'workflow-1',
        name: 'Test Workflow'
      };

      prismaMock.workflow.findUnique.mockResolvedValue(mockWorkflow as any);
      prismaMock.workflow.delete.mockResolvedValue(mockWorkflow as any);

      const result = await workflowService.deleteWorkflow('workflow-1');

      expect(result.message).toBe('Workflow deleted successfully');
      expect(prismaMock.workflow.delete).toHaveBeenCalled();
    });

    it('should throw error when workflow not found', async () => {
      prismaMock.workflow.findUnique.mockResolvedValue(null);

      await expect(
        workflowService.deleteWorkflow('workflow-1')
      ).rejects.toThrow(new AppError('Workflow not found', 404));
    });
  });
});
