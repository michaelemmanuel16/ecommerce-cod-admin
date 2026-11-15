-- M9-T25 (COD-81): data only, no schema change.
-- The editor no longer offers `assign_agent` and `add_tag`; the code refuses them on save.
--   assign_agent -> assign_to, role delivery_agent, split even, the same user list (config.agentIds, or config.agentId)
--   add_tag      -> update_order with a note "Tag: <tag>" (update_order has no tags field: it sets status, priority and notes)
-- Every other action and the order of the actions stay. The number of workflows does not change.
-- The enum values stay in the schema (WorkflowActionType); the schema is not touched here.
UPDATE "workflows" w
SET "actions" = (
  SELECT COALESCE(jsonb_agg(
    CASE a.elem->>'type'
      WHEN 'assign_agent' THEN jsonb_build_object(
        'type', 'assign_to',
        'config', jsonb_build_object(
          'role', 'delivery_agent',
          'split', 'even',
          'userIds', CASE
            WHEN jsonb_typeof(a.elem->'config'->'agentIds') = 'array' THEN a.elem->'config'->'agentIds'
            WHEN a.elem->'config'->>'agentId' ~ '^[0-9]+$' THEN jsonb_build_array((a.elem->'config'->>'agentId')::int)
            ELSE '[]'::jsonb
          END
        )
      )
      WHEN 'add_tag' THEN jsonb_build_object(
        'type', 'update_order',
        'config', jsonb_build_object('notes', 'Tag: ' || COALESCE(NULLIF(a.elem->'config'->>'tag', ''), NULLIF(a.elem->>'tag', ''), 'tagged'))
      )
      ELSE a.elem
    END
    ORDER BY a.ord
  ), '[]'::jsonb)
  FROM jsonb_array_elements(w."actions"::jsonb) WITH ORDINALITY AS a(elem, ord)
)
WHERE jsonb_typeof(w."actions"::jsonb) = 'array'
  AND (w."actions"::text LIKE '%"assign_agent"%' OR w."actions"::text LIKE '%"add_tag"%');
