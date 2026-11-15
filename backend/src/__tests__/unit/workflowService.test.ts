import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { prismaMock } from '../mocks/prisma.mock';
import { WorkflowService } from '../../services/workflowService';
import { AppError } from '../../middleware/errorHandler';
import { systemActor } from '../../services/systemUserService';
import { smsService } from '../../services/smsService';
import { WorkflowTriggerType } from '@prisma/client';

// Mock the workflow queue
jest.mock('../../queues/workflowQueue', () => ({
  workflowQueue: {
    add: jest.fn().mockResolvedValue({})
  },
}));

// M2-T16: status moves and assignments go through the services, not prisma.order.update
jest.mock('../../services/orderStateMachine', () => ({ transitionOrder: jest.fn() }));
jest.mock('../../services/systemUserService', () => ({ systemActor: jest.fn() }));
jest.mock('../../services/assignmentService', () => ({
  __esModule: true,
  default: { assignByRole: jest.fn() },
}));

// Mock the SMS service
jest.mock('../../services/smsService', () => ({
  smsService: {
    sendSms: jest.fn().mockResolvedValue({ messageLogId: 1, sent: true }),
  },
  sendSmsForOrder: jest.fn().mockResolvedValue({ messageLogId: 1, sent: true }),
  clearSmsConfigCache: jest.fn(),
}));

// Mock the email service
jest.mock('../../services/emailService', () => ({
  sendEmail: jest.fn().mockResolvedValue(undefined),
  clearEmailConfigCache: jest.fn(),
}));

describe('WorkflowService', () => {
  let workflowService: WorkflowService;

  beforeEach(() => {
    workflowService = new WorkflowService();
    (systemActor as jest.Mock).mockResolvedValue({ kind: 'system', userId: 77 } as never);
    // resetMocks clears the factory's value; the service is now loaded early (the inbox imports it), so set it here
    (smsService.sendSms as jest.Mock).mockResolvedValue({ messageLogId: 1, sent: true } as never);
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
      tenantId: 'tenant-1',
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
      // M9: the skip is written to the history with its reason, and no step runs
      expect(prismaMock.workflowExecution.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'skipped', error: 'conditions_not_met' }),
      }));
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

  describe('triggerStatusChangeWorkflows', () => {
    it('should trigger workflows on status change', async () => {
      const mockWorkflows = [
        {
          id: 'workflow-1',
          tenantId: 'tenant-1',
          name: 'Order Confirmed Workflow',
          isActive: true,
          triggerType: 'status_change',
          actions: [{ type: 'send_sms' }]
        }
      ];

      prismaMock.workflow.findMany.mockResolvedValue(mockWorkflows as any);
      prismaMock.workflow.findUnique.mockResolvedValue(mockWorkflows[0] as any);
      prismaMock.workflowExecution.create.mockResolvedValue({} as any);
      prismaMock.workflowExecution.findMany.mockResolvedValue([]); // loop guard: nothing ran lately

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

  describe('createWorkflow - send_whatsapp action', () => {
    it('should accept send_whatsapp as a valid action type', async () => {
      const whatsappWorkflowData = {
        name: 'WhatsApp Order Confirmation',
        description: 'Send WhatsApp when order is confirmed',
        triggerType: 'status_change' as WorkflowTriggerType,
        triggerData: { status: 'confirmed' },
        actions: [
          {
            type: 'send_whatsapp',
            config: { templateKey: 'confirmed' }
          }
        ],
        conditions: {}
      };

      const mockWorkflow = {
        id: 'workflow-wa-1',
        ...whatsappWorkflowData,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      prismaMock.workflow.create.mockResolvedValue(mockWorkflow as any);

      const workflow = await workflowService.createWorkflow(whatsappWorkflowData);

      expect(workflow).toBeDefined();
      expect(workflow.name).toBe('WhatsApp Order Confirmation');
      expect(workflow.actions).toHaveLength(1);
      expect((workflow.actions as any[])[0].type).toBe('send_whatsapp');
    });

    it('should accept send_whatsapp alongside other actions', async () => {
      const multiActionData = {
        name: 'Confirm and Notify',
        triggerType: 'status_change' as WorkflowTriggerType,
        triggerData: { status: 'confirmed' },
        actions: [
          { type: 'update_order', config: { status: 'confirmed' } },
          { type: 'send_whatsapp', config: { templateKey: 'confirmed' } },
          { type: 'send_sms', config: { message: 'Order confirmed' } }
        ],
        conditions: {}
      };

      const mockWorkflow = {
        id: 'workflow-multi-1',
        ...multiActionData,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      prismaMock.workflow.create.mockResolvedValue(mockWorkflow as any);

      const workflow = await workflowService.createWorkflow(multiActionData);

      expect(workflow.actions).toHaveLength(3);
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
