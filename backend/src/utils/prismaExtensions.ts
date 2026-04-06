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

        if (SOFT_DELETE_IS_ACTIVE.has(model)) {
          args.where = { ...args.where, isActive: true } as any;
        } else if (SOFT_DELETE_DELETED_AT.has(model)) {
          args.where = { ...args.where, deletedAt: null } as any;
        }

        return query(args);
      },
      async findFirst({ model, args, query }) {

        if (SOFT_DELETE_IS_ACTIVE.has(model)) {
          args.where = { ...args.where, isActive: true } as any;
        } else if (SOFT_DELETE_DELETED_AT.has(model)) {
          args.where = { ...args.where, deletedAt: null } as any;
        }

        return query(args);
      },
      async findMany({ model, args, query }) {

        if (SOFT_DELETE_IS_ACTIVE.has(model)) {
          args.where = { ...args.where, isActive: true } as any;
        } else if (SOFT_DELETE_DELETED_AT.has(model)) {
          args.where = { ...args.where, deletedAt: null } as any;
        }

        return query(args);
      },
    },
  },
});
