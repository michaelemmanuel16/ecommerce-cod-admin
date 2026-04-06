-- DropForeignKey
ALTER TABLE "workflow_executions" DROP CONSTRAINT IF EXISTS "workflow_executions_workflow_id_fkey";

-- AddForeignKey
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;
