import { Prisma } from '@prisma/client';
import { getTenantId } from './tenantContext';

// Models that carry a tenantId column and need automatic scoping
// Must match EXACTLY the PascalCase model names in prisma/schema.prisma
const TENANT_SCOPED_MODELS = new Set([
  'User', 'Customer', 'Product', 'Order', 'Delivery',
  'Transaction', 'Expense', 'Account', 'JournalEntry', 'AccountTransaction',
  'Workflow', 'WorkflowExecution', 'WebhookConfig', 'Notification',
  'CheckoutForm', 'InventoryShipment', 'InventoryTransfer',
  'AgentBalance', 'AgentStock', 'MessageLog', 'SystemConfig',
  'McpApiKey',
]);

/**
 * Auto-injects tenantId into Prisma queries for all tenant-scoped models.
 * Reads tenantId from AsyncLocalStorage (set by tenantMiddleware).
 * When no tenantId is in context (e.g. public routes, seeds), passes through unchanged.
 */
export const tenantIsolationExtension = Prisma.defineExtension({
  name: 'tenantIsolation',
  query: {
    $allModels: {
      async findMany({ model, args, query }) {
        if (TENANT_SCOPED_MODELS.has(model)) {
          const tenantId = getTenantId();
          if (tenantId) {
            args.where = { ...args.where, tenantId } as any;
          }
        }
        return query(args);
      },
      async findFirst({ model, args, query }) {
        if (TENANT_SCOPED_MODELS.has(model)) {
          const tenantId = getTenantId();
          if (tenantId) {
            args.where = { ...args.where, tenantId } as any;
          }
        }
        return query(args);
      },
      async findUnique({ model, args, query }) {
        if (TENANT_SCOPED_MODELS.has(model)) {
          const tenantId = getTenantId();
          if (tenantId) {
            args.where = { ...args.where, tenantId } as any;
          }
        }
        return query(args);
      },
      async count({ model, args, query }) {
        if (TENANT_SCOPED_MODELS.has(model)) {
          const tenantId = getTenantId();
          if (tenantId) {
            args.where = { ...args.where, tenantId } as any;
          }
        }
        return query(args);
      },
      async create({ model, args, query }) {
        if (TENANT_SCOPED_MODELS.has(model)) {
          const tenantId = getTenantId();
          if (tenantId) {
            args.data = { ...args.data, tenantId } as any;
          }
        }
        return query(args);
      },
      async createMany({ model, args, query }) {
        if (TENANT_SCOPED_MODELS.has(model)) {
          const tenantId = getTenantId();
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
      async update({ model, args, query }) {
        if (TENANT_SCOPED_MODELS.has(model)) {
          const tenantId = getTenantId();
          if (tenantId) {
            args.where = { ...args.where, tenantId } as any;
          }
        }
        return query(args);
      },
      async updateMany({ model, args, query }) {
        if (TENANT_SCOPED_MODELS.has(model)) {
          const tenantId = getTenantId();
          if (tenantId) {
            args.where = { ...args.where, tenantId } as any;
          }
        }
        return query(args);
      },
      async upsert({ model, args, query }) {
        if (TENANT_SCOPED_MODELS.has(model)) {
          const tenantId = getTenantId();
          if (tenantId) {
            args.where = { ...args.where, tenantId } as any;
            args.create = { ...args.create, tenantId } as any;
            args.update = { ...args.update, tenantId } as any;
          }
        }
        return query(args);
      },
      async aggregate({ model, args, query }) {
        if (TENANT_SCOPED_MODELS.has(model)) {
          const tenantId = getTenantId();
          if (tenantId) {
            args.where = { ...args.where, tenantId } as any;
          }
        }
        return query(args);
      },
      async groupBy({ model, args, query }) {
        if (TENANT_SCOPED_MODELS.has(model)) {
          const tenantId = getTenantId();
          if (tenantId) {
            args.where = { ...args.where, tenantId } as any;
          }
        }
        return query(args);
      },
      async delete({ model, args, query }) {
        if (TENANT_SCOPED_MODELS.has(model)) {
          const tenantId = getTenantId();
          if (tenantId) {
            args.where = { ...args.where, tenantId } as any;
          }
        }
        return query(args);
      },
      async deleteMany({ model, args, query }) {
        if (TENANT_SCOPED_MODELS.has(model)) {
          const tenantId = getTenantId();
          if (tenantId) {
            args.where = { ...args.where, tenantId } as any;
          }
        }
        return query(args);
      },
    },
  },
});

const SOFT_DELETE_IS_ACTIVE = new Set(['User', 'Customer', 'Product', 'CheckoutForm', 'Automation']);
const SOFT_DELETE_DELETED_AT = new Set(['Order']);

// Out-of-band marker on a Prisma `where` clause that opts the caller out
// of the auto-injected soft-delete filter. Symbol keys are invisible to
// Prisma's serializer (it walks string keys via Object.keys), so they pass
// through findUnique's strict input validation without affecting the SQL
// — the extension strips the marker before calling query().
export const INCLUDE_SOFT_DELETED = Symbol('codadmin.includeSoftDeleted');

// Auto-inject the soft-delete filter only when the caller hasn't already
// expressed an intent for that field — otherwise an admin endpoint that
// wants to list inactive rows can never see them. Shallow check by design;
// callers using AND/OR composites must opt out via INCLUDE_SOFT_DELETED.
function applySoftDeleteFilter(model: string, args: { where?: any }) {
  const isActiveModel = SOFT_DELETE_IS_ACTIVE.has(model);
  const deletedAtModel = !isActiveModel && SOFT_DELETE_DELETED_AT.has(model);
  if (!isActiveModel && !deletedAtModel) return;

  const w = args.where as any;
  if (w && w[INCLUDE_SOFT_DELETED]) {
    delete w[INCLUDE_SOFT_DELETED];
    return;
  }

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
