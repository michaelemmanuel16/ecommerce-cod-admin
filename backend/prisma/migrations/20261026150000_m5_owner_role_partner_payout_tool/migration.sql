-- M5: the Owner role of every existing tenant gets the tool partner_payout_record (new tenants get it from the default roles).
-- Roles keep tool names in a JSON list, with no wildcard. The Legacy MCP (14 tools) role is not touched: an old key never gains a money tool.
-- Safe to run twice: a role that already lists the tool is skipped.
UPDATE "roles"
SET "tools" = "tools" || '["partner_payout_record"]'::jsonb,
    "updated_at" = now()
WHERE "name" = 'Owner'
  AND jsonb_typeof("tools") = 'array'
  AND NOT ("tools" @> '["partner_payout_record"]'::jsonb);
