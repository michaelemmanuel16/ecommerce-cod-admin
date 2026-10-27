/**
 * Importing this file registers the 15 tools (each area file calls registerToolDef).
 * Only files in src/tools/ may register a tool.
 */
import './orders';
import './customers';
import './products';
import './deliveries';
import './analytics';
import './financial';
import './agents';
import './reps';
import './partnerPayout';

export { getTool, listTools, runTool, REGISTRY_VERSION } from './registry';
