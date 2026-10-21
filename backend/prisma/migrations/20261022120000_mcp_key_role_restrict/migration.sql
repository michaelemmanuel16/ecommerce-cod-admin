-- A role that an MCP key uses cannot be deleted: deleting it used to null the key's role and widen the key.
ALTER TABLE "mcp_api_keys" DROP CONSTRAINT "mcp_api_keys_role_id_fkey";
ALTER TABLE "mcp_api_keys" ADD CONSTRAINT "mcp_api_keys_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
