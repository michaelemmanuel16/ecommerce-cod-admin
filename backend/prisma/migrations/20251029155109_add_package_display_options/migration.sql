-- AlterTable
ALTER TABLE "form_packages" ADD COLUMN     "highlight_text" TEXT,
ADD COLUMN     "show_discount" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "show_highlight" BOOLEAN NOT NULL DEFAULT false;
