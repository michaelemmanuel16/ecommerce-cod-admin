-- CreateEnum
CREATE TYPE "DepositStatus" AS ENUM ('pending', 'verified', 'rejected');

-- CreateTable
CREATE TABLE "agent_balances" (
    "id" SERIAL NOT NULL,
    "agent_id" INTEGER NOT NULL,
    "total_collected" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "total_deposited" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "current_balance" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "last_settlement_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_deposits" (
    "id" SERIAL NOT NULL,
    "agent_id" INTEGER NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "status" "DepositStatus" NOT NULL DEFAULT 'pending',
    "deposit_date" TIMESTAMP(3) NOT NULL,
    "reference_number" TEXT,
    "verified_at" TIMESTAMP(3),
    "verified_by_id" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_deposits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_balances_agent_id_key" ON "agent_balances"("agent_id");

-- CreateIndex
CREATE INDEX "agent_deposits_agent_id_idx" ON "agent_deposits"("agent_id");

-- CreateIndex
CREATE INDEX "agent_deposits_status_idx" ON "agent_deposits"("status");

-- AddForeignKey
ALTER TABLE "agent_balances" ADD CONSTRAINT "agent_balances_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_deposits" ADD CONSTRAINT "agent_deposits_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_deposits" ADD CONSTRAINT "agent_deposits_verified_by_id_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
