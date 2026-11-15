-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('open', 'done');

-- CreateEnum
CREATE TYPE "OptOutReason" AS ENUM ('stop_reply', 'unsubscribe_link', 'staff', 'import', 'resubscribe');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('alert', 'reply', 'mention', 'reminder', 'note', 'system');

-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('pending', 'sent', 'cancelled');

-- CreateEnum
CREATE TYPE "WorkflowRunMode" AS ENUM ('live', 'test');

-- CreateEnum
CREATE TYPE "ConnectionEventLevel" AS ENUM ('info', 'warning', 'error');

-- AlterEnum
ALTER TYPE "MessageStatus" ADD VALUE 'replied';

-- AlterTable
ALTER TABLE "message_logs" ADD COLUMN     "conversation_id" INTEGER,
ADD COLUMN     "fallback_of_id" INTEGER,
ADD COLUMN     "in_reply_to_id" INTEGER,
ADD COLUMN     "provider" TEXT,
ADD COLUMN     "replied_at" TIMESTAMP(3),
ADD COLUMN     "retry_of_id" INTEGER;

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "actor_id" INTEGER,
ADD COLUMN     "done_at" TIMESTAMP(3),
ADD COLUMN     "kind" "NotificationKind" NOT NULL DEFAULT 'alert',
ADD COLUMN     "read_at" TIMESTAMP(3),
ADD COLUMN     "snoozed_until" TIMESTAMP(3),
ADD COLUMN     "subject_id" INTEGER,
ADD COLUMN     "subject_type" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "is_test" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "pending_checkouts" ADD COLUMN     "provider_id" INTEGER;

-- AlterTable
ALTER TABLE "webhook_logs" ADD COLUMN     "order_id" INTEGER,
ADD COLUMN     "retry_of_id" INTEGER;

-- AlterTable
ALTER TABLE "workflow_executions" ADD COLUMN     "failed_step_index" INTEGER,
ADD COLUMN     "idempotency_key" TEXT,
ADD COLUMN     "mode" "WorkflowRunMode" NOT NULL DEFAULT 'live',
ADD COLUMN     "order_id" INTEGER,
ADD COLUMN     "resume_at" TIMESTAMP(3),
ADD COLUMN     "steps" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "trigger_source" TEXT;

-- AlterTable
ALTER TABLE "workflows" ADD COLUMN     "last_scheduled_run_at" TIMESTAMP(3),
ADD COLUMN     "webhook_token_hash" TEXT;

-- CreateTable
CREATE TABLE "message_events" (
    "id" SERIAL NOT NULL,
    "message_log_id" INTEGER NOT NULL,
    "status" "MessageStatus" NOT NULL,
    "provider_status" TEXT,
    "failure_reason" TEXT,
    "payload" JSONB,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenant_id" TEXT NOT NULL,

    CONSTRAINT "message_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_message_events" (
    "id" SERIAL NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_message_id" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL,
    "payload" JSONB,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pending_message_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" SERIAL NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "phone" TEXT NOT NULL,
    "customer_id" INTEGER,
    "assigned_to_id" INTEGER,
    "status" "ConversationStatus" NOT NULL DEFAULT 'open',
    "unanswered" BOOLEAN NOT NULL DEFAULT false,
    "last_message_at" TIMESTAMP(3) NOT NULL,
    "last_inbound_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "tenant_id" TEXT NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_templates" (
    "id" SERIAL NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" TEXT,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "variables" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "language" TEXT,
    "category" TEXT,
    "quick_replies" JSONB,
    "meta_template_name" TEXT,
    "meta_status" TEXT,
    "meta_reject_reason" TEXT,
    "legacy_source" TEXT,
    "legacy_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "tenant_id" TEXT NOT NULL,

    CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opt_out_events" (
    "id" SERIAL NOT NULL,
    "customer_id" INTEGER,
    "phone" TEXT,
    "email" TEXT,
    "channel" "MessageChannel" NOT NULL,
    "opted_out" BOOLEAN NOT NULL,
    "reason" "OptOutReason" NOT NULL,
    "actor_id" INTEGER,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenant_id" TEXT NOT NULL,

    CONSTRAINT "opt_out_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminders" (
    "id" SERIAL NOT NULL,
    "created_by_id" INTEGER NOT NULL,
    "assigned_to_id" INTEGER NOT NULL,
    "subject_type" TEXT,
    "subject_id" INTEGER,
    "note" VARCHAR(1000) NOT NULL,
    "due_at" TIMESTAMP(3) NOT NULL,
    "status" "ReminderStatus" NOT NULL DEFAULT 'pending',
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "tenant_id" TEXT NOT NULL,

    CONSTRAINT "reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "threads" (
    "id" SERIAL NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" INTEGER NOT NULL,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenant_id" TEXT NOT NULL,

    CONSTRAINT "threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" SERIAL NOT NULL,
    "thread_id" INTEGER NOT NULL,
    "author_id" INTEGER NOT NULL,
    "parent_id" INTEGER,
    "body" VARCHAR(4000) NOT NULL,
    "mention_ids" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "edited_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenant_id" TEXT NOT NULL,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "thread_reads" (
    "id" SERIAL NOT NULL,
    "thread_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "last_read_at" TIMESTAMP(3) NOT NULL,
    "tenant_id" TEXT NOT NULL,

    CONSTRAINT "thread_reads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "event" TEXT NOT NULL,
    "in_app" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT false,
    "sms" BOOLEAN NOT NULL DEFAULT false,
    "whatsapp" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "tenant_id" TEXT NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_notification_defaults" (
    "id" SERIAL NOT NULL,
    "role" "UserRole" NOT NULL,
    "event" TEXT NOT NULL,
    "in_app" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT false,
    "sms" BOOLEAN NOT NULL DEFAULT false,
    "whatsapp" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "tenant_id" TEXT NOT NULL,

    CONSTRAINT "role_notification_defaults_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_trigger_outbox" (
    "id" SERIAL NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "tenant_id" TEXT NOT NULL,

    CONSTRAINT "workflow_trigger_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connection_events" (
    "id" SERIAL NOT NULL,
    "connection" TEXT NOT NULL,
    "level" "ConnectionEventLevel" NOT NULL,
    "message" TEXT NOT NULL,
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenant_id" TEXT NOT NULL,

    CONSTRAINT "connection_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "message_events_tenant_id_idx" ON "message_events"("tenant_id");

-- CreateIndex
CREATE INDEX "message_events_tenant_id_occurred_at_idx" ON "message_events"("tenant_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "message_events_message_log_id_status_key" ON "message_events"("message_log_id", "status");

-- CreateIndex
CREATE INDEX "pending_message_events_provider_message_id_idx" ON "pending_message_events"("provider_message_id");

-- CreateIndex
CREATE INDEX "pending_message_events_expires_at_idx" ON "pending_message_events"("expires_at");

-- CreateIndex
CREATE INDEX "conversations_tenant_id_idx" ON "conversations"("tenant_id");

-- CreateIndex
CREATE INDEX "conversations_tenant_id_status_last_message_at_idx" ON "conversations"("tenant_id", "status", "last_message_at");

-- CreateIndex
CREATE INDEX "conversations_assigned_to_id_idx" ON "conversations"("assigned_to_id");

-- CreateIndex
CREATE INDEX "conversations_customer_id_idx" ON "conversations"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_tenant_id_channel_phone_key" ON "conversations"("tenant_id", "channel", "phone");

-- CreateIndex
CREATE INDEX "message_templates_tenant_id_idx" ON "message_templates"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_templates_tenant_id_channel_name_key" ON "message_templates"("tenant_id", "channel", "name");

-- CreateIndex
CREATE INDEX "opt_out_events_tenant_id_idx" ON "opt_out_events"("tenant_id");

-- CreateIndex
CREATE INDEX "opt_out_events_tenant_id_phone_idx" ON "opt_out_events"("tenant_id", "phone");

-- CreateIndex
CREATE INDEX "opt_out_events_customer_id_idx" ON "opt_out_events"("customer_id");

-- CreateIndex
CREATE INDEX "reminders_tenant_id_idx" ON "reminders"("tenant_id");

-- CreateIndex
CREATE INDEX "reminders_status_due_at_idx" ON "reminders"("status", "due_at");

-- CreateIndex
CREATE INDEX "reminders_assigned_to_id_status_idx" ON "reminders"("assigned_to_id", "status");

-- CreateIndex
CREATE INDEX "threads_tenant_id_idx" ON "threads"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "threads_tenant_id_subject_type_subject_id_key" ON "threads"("tenant_id", "subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "comments_tenant_id_idx" ON "comments"("tenant_id");

-- CreateIndex
CREATE INDEX "comments_thread_id_created_at_idx" ON "comments"("thread_id", "created_at");

-- CreateIndex
CREATE INDEX "comments_parent_id_idx" ON "comments"("parent_id");

-- CreateIndex
CREATE INDEX "thread_reads_tenant_id_idx" ON "thread_reads"("tenant_id");

-- CreateIndex
CREATE INDEX "thread_reads_user_id_idx" ON "thread_reads"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "thread_reads_thread_id_user_id_key" ON "thread_reads"("thread_id", "user_id");

-- CreateIndex
CREATE INDEX "notification_preferences_tenant_id_idx" ON "notification_preferences"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_user_id_event_key" ON "notification_preferences"("user_id", "event");

-- CreateIndex
CREATE INDEX "role_notification_defaults_tenant_id_idx" ON "role_notification_defaults"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "role_notification_defaults_tenant_id_role_event_key" ON "role_notification_defaults"("tenant_id", "role", "event");

-- CreateIndex
CREATE INDEX "workflow_trigger_outbox_tenant_id_idx" ON "workflow_trigger_outbox"("tenant_id");

-- CreateIndex
CREATE INDEX "workflow_trigger_outbox_processed_at_created_at_idx" ON "workflow_trigger_outbox"("processed_at", "created_at");

-- CreateIndex
CREATE INDEX "connection_events_tenant_id_idx" ON "connection_events"("tenant_id");

-- CreateIndex
CREATE INDEX "connection_events_tenant_id_created_at_idx" ON "connection_events"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "connection_events_tenant_id_connection_level_idx" ON "connection_events"("tenant_id", "connection", "level");

-- CreateIndex
CREATE INDEX "message_logs_conversation_id_idx" ON "message_logs"("conversation_id");

-- CreateIndex
CREATE INDEX "message_logs_in_reply_to_id_idx" ON "message_logs"("in_reply_to_id");

-- CreateIndex
CREATE INDEX "message_logs_fallback_of_id_idx" ON "message_logs"("fallback_of_id");

-- CreateIndex
CREATE INDEX "message_logs_retry_of_id_idx" ON "message_logs"("retry_of_id");

-- CreateIndex
CREATE INDEX "notifications_tenant_id_user_id_done_at_created_at_idx" ON "notifications"("tenant_id", "user_id", "done_at", "created_at");

-- CreateIndex
CREATE INDEX "notifications_actor_id_idx" ON "notifications"("actor_id");

-- CreateIndex
CREATE INDEX "pending_checkouts_provider_id_idx" ON "pending_checkouts"("provider_id");

-- CreateIndex
CREATE INDEX "webhook_logs_retry_of_id_idx" ON "webhook_logs"("retry_of_id");

-- CreateIndex
CREATE INDEX "webhook_logs_order_id_idx" ON "webhook_logs"("order_id");

-- CreateIndex
CREATE INDEX "workflow_executions_order_id_idx" ON "workflow_executions"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_executions_tenant_id_idempotency_key_key" ON "workflow_executions"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "workflows_webhook_token_hash_key" ON "workflows"("webhook_token_hash");

-- AddForeignKey
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_logs" ADD CONSTRAINT "webhook_logs_retry_of_id_fkey" FOREIGN KEY ("retry_of_id") REFERENCES "webhook_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_logs" ADD CONSTRAINT "webhook_logs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_checkouts" ADD CONSTRAINT "pending_checkouts_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "payment_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_logs" ADD CONSTRAINT "message_logs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_logs" ADD CONSTRAINT "message_logs_in_reply_to_id_fkey" FOREIGN KEY ("in_reply_to_id") REFERENCES "message_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_logs" ADD CONSTRAINT "message_logs_fallback_of_id_fkey" FOREIGN KEY ("fallback_of_id") REFERENCES "message_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_logs" ADD CONSTRAINT "message_logs_retry_of_id_fkey" FOREIGN KEY ("retry_of_id") REFERENCES "message_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_events" ADD CONSTRAINT "message_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "message_events" ADD CONSTRAINT "message_events_message_log_id_fkey" FOREIGN KEY ("message_log_id") REFERENCES "message_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "opt_out_events" ADD CONSTRAINT "opt_out_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "opt_out_events" ADD CONSTRAINT "opt_out_events_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opt_out_events" ADD CONSTRAINT "opt_out_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "threads" ADD CONSTRAINT "threads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "comments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thread_reads" ADD CONSTRAINT "thread_reads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "thread_reads" ADD CONSTRAINT "thread_reads_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thread_reads" ADD CONSTRAINT "thread_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_notification_defaults" ADD CONSTRAINT "role_notification_defaults_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "workflow_trigger_outbox" ADD CONSTRAINT "workflow_trigger_outbox_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "connection_events" ADD CONSTRAINT "connection_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;


-- Backfill: Notification inbox fields (M9-T02). Existing rows keep their type; the
-- new kind is 'system' only for system and job alert types, everything else stays 'alert'.
UPDATE "notifications" SET "read_at" = "created_at" WHERE "is_read" = true;

UPDATE "notifications" SET "kind" = 'system'
WHERE "type" IN (
  'meta_ads_token',
  'meta_ads_pull',
  'whatsapp_token_refresh_failed',
  'no_assignee_available',
  'overdue_collections'
);
