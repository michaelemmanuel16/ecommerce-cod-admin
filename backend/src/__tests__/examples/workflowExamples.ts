/**
 * Workflow System Usage Examples
 *
 * This file demonstrates how to use the new workflow system components.
 * Not intended to be run as actual tests, but as documentation and examples.
 */

import assignmentService from '../../services/assignmentService';
import { evaluateConditions, createSimpleCondition, createAndCondition } from '../../utils/conditionEvaluator';
import { getTemplateById, getAllTemplates } from '../../data/workflowTemplates';
import workflowService from '../../services/workflowService';

// ============================================================================
// Example 1: Assignment Service - Round-Robin
// ============================================================================

async function exampleRoundRobinAssignment() {
  console.log('Example 1: Round-Robin Assignment');

  // Get delivery agents for Downtown area
  const agents = await assignmentService.getUsersByRole('delivery_agent');

  // Select agents in round-robin fashion
  const agent1 = assignmentService.selectUserRoundRobin(agents, 'downtown_delivery');
  const agent2 = assignmentService.selectUserRoundRobin(agents, 'downtown_delivery');
  const agent3 = assignmentService.selectUserRoundRobin(agents, 'downtown_delivery');

  console.log('Selected agents:', [
    agent1?.firstName,
    agent2?.firstName,
    agent3?.firstName
  ]);

  // Different context = different round-robin cycle
  const suburbAgent = assignmentService.selectUserRoundRobin(agents, 'suburb_delivery');
  console.log('Suburb agent:', suburbAgent?.firstName);

  // Reset round-robin for a context
  assignmentService.resetRoundRobin('downtown_delivery');
}

// ============================================================================
// Example 2: Assignment Service - Weighted Distribution
// ============================================================================

async function exampleWeightedAssignment() {
  console.log('Example 2: Weighted Assignment');

  const salesReps = await assignmentService.getUsersByRole('sales_rep');

  // Define weights (senior reps get more assignments)
  const weights = {
    'senior-rep-id-1': 0.4,  // 40%
    'senior-rep-id-2': 0.3,  // 30%
    'junior-rep-id-1': 0.2,  // 20%
    'junior-rep-id-2': 0.1   // 10%
  };

  // Validate weights first
  const validation = assignmentService.validateWeights(weights);
  if (!validation.valid) {
    console.error('Invalid weights:', validation.errors);
    return;
  }

  // Select rep using weighted distribution
  const selectedRep = assignmentService.selectUserWeighted(salesReps, weights);
  console.log('Selected sales rep:', selectedRep?.firstName);

  // Over multiple selections, distribution should match weights
  const selections: { [key: string]: number } = {};
  for (let i = 0; i < 1000; i++) {
    const rep = assignmentService.selectUserWeighted(salesReps, weights);
    if (rep) {
      selections[rep.id] = (selections[rep.id] || 0) + 1;
    }
  }
  console.log('Distribution over 1000 selections:', selections);
}

// ============================================================================
// Example 3: Condition Evaluator - Simple Conditions
// ============================================================================

function exampleSimpleConditions() {
  console.log('Example 3: Simple Conditions');

  // Example 3.1: Numeric comparison
  const highValueCondition = createSimpleCondition('totalAmount', 'greater_than', 200);
  const order1 = { totalAmount: 250 };
  const order2 = { totalAmount: 150 };

  console.log('Order 1 is high value:', evaluateConditions(highValueCondition, order1)); // true
  console.log('Order 2 is high value:', evaluateConditions(highValueCondition, order2)); // false

  // Example 3.2: String contains
  const electronicsCondition = createSimpleCondition('productName', 'contains', 'Laptop');
  const product1 = { productName: 'Dell Laptop Pro' };
  const product2 = { productName: 'Office Chair' };

  console.log('Product 1 is laptop:', evaluateConditions(electronicsCondition, product1)); // true
  console.log('Product 2 is laptop:', evaluateConditions(electronicsCondition, product2)); // false

  // Example 3.3: Nested field access
  const vipCondition = createSimpleCondition('customer.totalOrders', 'greater_than', 10);
  const orderWithCustomer = {
    orderId: '123',
    customer: {
      totalOrders: 15,
      totalSpent: 5000
    }
  };

  console.log('Customer is VIP:', evaluateConditions(vipCondition, orderWithCustomer)); // true
}

// ============================================================================
// Example 4: Condition Evaluator - Complex AND/OR Logic
// ============================================================================

function exampleComplexConditions() {
  console.log('Example 4: Complex Conditions');

  // VIP customer: total orders > 10 OR total spent > $1000
  const vipCondition = {
    logic: 'OR' as const,
    rules: [
      { field: 'customer.totalOrders', operator: 'greater_than' as const, value: 10 },
      { field: 'customer.totalSpent', operator: 'greater_than' as const, value: 1000 }
    ]
  };

  const customer1 = {
    customer: {
      totalOrders: 5,
      totalSpent: 1500
    }
  };

  const customer2 = {
    customer: {
      totalOrders: 15,
      totalSpent: 500
    }
  };

  const customer3 = {
    customer: {
      totalOrders: 3,
      totalSpent: 200
    }
  };

  console.log('Customer 1 is VIP:', evaluateConditions(vipCondition, customer1)); // true (high spend)
  console.log('Customer 2 is VIP:', evaluateConditions(vipCondition, customer2)); // true (many orders)
  console.log('Customer 3 is VIP:', evaluateConditions(vipCondition, customer3)); // false

  // Complex nested condition
  const complexCondition = {
    logic: 'AND' as const,
    rules: [
      { field: 'deliveryArea', operator: 'equals' as const, value: 'Downtown' },
      {
        logic: 'OR' as const,
        rules: [
          { field: 'priority', operator: 'greater_than' as const, value: 5 },
          { field: 'totalAmount', operator: 'greater_than' as const, value: 200 }
        ]
      }
    ]
  };

  const order1 = {
    deliveryArea: 'Downtown',
    priority: 8,
    totalAmount: 100
  };

  const order2 = {
    deliveryArea: 'Downtown',
    priority: 3,
    totalAmount: 250
  };

  const order3 = {
    deliveryArea: 'Suburb',
    priority: 10,
    totalAmount: 300
  };

  console.log('Order 1 matches:', evaluateConditions(complexCondition, order1)); // true
  console.log('Order 2 matches:', evaluateConditions(complexCondition, order2)); // true
  console.log('Order 3 matches:', evaluateConditions(complexCondition, order3)); // false
}

// ============================================================================
// Example 5: Using Workflow Templates
// ============================================================================

async function exampleUsingTemplates() {
  console.log('Example 5: Using Workflow Templates');

  // Get all available templates
  const allTemplates = getAllTemplates();
  console.log('Available templates:', allTemplates.map(t => t.name));

  // Get a specific template
  const highValueTemplate = getTemplateById('high-value-alert');
  if (highValueTemplate) {
    console.log('Template:', highValueTemplate.name);
    console.log('Description:', highValueTemplate.description);
    console.log('Actions:', highValueTemplate.actions.map(a => a.type));

    // Create workflow from template
    const workflow = await workflowService.createWorkflow({
      name: highValueTemplate.name,
      description: highValueTemplate.description,
      triggerType: highValueTemplate.triggerType,
      triggerData: highValueTemplate.triggerData,
      conditions: highValueTemplate.conditions,
      actions: highValueTemplate.actions
    });

    console.log('Created workflow:', workflow.id);
  }

  // Get templates by category
  const assignmentTemplates = getAllTemplates().filter(t => t.category === 'Assignment');
  console.log('Assignment templates:', assignmentTemplates.map(t => t.name));
}

// ============================================================================
// Example 6: Complete Workflow with Conditional Actions
// ============================================================================

async function exampleConditionalWorkflow() {
  console.log('Example 6: Conditional Workflow');

  const workflow = await workflowService.createWorkflow({
    name: 'Smart Order Processing',
    description: 'Process orders with intelligent assignment and notifications',
    triggerType: 'status_change',
    triggerData: {
      status: 'confirmed'
    },
    actions: [
      // Action 1: Update priority based on order value
      {
        type: 'update_order',
        conditions: {
          logic: 'AND',
          rules: [
            { field: 'totalAmount', operator: 'greater_than', value: 200 }
          ]
        },
        priority: 10,
        elseBranch: [
          {
            type: 'update_order',
            priority: 5
          }
        ]
      },

      // Action 2: Assign to appropriate sales rep
      {
        type: 'assign_user',
        conditions: {
          logic: 'OR',
          rules: [
            { field: 'customer.totalOrders', operator: 'greater_than', value: 10 },
            { field: 'totalAmount', operator: 'greater_than', value: 500 }
          ]
        },
        // VIP customers get senior reps (weighted)
        userRole: 'sales_rep',
        targetField: 'customerRepId',
        assignmentMethod: 'weighted',
        weights: {
          'senior-rep-1': 0.5,
          'senior-rep-2': 0.5
        },
        elseBranch: [
          {
            // Regular customers get round-robin
            type: 'assign_user',
            userRole: 'sales_rep',
            targetField: 'customerRepId',
            assignmentMethod: 'round_robin'
          }
        ]
      },

      // Action 3: Send appropriate notification
      {
        type: 'send_sms',
        conditions: {
          logic: 'AND',
          rules: [
            { field: 'totalAmount', operator: 'greater_than', value: 100 }
          ]
        },
        phoneNumber: '{{customer.phoneNumber}}',
        message: 'Thank you for your high-value order! Order #{{orderNumber}}',
        elseBranch: [
          {
            type: 'send_email',
            email: '{{customer.email}}',
            subject: 'Order Confirmation',
            body: 'Your order #{{orderNumber}} has been confirmed.'
          }
        ]
      }
    ]
  });

  console.log('Created conditional workflow:', workflow.id);

  // Execute workflow with test data
  await workflowService.executeWorkflow(workflow.id, {
    orderId: 'test-order-123',
    orderNumber: '1001',
    totalAmount: 250,
    customer: {
      phoneNumber: '+1234567890',
      email: 'customer@example.com',
      totalOrders: 15
    }
  });
}

// ============================================================================
// Example 7: Area-Based Delivery Assignment
// ============================================================================

async function exampleAreaBasedAssignment() {
  console.log('Example 7: Area-Based Assignment');

  const workflow = await workflowService.createWorkflow({
    name: 'Area-Based Delivery Assignment',
    triggerType: 'status_change',
    triggerData: { status: 'ready_for_pickup' },
    actions: [
      {
        type: 'assign_user',
        conditions: {
          logic: 'AND',
          rules: [
            { field: 'deliveryArea', operator: 'equals', value: 'Downtown' }
          ]
        },
        userRole: 'delivery_agent',
        targetField: 'deliveryAgentId',
        assignmentMethod: 'round_robin',
        area: 'Downtown', // Separate round-robin pool for downtown
        elseBranch: [
          {
            type: 'assign_user',
            conditions: {
              logic: 'AND',
              rules: [
                { field: 'deliveryArea', operator: 'equals', value: 'Suburbs' }
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
        message: 'New delivery: Order #{{orderNumber}} in {{deliveryArea}}'
      }
    ]
  });

  console.log('Created area-based workflow:', workflow.id);
}

// ============================================================================
// Export examples for testing/documentation
// ============================================================================

export const examples = {
  exampleRoundRobinAssignment,
  exampleWeightedAssignment,
  exampleSimpleConditions,
  exampleComplexConditions,
  exampleUsingTemplates,
  exampleConditionalWorkflow,
  exampleAreaBasedAssignment
};

// Run all examples if executed directly
if (require.main === module) {
  (async () => {
    console.log('Running Workflow System Examples...\n');

    try {
      await exampleRoundRobinAssignment();
      console.log('\n---\n');

      await exampleWeightedAssignment();
      console.log('\n---\n');

      exampleSimpleConditions();
      console.log('\n---\n');

      exampleComplexConditions();
      console.log('\n---\n');

      await exampleUsingTemplates();
      console.log('\n---\n');

      await exampleConditionalWorkflow();
      console.log('\n---\n');

      await exampleAreaBasedAssignment();

      console.log('\n✓ All examples completed!');
    } catch (error) {
      console.error('Error running examples:', error);
    }
  })();
}
