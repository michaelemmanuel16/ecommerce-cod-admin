-- CreateTable
CREATE TABLE "agent_aging_buckets" (
    "id" SERIAL NOT NULL,
    "agent_id" INTEGER NOT NULL,
    "bucket_0_1" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "bucket_2_3" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "bucket_4_7" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "bucket_8_plus" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "total_balance" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "oldest_collection_date" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_aging_buckets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_aging_buckets_agent_id_key" ON "agent_aging_buckets"("agent_id");

-- AddForeignKey
ALTER TABLE "agent_aging_buckets" ADD CONSTRAINT "agent_aging_buckets_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
