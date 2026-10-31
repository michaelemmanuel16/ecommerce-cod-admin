import { ALL_TOOL_NAMES, TOOL_PERMISSIONS } from './toolPermissions';

/**
 * M6-T04 (F-1153): which tool switch needs which. A tool whose cell is not a read (`view`, `export`) is a write tool; it needs
 * at least one tool that reads the same resource (cell `<resource>:view`). A write tool on a resource with no read tool
 * (payouts today) has no dependency. Derived from TOOL_PERMISSIONS, so a new tool follows the rule without an edit here.
 */
const resourceOf = (tool: string): string => TOOL_PERMISSIONS[tool as keyof typeof TOOL_PERMISSIONS].split(':')[0];
const actionOf = (tool: string): string => TOOL_PERMISSIONS[tool as keyof typeof TOOL_PERMISSIONS].split(':')[1];

const isReadTool = (tool: string): boolean => ['view', 'export'].includes(actionOf(tool));
const isViewTool = (tool: string): boolean => actionOf(tool) === 'view';

/** The name the owner sees for the read side of a resource: "View orders". */
const viewLabel = (resource: string): string => `View ${resource}`;

export const isKnownTool = (tool: string): boolean => (ALL_TOOL_NAMES as readonly string[]).includes(tool);

/**
 * The read tools a set of switches lacks, as the labels the owner sees ("View orders"). Empty when every write tool has a
 * read tool on its resource. Names that are not tools are ignored (the caller checks them first).
 */
export function missingReadTools(tools: readonly string[]): string[] {
  const known = tools.filter(isKnownTool);
  const viewed = new Set(known.filter(isViewTool).map(resourceOf));
  const missing = new Set<string>();
  for (const tool of known) {
    if (isReadTool(tool)) continue;
    const resource = resourceOf(tool);
    const hasReadTool = ALL_TOOL_NAMES.some((t) => isViewTool(t) && resourceOf(t) === resource);
    if (hasReadTool && !viewed.has(resource)) missing.add(viewLabel(resource));
  }
  return [...missing];
}
