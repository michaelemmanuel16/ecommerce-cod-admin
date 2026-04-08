import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const SCHEMA_RESOURCES = {
  orders: {
    model: 'Order',
    description: 'COD orders with status tracking, delivery assignment, and financial info',
    fields: [
      { name: 'id', type: 'Int', description: 'Unique order ID' },
      { name: 'status', type: 'OrderStatus', description: 'Current order status', enum: [
        'pending_confirmation', 'payment_pending', 'confirmed', 'preparing',
        'ready_for_pickup', 'out_for_delivery', 'delivered', 'digital_delivered',
        'cancelled', 'returned', 'failed_delivery', 'payment_failed',
      ]},
      { name: 'totalAmount', type: 'Decimal', description: 'Total order amount' },
      { name: 'deliveryFee', type: 'Decimal', description: 'Delivery fee' },
      { name: 'deliveryArea', type: 'String', description: 'Delivery area/city' },
      { name: 'deliveryAddress', type: 'String', description: 'Full delivery address' },
      { name: 'notes', type: 'String?', description: 'Order notes' },
      { name: 'createdAt', type: 'DateTime', description: 'When order was placed' },
    ],
    relationships: ['customer', 'orderItems', 'deliveryAgent', 'customerRep'],
    statusFlow: 'pending_confirmation → confirmed → preparing → ready_for_pickup → out_for_delivery → delivered. Can branch to: cancelled, returned, failed_delivery',
  },
  customers: {
    model: 'Customer',
    description: 'Customer profiles with contact info and order history',
    fields: [
      { name: 'id', type: 'Int', description: 'Unique customer ID' },
      { name: 'firstName', type: 'String', description: 'First name' },
      { name: 'lastName', type: 'String', description: 'Last name' },
      { name: 'phoneNumber', type: 'String', description: 'Phone number (unique per tenant)' },
      { name: 'alternatePhone', type: 'String?', description: 'Alternate phone' },
      { name: 'state', type: 'String', description: 'State/region' },
      { name: 'area', type: 'String?', description: 'Area/neighborhood' },
      { name: 'address', type: 'String?', description: 'Full address' },
    ],
    relationships: ['orders', 'messageLogs'],
  },
  agents: {
    model: 'User (role=delivery_agent)',
    description: 'Delivery agents who fulfill orders. Agents have balances, stock, and performance metrics.',
    fields: [
      { name: 'id', type: 'Int', description: 'User ID' },
      { name: 'firstName', type: 'String', description: 'First name' },
      { name: 'lastName', type: 'String', description: 'Last name' },
      { name: 'phoneNumber', type: 'String?', description: 'Phone number' },
      { name: 'role', type: 'String', description: 'Always delivery_agent' },
      { name: 'isActive', type: 'Boolean', description: 'Whether agent is active' },
    ],
    relationships: ['assignedOrders', 'agentBalance', 'agentStocks'],
    relatedModels: {
      AgentBalance: 'Tracks cash in hand, total collected, total deposited',
      AgentStock: 'Tracks product inventory assigned to the agent',
    },
  },
};

export function registerResources(server: McpServer) {
  for (const [key, schema] of Object.entries(SCHEMA_RESOURCES)) {
    server.resource(
      `schema-${key}`,
      `schema://${key}`,
      { mimeType: 'application/json', description: `Data model documentation for ${key}` },
      async () => ({
        contents: [{
          uri: `schema://${key}`,
          mimeType: 'application/json',
          text: JSON.stringify(schema, null, 2),
        }],
      }),
    );
  }
}
