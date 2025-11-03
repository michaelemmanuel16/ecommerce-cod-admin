import { WorkflowTriggerType } from '@prisma/client';
import { Conditions } from '../utils/conditionEvaluator';

/**
 * Workflow Template Interface
 */
export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  triggerType: WorkflowTriggerType;
  triggerData: any;
  conditions?: Conditions;
  actions: any[];
}

/**
 * Pre-built Workflow Templates
 * These templates can be used to quickly create common workflows
 */
export const workflowTemplates: WorkflowTemplate[] = [
  // Template 1: Assign Orders by Product
  {
    id: 'assign-by-product',
    name: 'Auto-Assign Orders by Product Type',
    description: 'Automatically assign orders to specific sales reps based on the products in the order',
    category: 'Assignment',
    triggerType: 'status_change',
    triggerData: {
      status: 'confirmed'
    },
    actions: [
      {
        type: 'assign_user',
        conditions: {
          logic: 'OR',
          rules: [
            {
              field: 'products',
              operator: 'contains',
              value: 'Electronics'
            },
            {
              field: 'products',
              operator: 'contains',
              value: 'Gadgets'
            }
          ]
        },
        userRole: 'sales_rep',
        targetField: 'customerRepId',
        assignmentMethod: 'round_robin',
        additionalFilters: {
          // You can add user tags or other filters here
          // For example: { tags: { has: 'electronics-specialist' } }
        },
        elseBranch: [
          {
            type: 'assign_user',
            userRole: 'sales_rep',
            targetField: 'customerRepId',
            assignmentMethod: 'round_robin'
          }
        ]
      }
    ]
  },

  // Template 2: High-Value Order Alert
  {
    id: 'high-value-alert',
    name: 'High-Value Order Notification',
    description: 'Send alerts to manager when order value exceeds threshold and set high priority',
    category: 'Notification',
    triggerType: 'status_change',
    triggerData: {
      status: 'confirmed'
    },
    conditions: {
      logic: 'AND',
      rules: [
        {
          field: 'totalAmount',
          operator: 'greater_than',
          value: 200
        }
      ]
    },
    actions: [
      {
        type: 'update_order',
        priority: 5
      },
      {
        type: 'add_tag',
        tag: 'high-value'
      },
      {
        type: 'send_email',
        email: 'manager@example.com',
        subject: 'High-Value Order Alert',
        body: 'A high-value order has been confirmed. Order ID: {{orderId}}, Total: ${{totalAmount}}'
      },
      {
        type: 'send_sms',
        phoneNumber: '+1234567890',
        message: 'High-value order alert! Order #{{orderNumber}} - ${{totalAmount}}'
      }
    ]
  },

  // Template 3: Send Confirmation SMS
  {
    id: 'send-confirmation-sms',
    name: 'Customer Order Confirmation SMS',
    description: 'Automatically send SMS to customer when order status changes to confirmed',
    category: 'Communication',
    triggerType: 'status_change',
    triggerData: {
      status: 'confirmed'
    },
    actions: [
      {
        type: 'send_sms',
        phoneNumber: '{{customer.phoneNumber}}',
        message: 'Hello {{customer.firstName}}, your order #{{orderNumber}} has been confirmed! Estimated delivery: {{estimatedDelivery}}. Track at: https://example.com/track/{{orderId}}'
      },
      {
        type: 'add_tag',
        tag: 'confirmation-sent'
      }
    ]
  },

  // Template 4: Auto-Assign by Delivery Area
  {
    id: 'assign-by-area',
    name: 'Auto-Assign Delivery Agent by Area',
    description: 'Automatically assign delivery agents based on the delivery area using round-robin',
    category: 'Assignment',
    triggerType: 'status_change',
    triggerData: {
      status: 'ready_for_pickup'
    },
    actions: [
      {
        type: 'assign_user',
        conditions: {
          logic: 'AND',
          rules: [
            {
              field: 'deliveryArea',
              operator: 'equals',
              value: 'Downtown'
            }
          ]
        },
        userRole: 'delivery_agent',
        targetField: 'deliveryAgentId',
        assignmentMethod: 'round_robin',
        area: 'Downtown',
        elseBranch: [
          {
            type: 'assign_user',
            conditions: {
              logic: 'AND',
              rules: [
                {
                  field: 'deliveryArea',
                  operator: 'equals',
                  value: 'Suburbs'
                }
              ]
            },
            userRole: 'delivery_agent',
            targetField: 'deliveryAgentId',
            assignmentMethod: 'round_robin',
            area: 'Suburbs',
            elseBranch: [
              {
                type: 'assign_user',
                userRole: 'delivery_agent',
                targetField: 'deliveryAgentId',
                assignmentMethod: 'round_robin',
                area: 'Other'
              }
            ]
          }
        ]
      },
      {
        type: 'send_sms',
        phoneNumber: '{{deliveryAgent.phoneNumber}}',
        message: 'New delivery assigned! Order #{{orderNumber}} in {{deliveryArea}}. Address: {{deliveryAddress}}'
      }
    ]
  },

  // Template 5: VIP Customer Priority
  {
    id: 'vip-customer-priority',
    name: 'VIP Customer Priority Handling',
    description: 'Set high priority and assign best sales rep for customers with high order history',
    category: 'Customer Management',
    triggerType: 'status_change',
    triggerData: {
      status: 'pending_confirmation'
    },
    conditions: {
      logic: 'OR',
      rules: [
        {
          field: 'customer.totalOrders',
          operator: 'greater_than',
          value: 10
        },
        {
          field: 'customer.totalSpent',
          operator: 'greater_than',
          value: 1000
        }
      ]
    },
    actions: [
      {
        type: 'update_order',
        priority: 10
      },
      {
        type: 'add_tag',
        tag: 'vip-customer'
      },
      {
        type: 'assign_user',
        userRole: 'sales_rep',
        targetField: 'customerRepId',
        assignmentMethod: 'weighted',
        weights: {
          // These would be actual user IDs in production
          // Higher weights for senior/experienced reps
          'user-id-1': 0.4,
          'user-id-2': 0.3,
          'user-id-3': 0.2,
          'user-id-4': 0.1
        }
      },
      {
        type: 'send_email',
        email: '{{customerRep.email}}',
        subject: 'VIP Customer Order Assignment',
        body: 'You have been assigned a VIP customer order. Customer: {{customer.firstName}} {{customer.lastName}}, Total Orders: {{customer.totalOrders}}, Order #{{orderNumber}}'
      }
    ]
  },

  // Template 6: Failed Delivery Follow-up
  {
    id: 'failed-delivery-followup',
    name: 'Failed Delivery Follow-up',
    description: 'Send SMS and email to customer when delivery fails and schedule retry',
    category: 'Delivery Management',
    triggerType: 'status_change',
    triggerData: {
      status: 'failed_delivery'
    },
    actions: [
      {
        type: 'send_sms',
        phoneNumber: '{{customer.phoneNumber}}',
        message: 'We attempted to deliver your order #{{orderNumber}} but were unsuccessful. Please call us at 1-800-DELIVERY to reschedule.'
      },
      {
        type: 'send_email',
        email: '{{customer.email}}',
        subject: 'Delivery Attempt Failed - Order #{{orderNumber}}',
        body: 'Hello {{customer.firstName}},\n\nWe attempted to deliver your order but were unable to complete the delivery. Please contact us to arrange a new delivery time.\n\nOrder: {{orderNumber}}\nDelivery Address: {{deliveryAddress}}'
      },
      {
        type: 'add_tag',
        tag: 'failed-delivery'
      },
      {
        type: 'update_order',
        priority: 8
      }
    ]
  },

  // Template 7: Out for Delivery Notification
  {
    id: 'out-for-delivery-notification',
    name: 'Out for Delivery Customer Notification',
    description: 'Notify customer when their order is out for delivery with agent details',
    category: 'Communication',
    triggerType: 'status_change',
    triggerData: {
      status: 'out_for_delivery'
    },
    actions: [
      {
        type: 'send_sms',
        phoneNumber: '{{customer.phoneNumber}}',
        message: 'Great news! Your order #{{orderNumber}} is out for delivery. Our agent {{deliveryAgent.firstName}} will arrive soon. Track: https://example.com/track/{{orderId}}'
      },
      {
        type: 'send_email',
        email: '{{customer.email}}',
        subject: 'Your Order is Out for Delivery!',
        body: 'Hello {{customer.firstName}},\n\nYour order #{{orderNumber}} is now out for delivery!\n\nDelivery Agent: {{deliveryAgent.firstName}} {{deliveryAgent.lastName}}\nAgent Phone: {{deliveryAgent.phoneNumber}}\nEstimated Delivery: {{estimatedDelivery}}\n\nPlease ensure someone is available to receive the package.'
      }
    ]
  },

  // Template 8: Low Stock Alert
  {
    id: 'low-stock-alert',
    name: 'Low Stock Alert Workflow',
    description: 'Alert inventory manager when products in order are low on stock',
    category: 'Inventory',
    triggerType: 'status_change',
    triggerData: {
      status: 'preparing'
    },
    actions: [
      {
        type: 'send_email',
        conditions: {
          logic: 'AND',
          rules: [
            {
              field: 'hasLowStockItems',
              operator: 'equals',
              value: true
            }
          ]
        },
        email: 'inventory@example.com',
        subject: 'Low Stock Alert - Order #{{orderNumber}}',
        body: 'Order #{{orderNumber}} contains items that are low in stock. Please review inventory levels.'
      }
    ]
  },

  // Template 9: Collect Payment Reminder
  {
    id: 'collect-payment-reminder',
    name: 'COD Payment Collection Reminder',
    description: 'Remind delivery agent to collect COD payment and verify amount',
    category: 'Financial',
    triggerType: 'status_change',
    triggerData: {
      status: 'out_for_delivery'
    },
    conditions: {
      logic: 'AND',
      rules: [
        {
          field: 'paymentStatus',
          operator: 'equals',
          value: 'pending'
        },
        {
          field: 'codAmount',
          operator: 'is_not_empty'
        }
      ]
    },
    actions: [
      {
        type: 'send_sms',
        phoneNumber: '{{deliveryAgent.phoneNumber}}',
        message: 'REMINDER: Order #{{orderNumber}} - Collect COD payment of ${{codAmount}} from customer. Confirm collection in app.'
      },
      {
        type: 'add_tag',
        tag: 'cod-pending'
      }
    ]
  },

  // Template 10: Weekend Order Handling
  {
    id: 'weekend-order-handling',
    name: 'Weekend Order Special Handling',
    description: 'Set priority and notify team for orders placed on weekends',
    category: 'Operations',
    triggerType: 'manual',
    triggerData: {},
    actions: [
      {
        type: 'update_order',
        priority: 3
      },
      {
        type: 'add_tag',
        tag: 'weekend-order'
      },
      {
        type: 'send_email',
        email: 'operations@example.com',
        subject: 'Weekend Order Received',
        body: 'Order #{{orderNumber}} was placed during the weekend. Priority has been adjusted for Monday processing.'
      }
    ]
  }
];

/**
 * Get workflow template by ID
 *
 * @param templateId - Template ID
 * @returns Workflow template or undefined
 */
export function getTemplateById(templateId: string): WorkflowTemplate | undefined {
  return workflowTemplates.find(t => t.id === templateId);
}

/**
 * Get workflow templates by category
 *
 * @param category - Template category
 * @returns Array of workflow templates
 */
export function getTemplatesByCategory(category: string): WorkflowTemplate[] {
  return workflowTemplates.filter(t => t.category === category);
}

/**
 * Get all template categories
 *
 * @returns Array of unique categories
 */
export function getTemplateCategories(): string[] {
  const categories = workflowTemplates.map(t => t.category);
  return Array.from(new Set(categories));
}

/**
 * Get all templates
 *
 * @returns Array of all workflow templates
 */
export function getAllTemplates(): WorkflowTemplate[] {
  return workflowTemplates;
}
