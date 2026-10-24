import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { resolveTenantId } from '../utils/tenantContext';

/** "Set up own store" (F-652): the one own-store location of a tenant. A tenant that already has one gets 409. */
export async function createOwnStore(actor: { id: number }, input: { name?: unknown; address?: unknown }) {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) throw new AppError('Give the store a name', 400);
  const address = typeof input.address === 'string' && input.address.trim() ? input.address.trim() : null;
  const tenantId = resolveTenantId();

  return prisma.$transaction(async (tx) => {
    if (await tx.stockLocation.findFirst({ where: { type: 'own_store' }, select: { id: true } })) {
      throw new AppError('You already have an own store', 409);
    }
    if (await tx.stockLocation.findFirst({ where: { name }, select: { id: true } })) {
      throw new AppError(`A location called ${name} already exists`, 409);
    }
    const location = await tx.stockLocation.create({ data: { tenantId, type: 'own_store', name, address } });
    await tx.auditLog.create({
      data: {
        tenantId, userId: actor.id, actorKind: 'person', channel: 'app', action: 'create', resource: 'stock_location',
        resourceId: String(location.id), metadata: { type: 'own_store', name },
      },
    });
    return location;
  });
}
