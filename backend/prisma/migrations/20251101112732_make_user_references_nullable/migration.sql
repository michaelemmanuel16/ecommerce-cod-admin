-- DropForeignKey
ALTER TABLE "deliveries" DROP CONSTRAINT "deliveries_agent_id_fkey";

-- DropForeignKey
ALTER TABLE "expenses" DROP CONSTRAINT "expenses_recorded_by_fkey";

-- AlterTable
ALTER TABLE "deliveries" ALTER COLUMN "agent_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "expenses" ALTER COLUMN "recorded_by" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
