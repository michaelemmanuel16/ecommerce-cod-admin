-- CreateEnum
CREATE TYPE "PartnerDataSource" AS ENUM ('app', 'connector', 'csv');

-- CreateTable
CREATE TABLE "delivery_partner_profiles" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "days_to_pay" INTEGER NOT NULL DEFAULT 0,
    "is_trial" BOOLEAN NOT NULL DEFAULT false,
    "data_source" "PartnerDataSource" NOT NULL DEFAULT 'app',
    "base_town" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenant_id" TEXT NOT NULL,

    CONSTRAINT "delivery_partner_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_attempts" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "partner_user_id" INTEGER NOT NULL,
    "attempted_at" TIMESTAMP(3) NOT NULL,
    "reason" "FailureReason",
    "note" TEXT,
    "tenant_id" TEXT NOT NULL,

    CONSTRAINT "delivery_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "delivery_partner_profiles_user_id_key" ON "delivery_partner_profiles"("user_id");

-- CreateIndex
CREATE INDEX "delivery_partner_profiles_tenant_id_idx" ON "delivery_partner_profiles"("tenant_id");

-- CreateIndex
CREATE INDEX "delivery_attempts_tenant_id_idx" ON "delivery_attempts"("tenant_id");

-- CreateIndex
CREATE INDEX "delivery_attempts_order_id_idx" ON "delivery_attempts"("order_id");

-- CreateIndex
CREATE INDEX "delivery_attempts_partner_user_id_idx" ON "delivery_attempts"("partner_user_id");

-- AddForeignKey
ALTER TABLE "delivery_partner_profiles" ADD CONSTRAINT "delivery_partner_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "delivery_partner_profiles" ADD CONSTRAINT "delivery_partner_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_partner_user_id_fkey" FOREIGN KEY ("partner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
