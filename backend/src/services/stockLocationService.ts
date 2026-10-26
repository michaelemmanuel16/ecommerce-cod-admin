import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { resolveTenantId } from '../utils/tenantContext';
import { auditService } from './auditService';

/** Active and inactive stock locations, with no figures: what a picker needs. The in-transit system location is left out. */
export function listLocations() {
  return prisma.stockLocation.findMany({
    where: { type: { not: 'in_transit' } },
    select: { id: true, name: true, type: true, isActive: true },
    orderBy: [{ type: 'asc' }, { name: 'asc' }],
  });
}

/**
 * "Set up own store" (F-652). One own store per tenant is a partial unique index (migration 20261024140000_m4_one_own_store),
 * and the name is unique per tenant: both are refused by the database, so two requests at once give one 201 and one 409.
 */
export async function createOwnStore(actor: { id: number }, input: { name?: unknown; address?: unknown }) {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) throw new AppError('Give the store a name', 400);
  const address = typeof input.address === 'string' && input.address.trim() ? input.address.trim() : null;
  const tenantId = resolveTenantId();

  try {
    return await prisma.$transaction(async (tx) => {
      const location = await tx.stockLocation.create({ data: { tenantId, type: 'own_store', name, address } });
      await auditService.record({
        tx, actorId: actor.id, actorKind: 'person', channel: 'app', action: 'create', resource: 'stock_location',
        resourceId: String(location.id), metadata: { type: 'own_store', name },
      });
      return location;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const target = JSON.stringify(error.meta?.target ?? '');
      throw new AppError(target.includes('name') ? `A location called ${name} already exists` : 'You already have an own store', 409);
    }
    throw error;
  }
}
