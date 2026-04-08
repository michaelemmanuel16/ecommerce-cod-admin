-- DropIndex (redundant: @unique on keyHash already creates an index)
DROP INDEX IF EXISTS "mcp_api_keys_key_hash_idx";
