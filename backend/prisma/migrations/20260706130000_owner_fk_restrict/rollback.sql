-- MAN-87 rollback — restore tenants.owner_user_id FK to ON DELETE SET NULL.
-- Pair with reverting schema.prisma ownerUser relation to onDelete: SetNull.
-- Safe to run standalone; reverses 20260706130000_owner_fk_restrict exactly.

ALTER TABLE "tenants" DROP CONSTRAINT "tenants_owner_user_id_fkey";

ALTER TABLE "tenants" ADD CONSTRAINT "tenants_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
