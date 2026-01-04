-- CreateEnum
CREATE TYPE "CallOutcome" AS ENUM ('confirmed', 'rescheduled', 'no_answer', 'cancelled', 'other');

-- AlterTable
ALTER TABLE "webhook_configs" ALTER COLUMN "unique_url" DROP DEFAULT;

-- CreateTable
CREATE TABLE "calls" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER,
    "customer_id" INTEGER NOT NULL,
    "sales_rep_id" INTEGER NOT NULL,
    "outcome" "CallOutcome" NOT NULL,
    "duration" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "calls_sales_rep_id_idx" ON "calls"("sales_rep_id");

-- CreateIndex
CREATE INDEX "calls_customer_id_idx" ON "calls"("customer_id");

-- CreateIndex
CREATE INDEX "calls_order_id_idx" ON "calls"("order_id");

-- CreateIndex
CREATE INDEX "calls_created_at_idx" ON "calls"("created_at");

-- CreateIndex
CREATE INDEX "calls_sales_rep_id_created_at_idx" ON "calls"("sales_rep_id", "created_at");

-- CreateIndex
CREATE INDEX "calls_outcome_idx" ON "calls"("outcome");

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_sales_rep_id_fkey" FOREIGN KEY ("sales_rep_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
