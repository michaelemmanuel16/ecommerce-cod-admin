import { Prisma } from '@prisma/client';

export const softDeleteExtension = Prisma.defineExtension({
  name: 'softDelete',
  query: {
    $allModels: {
      async delete({ model, args, query }) {
        const modelsWithIsActive = ['User', 'Customer', 'Product', 'CheckoutForm', 'Workflow', 'Automation'];
        const modelsWithDeletedAt = ['Order'];

        if (modelsWithIsActive.includes(model)) {
          return (query as any)({
            ...args,
            operation: 'update',
            args: {
              ...args,
              data: { isActive: false },
            },
          });
        }

        if (modelsWithDeletedAt.includes(model)) {
          return (query as any)({
            ...args,
            operation: 'update',
            args: {
              ...args,
              data: { deletedAt: new Date() },
            },
          });
        }

        return query(args);
      },
      async deleteMany({ model, args, query }) {
        const modelsWithIsActive = ['User', 'Customer', 'Product', 'CheckoutForm', 'Workflow', 'Automation'];
        const modelsWithDeletedAt = ['Order'];

        if (modelsWithIsActive.includes(model)) {
          return (query as any)({
            ...args,
            operation: 'updateMany',
            args: {
              ...args,
              data: { isActive: false },
            },
          });
        }

        if (modelsWithDeletedAt.includes(model)) {
          return (query as any)({
            ...args,
            operation: 'updateMany',
            args: {
              ...args,
              data: { deletedAt: new Date() },
            },
          });
        }

        return query(args);
      },
      async findUnique({ model, args, query }) {
        const modelsWithIsActive = ['User', 'Customer', 'Product', 'CheckoutForm', 'Workflow', 'Automation'];
        const modelsWithDeletedAt = ['Order'];

        if (modelsWithIsActive.includes(model)) {
          args.where = { ...args.where, isActive: true } as any;
        } else if (modelsWithDeletedAt.includes(model)) {
          args.where = { ...args.where, deletedAt: null } as any;
        }

        return query(args);
      },
      async findFirst({ model, args, query }) {
        const modelsWithIsActive = ['User', 'Customer', 'Product', 'CheckoutForm', 'Workflow', 'Automation'];
        const modelsWithDeletedAt = ['Order'];

        if (modelsWithIsActive.includes(model)) {
          args.where = { ...args.where, isActive: true } as any;
        } else if (modelsWithDeletedAt.includes(model)) {
          args.where = { ...args.where, deletedAt: null } as any;
        }

        return query(args);
      },
      async findMany({ model, args, query }) {
        const modelsWithIsActive = ['User', 'Customer', 'Product', 'CheckoutForm', 'Workflow', 'Automation'];
        const modelsWithDeletedAt = ['Order'];

        if (modelsWithIsActive.includes(model)) {
          args.where = { ...args.where, isActive: true } as any;
        } else if (modelsWithDeletedAt.includes(model)) {
          args.where = { ...args.where, deletedAt: null } as any;
        }

        return query(args);
      },
    },
  },
});
