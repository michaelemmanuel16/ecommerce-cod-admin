import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Prisma } from '@prisma/client';
import { ToolName } from '../../config/toolPermissions';

/**
 * The schema resources an MCP client can read. They list only the models and fields the tools can return (not the
 * whole database), and take each field's type and each enum's values from the Prisma DMMF, so they cannot drift
 * from the schema. `checkExposedFields` fails the build's tests when a listed field is not in the schema.
 */

interface ExposedModel {
  model: string;
  description: string;
  /** Tools that return rows of this model. */
  tools: ToolName[];
  /** Scalar and enum fields the tools return. */
  fields: string[];
  relationships?: string[];
}

export const EXPOSED_MODELS: Record<string, ExposedModel> = {
  orders: {
    model: 'Order',
    description: 'COD orders with status tracking, delivery assignment and amounts',
    tools: ['orders_search', 'orders_summary', 'orders_update_status', 'deliveries_active'],
    fields: ['id', 'status', 'totalAmount', 'deliveryAddress', 'deliveryState', 'deliveryArea', 'createdAt'],
    relationships: ['customer', 'orderItems', 'deliveryAgent'],
  },
  customers: {
    model: 'Customer',
    description: 'Customer profiles with contact info',
    tools: ['customers_lookup', 'orders_search', 'deliveries_active'],
    fields: ['id', 'firstName', 'lastName', 'phoneNumber', 'alternatePhone', 'address', 'state', 'createdAt'],
  },
  products: {
    model: 'Product',
    description: 'Products with price and stock',
    tools: ['products_inventory'],
    fields: ['id', 'name', 'sku', 'price', 'stockQuantity', 'lowStockThreshold', 'isActive'],
  },
  agents: {
    model: 'User',
    description: 'Delivery agents and sales reps (users with role delivery_agent or sales_rep)',
    tools: ['agents_status', 'agents_performance', 'reps_status', 'reps_performance'],
    fields: ['id', 'firstName', 'lastName', 'phoneNumber'],
  },
  agentBalances: {
    model: 'AgentBalance',
    description: 'Cash a delivery agent holds: collected, deposited and still owed',
    tools: ['agents_status', 'financial_summary'],
    fields: ['agentId', 'currentBalance', 'totalCollected', 'totalDeposited'],
  },
};

const modelsOf = () => Prisma.dmmf.datamodel.models;

/** The field of a model in the DMMF, or undefined when the model or the field does not exist. */
function findField(models: readonly Prisma.DMMF.Model[], model: string, name: string) {
  return models.find((m) => m.name === model)?.fields.find((f) => f.name === name);
}

/** Each listed field that is not a scalar or enum field of its model, as "Model.field". Empty when all are real. */
export function checkExposedFields(
  exposed: Record<string, Pick<ExposedModel, 'model' | 'fields'>> = EXPOSED_MODELS,
  models: readonly Prisma.DMMF.Model[] = modelsOf(),
): string[] {
  const missing: string[] = [];
  for (const { model, fields } of Object.values(exposed)) {
    for (const name of fields) {
      const kind = findField(models, model, name)?.kind;
      if (kind !== 'scalar' && kind !== 'enum') missing.push(`${model}.${name}`);
    }
  }
  return missing;
}

const bodies = new Map<string, ReturnType<typeof buildBody>>();

function buildBody(key: string) {
  const entry = EXPOSED_MODELS[key];
  const models = modelsOf();
  return {
    model: entry.model,
    description: entry.description,
    returnedBy: entry.tools,
    fields: entry.fields.flatMap((name) => {
      const f = findField(models, entry.model, name);
      if (!f) return []; // checkExposedFields fails a test before this can happen
      const values = f.kind === 'enum' ? Prisma.dmmf.datamodel.enums.find((e) => e.name === f.type)?.values.map((v) => v.name) : undefined;
      return [{ name, type: `${f.type}${f.isRequired ? '' : '?'}`, ...(values && { values }) }];
    }),
    ...(entry.relationships && { relationships: entry.relationships }),
  };
}

/** The resource body for one entry: fields with their schema type, enum values where a field is an enum. Built on first use. */
export function buildSchemaResource(key: string) {
  let body = bodies.get(key);
  if (!body) {
    body = buildBody(key);
    bodies.set(key, body);
  }
  return body;
}

export function registerResources(server: McpServer) {
  for (const key of Object.keys(EXPOSED_MODELS)) {
    server.resource(
      `schema-${key}`,
      `schema://${key}`,
      { mimeType: 'application/json', description: `Data model documentation for ${key}` },
      async () => ({
        contents: [{
          uri: `schema://${key}`,
          mimeType: 'application/json',
          text: JSON.stringify(buildSchemaResource(key), null, 2),
        }],
      }),
    );
  }
}
