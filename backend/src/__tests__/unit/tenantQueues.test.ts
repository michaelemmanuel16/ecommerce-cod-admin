import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { prismaMock } from '../mocks/prisma.mock';
import { getTenantId } from '../../utils/tenantContext';

// T14: every job processor runs inside tenantStorage.run, once per tenant for the
// all-tenant jobs. Under NODE_ENV=test the queues are inert, so the exported
// processor functions are called directly.

const mockSync = jest.fn<() => Promise<void>>();
const mockGetOverdueAgents = jest.fn<() => Promise<any[]>>();
jest.mock('../../services/agingService', () => ({
  __esModule: true,
  default: {
    syncNegativeCashFindings: (...a: any[]) => (mockSync as any)(...a),
    getOverdueAgents: (...a: any[]) => (mockGetOverdueAgents as any)(...a),
  },
}));

const mockNotifyAdmins = jest.fn<(agents: any[]) => Promise<void>>();
jest.mock('../../services/notificationService', () => ({
  notifyAdminsOverdueCollections: (...a: any[]) => (mockNotifyAdmins as any)(...a),
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../utils/socketInstance', () => ({
  getSocketInstance: jest.fn(() => null),
}));

import { processSyncCashFindings, processNotifyOverdueCollections } from '../../queues/agingQueue';
import { processCleanupOldMessages } from '../../queues/messageCleanupQueue';
import { processCleanupStalePending } from '../../queues/pendingCheckoutCleanupQueue';
import { processExecuteWorkflow } from '../../queues/workflowQueue';
import { processCampaignRecipient } from '../../queues/emailCampaignQueue';

const twoTenants = () =>
  (prismaMock.tenant.findMany as any).mockResolvedValue([{ id: 'tenant-a' }, { id: 'tenant-b' }]);

describe('job processors run inside a tenant context', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    twoTenants();
  });

  it('agingQueue sync-cash-findings: sync once per tenant, each in its own context', async () => {
    const seen: Array<string | null> = [];
    mockSync.mockImplementation(async () => { seen.push(getTenantId()); });

    await processSyncCashFindings();

    expect(seen).toEqual(['tenant-a', 'tenant-b']);
  });

  it('agingQueue sync-cash-findings: a failing tenant does not stop the others, job still fails', async () => {
    const seen: Array<string | null> = [];
    mockSync.mockImplementation(async () => {
      seen.push(getTenantId());
      if (getTenantId() === 'tenant-a') throw new Error('boom');
    });

    await expect(processSyncCashFindings()).rejects.toThrow('failed for 1/2 tenants');
    expect(seen).toEqual(['tenant-a', 'tenant-b']);
  });

  it('agingQueue notify-overdue-collections: reads and notifies inside each tenant', async () => {
    const seen: Array<string | null> = [];
    mockGetOverdueAgents.mockImplementation(async () => {
      seen.push(`read:${getTenantId()}`);
      return [{ agentId: 1, agentName: 'A', totalBalance: 1, warningAmount: 1, criticalAmount: 0 }];
    });
    mockNotifyAdmins.mockImplementation(async () => { seen.push(`notify:${getTenantId()}`); });

    await processNotifyOverdueCollections();

    expect(seen).toEqual(['read:tenant-a', 'notify:tenant-a', 'read:tenant-b', 'notify:tenant-b']);
  });

  it('messageCleanupQueue: deletes inside each tenant context', async () => {
    const seen: Array<string | null> = [];
    (prismaMock.messageLog.findMany as any).mockImplementation(async () => {
      seen.push(getTenantId());
      return [];
    });

    await processCleanupOldMessages();

    expect(seen).toEqual(['tenant-a', 'tenant-b']);
  });

  it('pendingCheckoutCleanupQueue: deletes inside each tenant context', async () => {
    const seen: Array<string | null> = [];
    (prismaMock.pendingCheckout.deleteMany as any).mockImplementation(async () => {
      seen.push(getTenantId());
      return { count: 1 };
    });

    await processCleanupStalePending();

    expect(seen).toEqual(['tenant-a', 'tenant-b']);
  });

  it('workflowQueue: runs the job inside the tenant carried by the job', async () => {
    let seen: string | null = null;
    (prismaMock.workflowExecution.update as any).mockImplementation(async () => {
      seen = getTenantId();
      return {};
    });

    await processExecuteWorkflow({
      id: 'j1',
      data: { executionId: 1, workflowId: 1, actions: [], conditions: null, input: {}, tenantId: 'tenant-b' },
    } as any);

    expect(seen).toBe('tenant-b');
  });

  it('workflowQueue: a job with no tenantId fails with a clear error and touches no data', async () => {
    await expect(
      processExecuteWorkflow({
        id: 'j2',
        data: { executionId: 1, workflowId: 1, actions: [], conditions: null, input: {} },
      } as any)
    ).rejects.toThrow('has no tenantId');
    expect(prismaMock.workflowExecution.update).not.toHaveBeenCalled();
  });

  it('emailCampaignQueue: runs inside the job tenant', async () => {
    let seen: string | null = null;
    (prismaMock.emailCampaign.findUnique as any).mockImplementation(async () => {
      seen = getTenantId();
      return null;
    });

    await processCampaignRecipient({ campaignId: 1, customerId: 1, tenantId: 'tenant-a' });

    expect(seen).toBe('tenant-a');
  });

  it('emailCampaignQueue: a job with no tenantId fails with a clear error', async () => {
    await expect(
      processCampaignRecipient({ campaignId: 1, customerId: 1, tenantId: null })
    ).rejects.toThrow('has no tenantId');
    expect(prismaMock.emailCampaign.findUnique).not.toHaveBeenCalled();
  });
});
