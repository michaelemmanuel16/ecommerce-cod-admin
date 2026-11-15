import type { Workflow, WorkflowRun, WorkflowTemplate } from '../../services/workflows.service';

export const workflow = (over: Partial<Workflow> = {}): Workflow => ({
  id: 1,
  name: 'Send confirmation SMS',
  description: 'Texts the customer when the rep confirms',
  triggerType: 'status_change',
  triggerData: { status: 'confirmed' },
  actions: [{ type: 'send_sms', config: { phoneNumber: '+233201234567', message: 'Confirmed' } }],
  conditions: {},
  isActive: true,
  createdAt: '2026-11-01T08:00:00.000Z',
  updatedAt: '2026-11-01T08:00:00.000Z',
  stats: { runs: 12, succeeded: 10, failed: 2, days: 30, lastRunAt: '2026-11-14T08:00:00.000Z' },
  ...over,
});

export const template = (over: Partial<WorkflowTemplate> = {}): WorkflowTemplate => ({
  id: 'send-confirmation-sms',
  name: 'Confirmation text',
  description: 'Text the customer as soon as an order is confirmed.',
  category: 'Customer Service',
  triggerType: 'status_change',
  triggerData: { status: 'confirmed' },
  actions: [{ type: 'send_sms', phoneNumber: '+233200000000', message: 'Hello' }],
  needs: ['sms'],
  available: true,
  ...over,
});

export const run = (over: Partial<WorkflowRun> = {}): WorkflowRun => ({
  id: 100,
  workflowId: 1,
  status: 'completed',
  mode: 'live',
  triggerSource: 'screen',
  orderId: 24117,
  startedAt: '2026-11-14T08:00:00.000Z',
  finishedAt: '2026-11-14T08:00:02.000Z',
  input: {},
  error: null,
  failedStepIndex: null,
  retryOf: null,
  steps: [{ index: 0, type: 'send_sms', status: 'completed', result: { sent: true }, error: null }],
  ...over,
});
