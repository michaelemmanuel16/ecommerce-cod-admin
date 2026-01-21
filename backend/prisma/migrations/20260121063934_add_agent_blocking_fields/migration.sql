-- AlterTable
ALTER TABLE "agent_balances" ADD COLUMN     "block_reason" TEXT,
ADD COLUMN     "blocked_at" TIMESTAMP(3),
ADD COLUMN     "blocked_by_id" INTEGER,
ADD COLUMN     "is_blocked" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "agent_balances" ADD CONSTRAINT "agent_balances_blocked_by_id_fkey" FOREIGN KEY ("blocked_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
