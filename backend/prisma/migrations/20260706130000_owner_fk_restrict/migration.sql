-- MAN-87: upgrade tenants.owner_user_id FK from ON DELETE SET NULL to RESTRICT.
--
-- A User referenced as a store owner can no longer be deleted while the tenant
-- still points at them. Both delete paths (self-serve deleteTenantAccount and
-- platform deleteTenant) now release the ref (owner_user_id = NULL) before
-- deleting the tenant's users, so tenant deletion continues to work.
--
-- Additive + reversible: only the FK's ON DELETE action changes; no data moves.
-- Rollback (see rollback.sql) restores ON DELETE SET NULL.

ALTER TABLE "tenants" DROP CONSTRAINT "tenants_owner_user_id_fkey";

ALTER TABLE "tenants" ADD CONSTRAINT "tenants_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
