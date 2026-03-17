-- Grant delivery_agent role 'view' permission on calls resource
-- Fixes 403 error on GET /api/calls/order/:orderId for delivery agents
UPDATE "system_config"
SET "role_permissions" = jsonb_set(
  "role_permissions",
  '{delivery_agent,calls}',
  '["view"]'::jsonb
),
"updated_at" = NOW()
WHERE "role_permissions"->'delivery_agent'->'calls' = '[]'::jsonb;
