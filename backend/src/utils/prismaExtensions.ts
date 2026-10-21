import { Prisma } from '@prisma/client';
import { AsyncLocalStorage } from 'async_hooks';
import { AppError } from '../middleware/errorHandler';
import { isReservedSystemEmail } from './systemEmail';
import { getTenantId, isUnscoped, TenantContextMissing } from './tenantContext';

// Models that carry a tenantId column and need automatic scoping
// Must match EXACTLY the PascalCase model names in prisma/schema.prisma
export const TENANT_SCOPED_MODELS = new Set([
  'User', 'Customer', 'Product', 'Order', 'Delivery',
  'Transaction', 'Expense', 'Account', 'JournalEntry', 'AccountTransaction',
  'Workflow', 'WorkflowExecution', 'WebhookConfig', 'Notification',
  'CheckoutForm', 'InventoryShipment', 'InventoryTransfer',
  'AgentBalance', 'AgentStock', 'MessageLog', 'SystemConfig',
  'McpApiKey', 'EmailTemplate', 'EmailCampaign',
  'AgentCollection', 'AgentDeposit', 'AgentAgingBucket', 'Payout', 'Call',
  'OrderHistory', 'AuditLog', 'WebhookLog', 'SmsTemplate', 'DownloadToken',
  'FormSubmission', 'product_cost_entries', 'PendingCheckout', 'WebhookEvent',
  'Target', 'Finding', 'FeeRule', 'FxRate', 'Role', 'RoleAssignment',
]);

/**
 * Resolve the tenant for a query on a scoped model. Returns the tenantId to
 * inject, or null inside withoutTenant() (query runs unscoped). Throws
 * TenantContextMissing when there is no tenant context at all (fail-closed).
 */
function requireTenant(model: string, operation: string): string | null {
  const tenantId = getTenantId();
  if (tenantId) return tenantId;
  if (isUnscoped()) return null;
  throw new TenantContextMissing(model, operation);
}

function scopeWhere(operation: string) {
  return async ({ model, args, query }: { model: string; args: any; query: (a: any) => Promise<any> }) => {
    if (TENANT_SCOPED_MODELS.has(model)) {
      const tenantId = requireTenant(model, operation);
      if (tenantId) {
        args.where = { ...args.where, tenantId };
      }
    }
    return query(args);
  };
}

/**
 * Auto-injects tenantId into Prisma queries for all tenant-scoped models.
 * Reads tenantId from AsyncLocalStorage (set by auth middleware, queues, public routes).
 * Fail-closed: with no tenant context a scoped-model query throws TenantContextMissing.
 * Use withoutTenant(reason, fn) for the few paths that must run across tenants.
 */
export const tenantIsolationExtension = Prisma.defineExtension({
  name: 'tenantIsolation',
  query: {
    $allModels: {
      findMany: scopeWhere('findMany'),
      findFirst: scopeWhere('findFirst'),
      findFirstOrThrow: scopeWhere('findFirstOrThrow'),
      findUnique: scopeWhere('findUnique'),
      findUniqueOrThrow: scopeWhere('findUniqueOrThrow'),
      count: scopeWhere('count'),
      update: scopeWhere('update'),
      updateMany: scopeWhere('updateMany'),
      aggregate: scopeWhere('aggregate'),
      groupBy: scopeWhere('groupBy'),
      delete: scopeWhere('delete'),
      deleteMany: scopeWhere('deleteMany'),
      async create({ model, args, query }) {
        if (TENANT_SCOPED_MODELS.has(model)) {
          const tenantId = requireTenant(model, 'create');
          if (tenantId) {
            args.data = { ...args.data, tenantId } as any;
          }
        }
        return query(args);
      },
      async createMany({ model, args, query }) {
        if (TENANT_SCOPED_MODELS.has(model)) {
          const tenantId = requireTenant(model, 'createMany');
          if (tenantId) {
            const data = args.data as any;
            if (Array.isArray(data)) {
              args.data = data.map((row: any) => ({ ...row, tenantId })) as any;
            } else {
              args.data = { ...data, tenantId } as any;
            }
          }
        }
        return query(args);
      },
      async upsert({ model, args, query }) {
        if (TENANT_SCOPED_MODELS.has(model)) {
          const tenantId = requireTenant(model, 'upsert');
          if (tenantId) {
            args.where = { ...args.where, tenantId } as any;
            args.create = { ...args.create, tenantId } as any;
            args.update = { ...args.update, tenantId } as any;
          }
        }
        return query(args);
      },
    },
  },
});

// A written scalar may be a plain value or a Prisma `{ set: value }` update.
const written = (v: any) => (v && typeof v === 'object' && 'set' in v ? v.set : v);

/**
 * The reserved system email domain belongs to kind = system users only. A normal user on
 * `system+<tenant>@...` would block ensureSystemUser (email is unique) and break GL postings.
 * On update, `kind` is not in data for normal edits, so a reserved email is refused outright.
 */
function guardReservedEmail(row: any, operation: string) {
  const email = written(row?.email);
  if (email === undefined || !isReservedSystemEmail(email)) return;
  const isCreate = operation === 'create' || operation === 'createMany';
  if (written(row?.kind) === 'system' && isCreate) return;
  throw new AppError('This email address is reserved for system use', 400, 'RESERVED_EMAIL');
}

const guardUser = (operation: string, pick: (args: any) => any[]) =>
  async ({ args, query }: { args: any; query: (a: any) => Promise<any> }) => {
    pick(args).forEach((row) => guardReservedEmail(row, operation));
    return query(args);
  };

/** Refuses the reserved system email on user writes unless a system user is being created. */
export const reservedEmailExtension = Prisma.defineExtension({
  name: 'reservedEmail',
  query: {
    user: {
      create: guardUser('create', (a) => [a.data]),
      createMany: guardUser('createMany', (a) => (Array.isArray(a.data) ? a.data : [a.data])),
      update: guardUser('update', (a) => [a.data]),
      updateMany: guardUser('updateMany', (a) => [a.data]),
      upsert: guardUser('upsert', (a) => [a.create, { ...a.update, kind: undefined }]),
    },
  },
});

const SOFT_DELETE_IS_ACTIVE = new Set(['User', 'Customer', 'Product', 'CheckoutForm', 'Automation']);
const SOFT_DELETE_DELETED_AT = new Set(['Order']);

// AsyncLocalStorage scope for opting out of the soft-delete auto-inject.
// Symbol keys on `args.where` would not survive Prisma's extension framework
// (they're stripped before reaching the hook), so a context-based mechanism
// is required. Same pattern as tenantContext.ts.
const softDeleteStorage = new AsyncLocalStorage<{ skip: boolean }>();

/**
 * Run `fn` in a scope where the soft-delete extension does not auto-inject
 * its filter. Use this for admin lookups that must see inactive/deleted
 * rows (e.g. reactivating a deactivated user).
 *
 * Tenant-isolation auto-inject is unaffected.
 *
 * Implementation note: AsyncLocalStorage.run only preserves the store for
 * the synchronous portion of its callback. If `fn` is a sync arrow that
 * returns a Promise, the store is reset before that Promise's continuations
 * run — so the Prisma extension hook sees `undefined`. Wrapping in an async
 * function keeps the scope alive until the inner promise resolves.
 */
export function withSoftDeleted<T>(fn: () => Promise<T>): Promise<T> {
  return softDeleteStorage.run({ skip: true }, async () => fn());
}

// Auto-inject the soft-delete filter only when the caller hasn't already
// expressed an intent for that field — otherwise an admin endpoint that
// wants to list inactive rows can never see them. Shallow check by design;
// callers using AND/OR composites must opt out via withSoftDeleted().
function applySoftDeleteFilter(model: string, args: { where?: any }) {
  if (softDeleteStorage.getStore()?.skip) return;

  const isActiveModel = SOFT_DELETE_IS_ACTIVE.has(model);
  const deletedAtModel = !isActiveModel && SOFT_DELETE_DELETED_AT.has(model);
  if (!isActiveModel && !deletedAtModel) return;

  const w = args.where as any;
  if (isActiveModel) {
    if (w?.isActive === undefined) args.where = { ...w, isActive: true };
  } else {
    if (w?.deletedAt === undefined) args.where = { ...w, deletedAt: null };
  }
}

export const softDeleteExtension = Prisma.defineExtension({
  name: 'softDelete',
  query: {
    $allModels: {
      async delete({ model, args, query }) {
        const client = Prisma.getExtensionContext(this);
        const modelClient = (client as any)[model.charAt(0).toLowerCase() + model.slice(1)];

        if (SOFT_DELETE_IS_ACTIVE.has(model) && modelClient) {
          return modelClient.update({
            where: args.where,
            data: { isActive: false },
          });
        }

        if (SOFT_DELETE_DELETED_AT.has(model) && modelClient) {
          return modelClient.update({
            where: args.where,
            data: { deletedAt: new Date() },
          });
        }

        return query(args);
      },
      async deleteMany({ model, args, query }) {
        const client = Prisma.getExtensionContext(this);
        const modelClient = (client as any)[model.charAt(0).toLowerCase() + model.slice(1)];

        if (SOFT_DELETE_IS_ACTIVE.has(model) && modelClient) {
          return modelClient.updateMany({
            where: args.where,
            data: { isActive: false },
          });
        }

        if (SOFT_DELETE_DELETED_AT.has(model) && modelClient) {
          return modelClient.updateMany({
            where: args.where,
            data: { deletedAt: new Date() },
          });
        }

        return query(args);
      },
      async findUnique({ model, args, query }) {
        applySoftDeleteFilter(model, args);
        return query(args);
      },
      async findFirst({ model, args, query }) {
        applySoftDeleteFilter(model, args);
        return query(args);
      },
      async findMany({ model, args, query }) {
        applySoftDeleteFilter(model, args);
        return query(args);
      },
      async count({ model, args, query }) {
        applySoftDeleteFilter(model, args);
        return query(args);
      },
    },
  },
});
