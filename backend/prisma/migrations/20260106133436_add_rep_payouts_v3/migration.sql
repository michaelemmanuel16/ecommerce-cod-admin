-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "commission_paid" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "payout_id" INTEGER;

-- CreateTable
CREATE TABLE "payouts" (
    "id" SERIAL NOT NULL,
    "rep_id" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "payout_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payouts_rep_id_idx" ON "payouts"("rep_id");

-- CreateIndex
CREATE INDEX "payouts_payout_date_idx" ON "payouts"("payout_date");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_rep_id_fkey" FOREIGN KEY ("rep_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
