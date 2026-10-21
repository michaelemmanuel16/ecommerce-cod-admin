import { describe, it, expect } from '@jest/globals';
import { TOOL_PERMISSIONS } from '../../config/toolPermissions';
import { DEFAULT_ROLES, LEGACY_MCP_ROLE_NAME } from '../../config/defaultRoles';
import { listTools } from '../../tools/registry';
import '../../tools';

describe('TOOL_PERMISSIONS', () => {
  const registered = () => listTools().map((t) => t.name);

  it('has a permission cell for each of the 14 registry tools, and no extras', () => {
    const tools = registered();
    expect(tools).toHaveLength(14);
    expect(Object.keys(TOOL_PERMISSIONS).sort()).toEqual([...tools].sort());
    for (const cell of Object.values(TOOL_PERMISSIONS)) expect(cell).toMatch(/^[a-z_]+:[a-z_]+$/);
  });

  it('default roles are the 7 expected and only list known tools', () => {
    expect(DEFAULT_ROLES.map((r) => r.name)).toEqual([
      'Owner', 'Call rep', 'Delivery', 'Finance clerk', 'Marketing', 'Stock keeper', LEGACY_MCP_ROLE_NAME,
    ]);
    for (const role of DEFAULT_ROLES) {
      for (const tool of role.tools) expect(TOOL_PERMISSIONS).toHaveProperty(tool);
    }
    const legacy = DEFAULT_ROLES.find((r) => r.name === LEGACY_MCP_ROLE_NAME)!;
    expect(legacy.isSystem).toBe(true);
    expect(legacy.tools).toHaveLength(14);
  });
});
