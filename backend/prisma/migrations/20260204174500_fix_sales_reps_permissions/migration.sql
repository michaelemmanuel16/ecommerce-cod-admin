-- Create SystemConfig if it doesn't exist
INSERT INTO "system_config" ("business_name", "role_permissions", "created_at", "updated_at")
SELECT 'COD Admin', '{
    "super_admin": {
        "users": ["create", "view", "update", "delete"],
        "orders": ["create", "view", "update", "delete", "bulk_import", "assign"],
        "customers": ["create", "view", "update", "delete"],
        "products": ["create", "view", "update", "delete", "update_stock"],
        "financial": ["view", "create", "update", "delete"],
        "analytics": ["view"],
        "workflows": ["create", "view", "update", "delete", "execute"],
        "settings": ["view", "update"],
        "calls": ["create", "view", "update", "delete"],
        "gl": ["create", "view", "update", "delete"]
    },
    "admin": {
        "users": ["create", "view", "update", "delete"],
        "orders": ["create", "view", "update", "delete", "bulk_import", "assign"],
        "customers": ["create", "view", "update", "delete"],
        "products": ["create", "view", "update", "delete"],
        "financial": ["view", "create"],
        "analytics": ["view"],
        "workflows": ["create", "view", "update", "delete", "execute"],
        "settings": ["view"],
        "calls": ["create", "view", "update", "delete"],
        "gl": ["create", "view", "update", "delete"]
    },
    "manager": {
        "users": [],
        "orders": ["view", "update", "bulk_import", "assign"],
        "customers": ["create", "view", "update", "delete"],
        "products": ["view"],
        "financial": ["view"],
        "analytics": ["view"],
        "workflows": ["view", "execute"],
        "settings": [],
        "calls": ["view"],
        "gl": ["view"]
    },
    "sales_rep": {
        "users": [],
        "orders": ["create", "view", "update"],
        "customers": ["create", "view", "update", "delete"],
        "products": ["view"],
        "financial": [],
        "analytics": ["view"],
        "workflows": [],
        "settings": [],
        "calls": ["create", "view"],
        "gl": []
    },
    "inventory_manager": {
        "users": [],
        "orders": ["view"],
        "customers": ["view"],
        "products": ["create", "view", "update", "delete", "update_stock"],
        "financial": [],
        "analytics": ["view"],
        "workflows": [],
        "settings": [],
        "calls": [],
        "gl": []
    },
    "delivery_agent": {
        "users": [],
        "orders": ["view", "update"],
        "customers": ["view"],
        "products": ["view"],
        "financial": ["create"],
        "analytics": ["view"],
        "workflows": [],
        "settings": [],
        "calls": [],
        "gl": []
    },
    "accountant": {
        "users": [],
        "orders": ["view"],
        "customers": ["view"],
        "products": ["view"],
        "financial": ["view", "create"],
        "analytics": ["view"],
        "workflows": [],
        "calls": [],
        "settings": [],
        "gl": ["create", "view", "update"]
    }
}'::jsonb, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "system_config");

-- Update role_permissions if SystemConfig already exists
UPDATE "system_config"
SET "role_permissions" = '{
    "super_admin": {
        "users": ["create", "view", "update", "delete"],
        "orders": ["create", "view", "update", "delete", "bulk_import", "assign"],
        "customers": ["create", "view", "update", "delete"],
        "products": ["create", "view", "update", "delete", "update_stock"],
        "financial": ["view", "create", "update", "delete"],
        "analytics": ["view"],
        "workflows": ["create", "view", "update", "delete", "execute"],
        "settings": ["view", "update"],
        "calls": ["create", "view", "update", "delete"],
        "gl": ["create", "view", "update", "delete"]
    },
    "admin": {
        "users": ["create", "view", "update", "delete"],
        "orders": ["create", "view", "update", "delete", "bulk_import", "assign"],
        "customers": ["create", "view", "update", "delete"],
        "products": ["create", "view", "update", "delete"],
        "financial": ["view", "create"],
        "analytics": ["view"],
        "workflows": ["create", "view", "update", "delete", "execute"],
        "settings": ["view"],
        "calls": ["create", "view", "update", "delete"],
        "gl": ["create", "view", "update", "delete"]
    },
    "manager": {
        "users": [],
        "orders": ["view", "update", "bulk_import", "assign"],
        "customers": ["create", "view", "update", "delete"],
        "products": ["view"],
        "financial": ["view"],
        "analytics": ["view"],
        "workflows": ["view", "execute"],
        "settings": [],
        "calls": ["view"],
        "gl": ["view"]
    },
    "sales_rep": {
        "users": [],
        "orders": ["create", "view", "update"],
        "customers": ["create", "view", "update", "delete"],
        "products": ["view"],
        "financial": [],
        "analytics": ["view"],
        "workflows": [],
        "settings": [],
        "calls": ["create", "view"],
        "gl": []
    },
    "inventory_manager": {
        "users": [],
        "orders": ["view"],
        "customers": ["view"],
        "products": ["create", "view", "update", "delete", "update_stock"],
        "financial": [],
        "analytics": ["view"],
        "workflows": [],
        "settings": [],
        "calls": [],
        "gl": []
    },
    "delivery_agent": {
        "users": [],
        "orders": ["view", "update"],
        "customers": ["view"],
        "products": ["view"],
        "financial": ["create"],
        "analytics": ["view"],
        "workflows": [],
        "settings": [],
        "calls": [],
        "gl": []
    },
    "accountant": {
        "users": [],
        "orders": ["view"],
        "customers": ["view"],
        "products": ["view"],
        "financial": ["view", "create"],
        "analytics": ["view"],
        "workflows": [],
        "calls": [],
        "settings": [],
        "gl": ["create", "view", "update"]
    }
}'::jsonb, "updated_at" = NOW();
