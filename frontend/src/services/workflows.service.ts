import apiClient from './api';

/**
 * The Workflows API (M9-T41 to T43). Every call is `quiet`: the page says a refusal once, in its own toast.
 * `GET /api/workflows` answers `{ workflows, summary }`; each workflow carries its 30-day `stats`.
 */

export type TriggerType = 'order_created' | 'status_change' | 'payment_received' | 'time_based' | 'manual' | 'webhook';

export interface WorkflowStats {
  runs: number;
  succeeded: number;
  failed: number;
  days: number;
  lastRunAt: string | null;
}

export interface Workflow {
  id: number;
  name: string;
  description: string | null;
  triggerType: TriggerType;
  triggerData: any;
  actions: any[];
  conditions: any;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  /** A webhook workflow says whether it has a token; the token itself is never read back. */
  hasWebhookToken?: boolean;
  /** Only on the list. */
  stats?: WorkflowStats;
}

export interface WorkflowSummary {
  activeCount: number;
  runsToday: number;
  failuresToday: number;
}

export interface WorkflowList {
  workflows: Workflow[];
  summary: WorkflowSummary;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  triggerType: TriggerType;
  triggerData: any;
  conditions?: any;
  actions: any[];
  needs: string[];
  available: boolean;
  /** Why a card cannot be used, for example "Needs WhatsApp in Connections". */
  unavailableReason?: string;
}

export interface WorkflowStep {
  index: number;
  type: string | null;
  status: string;
  result: any;
  error: string | null;
}

export interface WorkflowRun {
  id: number;
  workflowId: number;
  status: string;
  mode: 'live' | 'test';
  triggerSource: string | null;
  orderId: number | null;
  startedAt: string;
  finishedAt: string | null;
  input: any;
  error: string | null;
  failedStepIndex: number | null;
  retryOf: number | null;
  steps: WorkflowStep[];
}

export interface RunsPage {
  executions: WorkflowRun[];
  pagination: { page: number; limit: number; total: number; pages: number };
}

export interface TestPlanStep {
  index: number;
  type: string;
  willDo: string;
}

export interface TestRunResult {
  executionId: number;
  mode: 'test';
  conditions: { evaluated: boolean; matches: boolean | null; reason: string | null };
  plan: TestPlanStep[];
  sent: false;
}

export type RunOutcome =
  | { warning: 'already_ran'; orderIds: number[] }
  | { queued: number; batches: number };

export interface CatchUpPreview {
  count: number;
  orderIds: number[];
  capped: boolean;
}

export interface RegionList {
  country: string | null;
  countryCode: string | null;
  regions: string[];
}

export type WorkflowBody = Partial<Pick<Workflow, 'name' | 'description' | 'triggerType' | 'triggerData' | 'actions' | 'conditions' | 'isActive'>>;

const quiet = { quiet: true } as const;

export const workflowsService = {
  async getWorkflows(params?: { isActive?: boolean; triggerType?: string }): Promise<WorkflowList> {
    const { data } = await apiClient.get('/api/workflows', { params, skipCache: true, ...quiet });
    return { workflows: data.workflows ?? [], summary: data.summary ?? { activeCount: 0, runsToday: 0, failuresToday: 0 } };
  },

  async getTemplates(): Promise<WorkflowTemplate[]> {
    const { data } = await apiClient.get('/api/workflows/templates', quiet);
    return data.templates ?? [];
  },

  async getRegions(): Promise<RegionList> {
    const { data } = await apiClient.get('/api/workflows/meta/regions', quiet);
    return { country: data.country ?? null, countryCode: data.countryCode ?? null, regions: data.regions ?? [] };
  },

  async getWorkflow(id: number): Promise<Workflow> {
    const { data } = await apiClient.get(`/api/workflows/${id}`, { skipCache: true, ...quiet });
    return data.workflow;
  },

  /** A webhook workflow's token is in this answer and nowhere else. */
  async createWorkflow(body: WorkflowBody): Promise<{ workflow: Workflow; webhookToken?: string }> {
    const { data } = await apiClient.post('/api/workflows', body, quiet);
    return { workflow: data.workflow, webhookToken: data.webhookToken };
  },

  async updateWorkflow(id: number, body: WorkflowBody): Promise<{ workflow: Workflow; webhookToken?: string }> {
    const { data } = await apiClient.put(`/api/workflows/${id}`, body, quiet);
    return { workflow: data.workflow, webhookToken: data.webhookToken };
  },

  async deleteWorkflow(id: number): Promise<void> {
    await apiClient.delete(`/api/workflows/${id}`, quiet);
  },

  async regenerateToken(id: number): Promise<string> {
    const { data } = await apiClient.post(`/api/workflows/${id}/webhook-token/regenerate`, {}, quiet);
    return data.webhookToken;
  },

  async getRuns(id: number, params: { page?: number; limit?: number } = {}): Promise<RunsPage> {
    const { data } = await apiClient.get(`/api/workflows/${id}/executions`, { params, skipCache: true, ...quiet });
    return data;
  },

  async getRun(executionId: number): Promise<WorkflowRun> {
    const { data } = await apiClient.get(`/api/workflows/executions/${executionId}`, { skipCache: true, ...quiet });
    return data.execution;
  },

  async retryRun(executionId: number): Promise<{ message: string }> {
    const { data } = await apiClient.post(`/api/workflows/executions/${executionId}/retry`, {}, quiet);
    return { message: data.message };
  },

  /** 200 with `warning: 'already_ran'` and nothing queued, or 202 with `queued`. Send `confirm: true` to run again anyway. */
  async runOnOrders(id: number, orderIds: number[], confirm?: boolean): Promise<RunOutcome> {
    const { data } = await apiClient.post(`/api/workflows/${id}/run`, { orderIds, ...(confirm ? { confirm: true } : {}) }, quiet);
    return data;
  },

  async testRun(id: number, orderId?: number): Promise<TestRunResult> {
    const { data } = await apiClient.post(`/api/workflows/${id}/test`, orderId === undefined ? {} : { orderId }, quiet);
    return data;
  },

  async previewCatchUp(id: number): Promise<CatchUpPreview> {
    const { data } = await apiClient.get(`/api/workflows/${id}/catch-up/preview`, { skipCache: true, ...quiet });
    return data;
  },

  async runCatchUp(id: number): Promise<{ queued: number; batches: number }> {
    const { data } = await apiClient.post(`/api/workflows/${id}/catch-up`, { confirm: true }, quiet);
    return data;
  },
};
