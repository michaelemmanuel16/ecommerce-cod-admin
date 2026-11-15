import { describe, it, expect } from '@jest/globals';
import { Prisma } from '@prisma/client';
import { TENANT_SCOPED_MODELS } from '../../utils/prismaExtensions';

const M9_TENANT_MODELS = [
  'MessageEvent', 'Conversation', 'MessageTemplate', 'OptOutEvent',
  'Reminder', 'Thread', 'Comment', 'ThreadRead',
  'NotificationPreference', 'RoleNotificationDefault',
  'WorkflowTriggerOutbox', 'ConnectionEvent',
];

describe('M9 models and the tenant scoped list', () => {
  const models = Prisma.dmmf.datamodel.models;

  it.each(M9_TENANT_MODELS)('%s has a required tenantId and is in the scoped list', (name) => {
    const model = models.find((m) => m.name === name);
    expect(model).toBeDefined();
    const field = model!.fields.find((f) => f.name === 'tenantId');
    expect(field?.isRequired).toBe(true);
    expect(TENANT_SCOPED_MODELS.has(name)).toBe(true);
  });

  it('PendingMessageEvent is a system table: no tenantId, not in the scoped list', () => {
    const model = models.find((m) => m.name === 'PendingMessageEvent');
    expect(model).toBeDefined();
    expect(model!.fields.some((f) => f.name === 'tenantId')).toBe(false);
    expect(TENANT_SCOPED_MODELS.has('PendingMessageEvent')).toBe(false);
  });
});
