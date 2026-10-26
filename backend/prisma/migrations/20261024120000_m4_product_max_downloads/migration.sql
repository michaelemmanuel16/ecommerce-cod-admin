-- AlterTable: F-601, digital products get a per-product download limit. Null reads as 5 (digitalDeliveryService).
ALTER TABLE "products" ADD COLUMN     "max_downloads" INTEGER;
