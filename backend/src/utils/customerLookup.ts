import { Customer } from '@prisma/client';
import type { TransactionClient } from './prisma';
import { withSoftDeleted } from './prismaExtensions';
import logger from './logger';

/**
 * Customer find-or-create, archive-aware.
 *
 * Archiving a customer sets `isActive: false`; the row stays in the table and
 * keeps occupying the `@@unique([phoneNumber, tenantId])` index. The soft-delete
 * extension auto-injects `isActive: true` into every read, so a plain
 * `findFirst({ where: { phoneNumber } })` cannot see archived customers — a
 * find-then-create against an archived phone number finds nothing, creates a
 * duplicate, and dies on the unique constraint with a 500.
 *
 * Every path that turns an inbound phone number into a customer must go through
 * here so an archived record is found rather than re-created.
 */

/**
 * Finds a customer by phone number, archived records included.
 *
 * `db` accepts the extended `prisma` singleton or a `$transaction` client, so
 * callers already inside a transaction stay in it.
 *
 * `tenantId` is only needed on public/unauthenticated paths, where there is no
 * tenant context for the isolation extension to inject; authenticated callers
 * omit it and let the extension scope the query.
 */
export async function findCustomerByPhoneIncludingArchived(
  db: TransactionClient,
  phoneNumber: string,
  tenantId?: string | null
): Promise<Customer | null> {
  return withSoftDeleted(() =>
    db.customer.findFirst({
      where: { phoneNumber, ...(tenantId ? { tenantId } : {}) },
    })
  );
}

/**
 * Finds a customer by phone number and un-archives them if they were archived.
 *
 * Used by the order-intake paths: a new order against an archived phone number
 * means that person is a customer again, so the record is restored rather than
 * left invisible. Returns null when no record exists at all (caller creates one).
 *
 * `context` names the intake path in the reactivation log line.
 */
export async function findAndReactivateCustomerByPhone(
  db: TransactionClient,
  phoneNumber: string,
  context: string,
  tenantId?: string | null
): Promise<Customer | null> {
  const customer = await findCustomerByPhoneIncludingArchived(db, phoneNumber, tenantId);
  // Only an explicit false is archived — never write on an absent/unknown flag.
  if (!customer || customer.isActive !== false) return customer;

  logger.info('Reactivating archived customer for new order', {
    customerId: customer.id,
    phoneNumber: customer.phoneNumber,
    context,
  });

  return db.customer.update({
    where: { id: customer.id },
    data: { isActive: true },
  });
}
