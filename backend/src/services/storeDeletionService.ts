import { Prisma } from '@prisma/client';

/**
 * Permanently delete one store (tenant) and all of its tenant-scoped data inside
 * an existing transaction. Raw parameterized SQL in dependency order, bypassing
 * the Prisma soft-delete/tenant extensions.
 *
 * IMPORTANT (multi-store): this deletes STAFF users (users.tenant_id = tenantId)
 * but NOT the owner — a multi-store owner's user.tenant_id is null, so they
 * survive a single-store delete and keep their other stores. delete-account
 * removes the owner separately, last (see deleteOwnerReferences).
 */
export async function deleteStoreData(tx: Prisma.TransactionClient, tenantId: string): Promise<void> {
  // 1. Delete records that reference users via RESTRICT FKs
  await tx.$executeRaw`DELETE FROM notifications WHERE user_id IN (SELECT id FROM users WHERE tenant_id = ${tenantId})`;
  await tx.$executeRaw`DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE tenant_id = ${tenantId})`;
  await tx.$executeRaw`DELETE FROM payouts WHERE rep_id IN (SELECT id FROM users WHERE tenant_id = ${tenantId})`;
  await tx.$executeRaw`DELETE FROM calls WHERE sales_rep_id IN (SELECT id FROM users WHERE tenant_id = ${tenantId})`;
  await tx.$executeRaw`DELETE FROM agent_deposits WHERE agent_id IN (SELECT id FROM users WHERE tenant_id = ${tenantId})`;
  await tx.$executeRaw`DELETE FROM agent_collections WHERE agent_id IN (SELECT id FROM users WHERE tenant_id = ${tenantId})`;
  await tx.$executeRaw`DELETE FROM agent_aging_buckets WHERE agent_id IN (SELECT id FROM users WHERE tenant_id = ${tenantId})`;
  await tx.$executeRaw`DELETE FROM agent_balances WHERE agent_id IN (SELECT id FROM users WHERE tenant_id = ${tenantId})`;
  await tx.$executeRaw`DELETE FROM agent_stock WHERE agent_id IN (SELECT id FROM users WHERE tenant_id = ${tenantId})`;

  // 2. NULL out user FK columns on tenant-scoped tables (RESTRICT FKs on user
  //    columns would otherwise block the tenant cascade)
  await tx.$executeRaw`UPDATE orders SET created_by_id = NULL, customer_rep_id = NULL, delivery_agent_id = NULL WHERE tenant_id = ${tenantId}`;
  await tx.$executeRaw`UPDATE deliveries SET agent_id = NULL WHERE tenant_id = ${tenantId}`;
  await tx.$executeRaw`UPDATE inventory_shipments SET created_by_id = NULL WHERE tenant_id = ${tenantId}`;
  await tx.$executeRaw`UPDATE inventory_transfers SET from_agent_id = NULL, to_agent_id = NULL, created_by_id = NULL WHERE tenant_id = ${tenantId}`;
  await tx.$executeRaw`UPDATE journal_entries SET created_by = NULL, voided_by = NULL WHERE tenant_id = ${tenantId}`;

  // 3. Delete remaining tenant-scoped data in dependency order
  await tx.$executeRaw`DELETE FROM form_submissions WHERE form_id IN (SELECT id FROM checkout_forms WHERE tenant_id = ${tenantId})`;
  await tx.$executeRaw`DELETE FROM inventory_transfers WHERE tenant_id = ${tenantId}`;
  await tx.$executeRaw`DELETE FROM inventory_shipments WHERE tenant_id = ${tenantId}`;
  await tx.$executeRaw`DELETE FROM account_transactions WHERE tenant_id = ${tenantId}`;
  await tx.$executeRaw`DELETE FROM journal_entries WHERE tenant_id = ${tenantId}`;
  await tx.$executeRaw`DELETE FROM system_config WHERE tenant_id = ${tenantId}`;

  // 4. Release the owner ref (RESTRICT), delete staff users, then the tenant.
  //    Deleting the tenant CASCADEs remaining tenant_id FKs (orders, customers,
  //    store_memberships, etc.).
  await tx.$executeRaw`UPDATE tenants SET owner_user_id = NULL WHERE id = ${tenantId}`;
  await tx.$executeRaw`DELETE FROM users WHERE tenant_id = ${tenantId}`;
  await tx.$executeRaw`DELETE FROM tenants WHERE id = ${tenantId}`;
}

/**
 * Delete the owner's own user row LAST, after all their stores are gone. Clears
 * the RESTRICT-referencing rows the owner may hold (notifications, audit logs,
 * memberships) first. Owners are not agents/reps, but we clear those refs too so
 * the delete can never be blocked.
 */
export async function deleteOwnerReferences(tx: Prisma.TransactionClient, ownerId: number): Promise<void> {
  await tx.$executeRaw`DELETE FROM notifications WHERE user_id = ${ownerId}`;
  await tx.$executeRaw`DELETE FROM audit_logs WHERE user_id = ${ownerId}`;
  await tx.$executeRaw`DELETE FROM payouts WHERE rep_id = ${ownerId}`;
  await tx.$executeRaw`DELETE FROM calls WHERE sales_rep_id = ${ownerId}`;
  await tx.$executeRaw`DELETE FROM store_memberships WHERE user_id = ${ownerId}`;
  await tx.$executeRaw`DELETE FROM users WHERE id = ${ownerId}`;
}
