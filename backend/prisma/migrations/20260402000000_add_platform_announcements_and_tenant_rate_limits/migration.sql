-- AlterTable
ALTER TABLE "tenants" ADD COLUMN "rate_limit_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "rate_limit_config" JSONB;

-- CreateTable
CREATE TABLE "platform_announcements" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'info',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "expires_at" TIMESTAMP(3),
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_announcements_pkey" PRIMARY KEY ("id")
);
