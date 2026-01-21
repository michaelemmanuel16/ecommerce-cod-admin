-- DropForeignKey
ALTER TABLE "agent_aging_buckets" DROP CONSTRAINT "agent_aging_buckets_agent_id_fkey";

-- AddForeignKey
ALTER TABLE "agent_aging_buckets" ADD CONSTRAINT "agent_aging_buckets_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
