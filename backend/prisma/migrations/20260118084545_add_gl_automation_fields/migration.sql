-- AlterEnum
ALTER TYPE "JournalSourceType" ADD VALUE 'order_return';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN "gl_journal_entry_id" INTEGER,
ADD COLUMN "revenue_recognized" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "products" ALTER COLUMN "cogs" DROP NOT NULL,
ALTER COLUMN "cogs" SET DATA TYPE DECIMAL(10,2);

-- CreateIndex
CREATE INDEX "orders_revenue_recognized_idx" ON "orders"("revenue_recognized");

-- CreateIndex
CREATE INDEX "orders_gl_journal_entry_id_idx" ON "orders"("gl_journal_entry_id");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_gl_journal_entry_id_fkey" FOREIGN KEY ("gl_journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
