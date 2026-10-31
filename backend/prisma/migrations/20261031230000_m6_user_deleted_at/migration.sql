-- M6-T05 (COD-56): staff soft delete date. Additive; no data change (earlier soft deletes cannot be told from deactivations).

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "deleted_at" TIMESTAMP(3);
