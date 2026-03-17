# Workflow System Quick Start Guide

Quick reference for using the simplified workflow system.

## New Files Created

1. **Assignment Service** - `/backend/src/services/assignmentService.ts`
2. **Condition Evaluator** - `/backend/src/utils/conditionEvaluator.ts`
3. **Workflow Templates** - `/backend/src/data/workflowTemplates.ts`
4. **Updated Workflow Service** - `/backend/src/services/workflowService.ts` (enhanced)

## Key Features

### 1. Assignment Methods

**Round-Robin** - Evenly distribute assignments
```typescript
{
  type: 'assign_user',
  userRole: 'delivery_agent',
  assignmentMethod: 'round_robin',
  area: 'Downtown'  // Optional: separate contexts by area
}
```

**Weighted** - Percentage-based distribution
```typescript
{
  type: 'assign_user',
  userRole: 'sales_rep',
  assignmentMethod: 'weighted',
  weights: {
    'user-id-1': 0.5,  // 50%
    'user-id-2': 0.3,  // 30%
    'user-id-3': 0.2   // 20%
  }
}
```

### 2. Condition Operators

| Operator | Example |
|----------|---------|
| `equals` | `status equals "confirmed"` |
| `not_equals` | `status not_equals "cancelled"` |
| `greater_than` | `totalAmount > 200` |
| `less_than` | `priority < 5` |
| `contains` | `products contains "Electronics"` |
| `in` | `status in ["confirmed", "preparing"]` |
| `is_empty` | `notes is_empty` |

### 3. IF/ELSE Logic

```typescript
{
  type: 'send_sms',
  conditions: {
    logic: 'AND',
    rules: [
      { field: 'totalAmount', operator: 'greater_than', value: 100 }
    ]
  },
  message: 'High value order',
  elseBranch: [
    {
      type: 'send_email',
      subject: 'Standard order'
    }
  ]
}
```

### 4. Nested Field Access

Use dot notation to access nested fields:
```typescript
{
  field: 'customer.totalOrders',
  operator: 'greater_than',
  value: 10
}
```

Context object:
```typescript
{
  customer: {
    totalOrders: 15,
    totalSpent: 5000
  }
}
```

## Pre-built Templates

Use templates for common scenarios:

```typescript
import { getTemplateById } from './data/workflowTemplates';

// Available template IDs:
// - assign-by-product
// - high-value-alert
// - send-confirmation-sms
// - assign-by-area
// - vip-customer-priority
// - failed-delivery-followup
// - out-for-delivery-notification
// - low-stock-alert
// - collect-payment-reminder
// - weekend-order-handling

const template = getTemplateById('high-value-alert');
```

## Complete Workflow Example

```typescript
import workflowService from './services/workflowService';

const workflow = await workflowService.createWorkflow({
  name: 'Smart Order Assignment',
  description: 'Assign orders based on value and customer history',
  triggerType: 'status_change',
  triggerData: { status: 'confirmed' },

  // Workflow-level condition (optional)
  conditions: {
    logic: 'OR',
    rules: [
      { field: 'totalAmount', operator: 'greater_than', value: 100 },
      { field: 'customer.totalOrders', operator: 'greater_than', value: 5 }
    ]
  },

  actions: [
    // Action 1: Set priority based on amount
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

    // Action 2: Assign user with weighted distribution
    {
      type: 'assign_user',
      userRole: 'sales_rep',
      targetField: 'customerRepId',
      assignmentMethod: 'weighted',
      weights: {
        'senior-rep-id': 0.5,
        'mid-rep-id': 0.3,
        'junior-rep-id': 0.2
      }
    },

    // Action 3: Send notification
    {
      type: 'send_sms',
      phoneNumber: '{{customer.phoneNumber}}',
      message: 'Order confirmed! Your sales rep will contact you soon.'
    }
  ]
});

// Execute the workflow
await workflowService.executeWorkflow(workflow.id, {
  orderId: 'order-123',
  totalAmount: 250,
  customer: {
    phoneNumber: '+1234567890',
    totalOrders: 10
  }
});
```

## Assignment Service Standalone Usage

```typescript
import assignmentService from './services/assignmentService';

// Get users by role
const deliveryAgents = await assignmentService.getUsersByRole('delivery_agent');

// Round-robin selection
const agent1 = assignmentService.selectUserRoundRobin(deliveryAgents, 'downtown');
const agent2 = assignmentService.selectUserRoundRobin(deliveryAgents, 'downtown');
// agent1 !== agent2 (different agents selected)

// Weighted selection
const salesRep = assignmentService.selectUserWeighted(salesReps, {
  'user-id-1': 0.6,
  'user-id-2': 0.4
});

// Validate weights
const validation = assignmentService.validateWeights(weights);
if (!validation.valid) {
  console.error('Invalid weights:', validation.errors);
}

// Reset round-robin state
assignmentService.resetRoundRobin('downtown');
```

## Condition Evaluator Standalone Usage

```typescript
import {
  evaluateConditions,
  createSimpleCondition,
  createAndCondition,
  createOrCondition,
  validateConditions
} from './utils/conditionEvaluator';

// Simple condition
const condition = createSimpleCondition('age', 'greater_than', 18);
const result = evaluateConditions(condition, { age: 25 }); // true

// Complex condition
const complexCondition = {
  logic: 'AND',
  rules: [
    { field: 'totalAmount', operator: 'greater_than', value: 100 },
    {
      logic: 'OR',
      rules: [
        { field: 'customer.tags', operator: 'contains', value: 'vip' },
        { field: 'customer.totalOrders', operator: 'greater_than', value: 10 }
      ]
    }
  ]
};

const context = {
  totalAmount: 150,
  customer: {
    tags: ['regular'],
    totalOrders: 15
  }
};

const passes = evaluateConditions(complexCondition, context); // true

// Validate condition structure
const validation = validateConditions(condition);
if (!validation.valid) {
  console.error('Invalid conditions:', validation.errors);
}
```

## Workflow Action Types

### Existing Actions
- `send_sms` - Send SMS notification
- `send_email` - Send email notification
- `update_order` - Update order fields
- `assign_agent` - Assign delivery agent (legacy)
- `add_tag` - Add tag to order
- `wait` - Delay execution
- `http_request` - External webhook

### New Action
- `assign_user` - **Smart user assignment with round-robin or weighted distribution**

## Migration from Old assign_agent

**Old:**
```typescript
{
  type: 'assign_agent',
  agentId: 'specific-agent-id'
}
```

**New (Dynamic):**
```typescript
{
  type: 'assign_user',
  userRole: 'delivery_agent',
  assignmentMethod: 'round_robin',
  area: 'Downtown'
}
```

## Testing

```bash
# Run backend tests
npm test

# Test specific service
npm test -- assignmentService.test.ts

# Watch mode
npm run test:watch
```

## Common Patterns

### Pattern 1: Area-based Assignment
```typescript
{
  type: 'assign_user',
  conditions: {
    logic: 'AND',
    rules: [
      { field: 'deliveryArea', operator: 'equals', value: 'Downtown' }
    ]
  },
  userRole: 'delivery_agent',
  assignmentMethod: 'round_robin',
  area: 'Downtown'
}
```

### Pattern 2: VIP Customer Handling
```typescript
{
  type: 'assign_user',
  conditions: {
    logic: 'OR',
    rules: [
      { field: 'customer.totalOrders', operator: 'greater_than', value: 10 },
      { field: 'totalAmount', operator: 'greater_than', value: 500 }
    ]
  },
  userRole: 'sales_rep',
  assignmentMethod: 'weighted',
  weights: { 'senior-id': 0.7, 'mid-id': 0.3 }
}
```

### Pattern 3: Cascading IF/ELSE
```typescript
{
  type: 'assign_user',
  conditions: {
    logic: 'AND',
    rules: [{ field: 'priority', operator: 'greater_than', value: 8 }]
  },
  userRole: 'sales_rep',
  assignmentMethod: 'weighted',
  weights: { 'senior-1': 0.5, 'senior-2': 0.5 },
  elseBranch: [
    {
      type: 'assign_user',
      conditions: {
        logic: 'AND',
        rules: [{ field: 'priority', operator: 'greater_than', value: 5 }]
      },
      userRole: 'sales_rep',
      assignmentMethod: 'round_robin',
      elseBranch: [
        {
          type: 'assign_user',
          userRole: 'sales_rep',
          assignmentMethod: 'round_robin'
        }
      ]
    }
  ]
}
```

## Troubleshooting

### Issue: No users selected
**Solution:** Check that users are active and available
```typescript
const users = await prisma.user.findMany({
  where: {
    role: 'delivery_agent',
    isActive: true,
    isAvailable: true
  }
});
```

### Issue: Weights not working
**Solution:** Ensure weights sum to approximately 1.0
```typescript
const validation = assignmentService.validateWeights(weights);
console.log(validation.errors);
```

### Issue: Conditions always fail
**Solution:** Check nested field paths and data types
```typescript
// Correct
{ field: 'customer.totalOrders', operator: 'greater_than', value: 10 }

// Incorrect (missing nested field)
{ field: 'totalOrders', operator: 'greater_than', value: 10 }
```

## Best Practices

1. **Always validate inputs** before creating workflows
2. **Use templates** as starting points for common scenarios
3. **Test conditions** with sample data before deploying
4. **Monitor execution logs** to optimize assignment strategies
5. **Use context keys** for round-robin to separate different assignment pools
6. **Normalize weights** to sum to 1.0 for predictable distribution

## Next Steps

1. Review full documentation: `/backend/docs/WORKFLOW_SERVICES_IMPLEMENTATION.md`
2. Explore templates: `/backend/src/data/workflowTemplates.ts`
3. Integrate with frontend workflow editor
4. Set up monitoring and analytics for workflow performance

## API Endpoints (TODO)

These endpoints would need to be added to the workflow controller:

```typescript
// Get all templates
GET /api/workflows/templates

// Get template by ID
GET /api/workflows/templates/:templateId

// Create workflow from template
POST /api/workflows/from-template
Body: { templateId: string, customizations?: Partial<WorkflowTemplate> }

// Get assignment statistics
GET /api/workflows/assignment-stats
```

---

For detailed documentation, see: `/backend/docs/WORKFLOW_SERVICES_IMPLEMENTATION.md`
