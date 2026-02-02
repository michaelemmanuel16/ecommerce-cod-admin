import { Prisma } from '@prisma/client';

export const softDeleteExtension = Prisma.defineExtension({
  name: 'softDelete',
  query: {
    $allModels: {
      async delete({ model, args, query }) {
        const modelsWithIsActive = ['User', 'Customer', 'Product', 'CheckoutForm', 'Workflow', 'Automation'];
        const modelsWithDeletedAt = ['Order'];
        const client = Prisma.getExtensionContext(this);
        const modelClient = (client as any)[model.charAt(0).toLowerCase() + model.slice(1)];

        if (modelsWithIsActive.includes(model) && modelClient) {
          return modelClient.update({
            where: args.where,
            data: { isActive: false },
          });
        }

        if (modelsWithDeletedAt.includes(model) && modelClient) {
          return modelClient.update({
            where: args.where,
            data: { deletedAt: new Date() },
          });
        }

        return query(args);
      },
      async deleteMany({ model, args, query }) {
        const modelsWithIsActive = ['User', 'Customer', 'Product', 'CheckoutForm', 'Workflow', 'Automation'];
        const modelsWithDeletedAt = ['Order'];
        const client = Prisma.getExtensionContext(this);
        const modelClient = (client as any)[model.charAt(0).toLowerCase() + model.slice(1)];

        if (modelsWithIsActive.includes(model) && modelClient) {
          return modelClient.updateMany({
            where: args.where,
            data: { isActive: false },
          });
        }

        if (modelsWithDeletedAt.includes(model) && modelClient) {
          return modelClient.updateMany({
            where: args.where,
            data: { deletedAt: new Date() },
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
