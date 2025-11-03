# Workflow Services Implementation Guide

This document provides a comprehensive guide to the simplified workflow system backend services.

## Overview

The workflow system consists of four main components:

1. **Assignment Service** - User assignment logic (round-robin and weighted)
2. **Condition Evaluator** - Condition evaluation engine for IF/ELSE logic
3. **Workflow Service** - Enhanced workflow execution with conditions and assignments
4. **Workflow Templates** - Pre-built workflow templates for common scenarios

---

## 1. Assignment Service

**Location:** `/backend/src/services/assignmentService.ts`

### Purpose
Handles intelligent user assignment logic for workflows, supporting both round-robin and weighted distribution methods.

### Key Features

#### Round-Robin Assignment
- Distributes assignments evenly across available users
- Maintains separate state for different contexts (e.g., by area, by role)
- Filters only active and available users
- Context-aware selection (e.g., `delivery_agent_Downtown`, `delivery_agent_Suburbs`)

#### Weighted Assignment
- Assigns users based on percentage weights
- Supports senior/junior distribution (e.g., 40% senior, 30% mid, 30% junior)
- Validates and normalizes weights automatically
- Falls back to equal distribution if no valid weights

### Main Methods

```typescript
// Round-robin selection
selectUserRoundRobin(users: User[], contextKey?: string): User | null

// Weighted selection
selectUserWeighted(users: User[], weights: AssignmentWeights): User | null

// Get users by role
getUsersByRole(role: string, additionalFilters?: any): Promise<User[]>

// Specialized methods
selectDeliveryAgentForArea(area: string): Promise<User | null>
selectSalesRepWeighted(weights: AssignmentWeights): Promise<User | null>

// Utility methods
resetRoundRobin(contextKey?: string): void
validateWeights(weights: AssignmentWeights): { valid: boolean; errors: string[] }
```

### Usage Examples

```typescript
import assignmentService from './services/assignmentService';

// Example 1: Round-robin delivery agent assignment by area
const agent = await assignmentService.selectDeliveryAgentForArea('Downtown');

// Example 2: Weighted sales rep assignment
const salesRep = await assignmentService.selectSalesRepWeighted({
  'user-id-1': 0.4,  // 40% weight
  'user-id-2': 0.3,  // 30% weight
  'user-id-3': 0.3   // 30% weight
});

// Example 3: Custom round-robin with filters
const users = await assignmentService.getUsersByRole('delivery_agent', {
  country: 'USA'
});
const selected = assignmentService.selectUserRoundRobin(users, 'usa_agents');
```

### Edge Cases Handled

- No users available → Returns null
- All users inactive/unavailable → Returns null
- Invalid weights → Falls back to equal distribution
- Total weights don't sum to 1.0 → Automatically normalizes

---

## 2. Condition Evaluator

**Location:** `/backend/src/utils/conditionEvaluator.ts`

### Purpose
Evaluates complex conditions with support for multiple operators and AND/OR logic, enabling IF/ELSE workflows.

### Supported Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `equals` | Exact match | `status equals "confirmed"` |
| `not_equals` | Not equal to | `status not_equals "cancelled"` |
| `greater_than` | Numeric comparison | `totalAmount greater_than 200` |
| `less_than` | Numeric comparison | `priority less_than 5` |
| `greater_than_or_equal` | Numeric comparison | `customer.totalOrders >= 10` |
| `less_than_or_equal` | Numeric comparison | `quantity <= 100` |
| `contains` | String/array contains | `products contains "Electronics"` |
| `not_contains` | Does not contain | `tags not_contains "vip"` |
| `starts_with` | String starts with | `orderNumber starts_with "ORD"` |
| `ends_with` | String ends with | `email ends_with "@gmail.com"` |
| `in` | Value in array | `status in ["confirmed", "preparing"]` |
| `not_in` | Value not in array | `area not_in ["Restricted1", "Restricted2"]` |
| `is_empty` | Empty/null check | `notes is_empty` |
| `is_not_empty` | Not empty check | `codAmount is_not_empty` |

### Condition Structure

```typescript
interface Conditions {
  logic: 'AND' | 'OR';
  rules: Array<ConditionRule | ConditionGroup>;
}

interface ConditionRule {
  field: string;
  operator: ConditionOperator;
  value?: any;
}
```

### Main Functions

```typescript
// Evaluate conditions
evaluateConditions(conditions: Conditions, context: any): boolean

// Evaluate single rule
evaluateRule(actual: any, operator: ConditionOperator, expected?: any): boolean

// Validate conditions
validateConditions(conditions: any): { valid: boolean; errors: string[] }

// Helper functions
createSimpleCondition(field: string, operator: ConditionOperator, value?: any): Conditions
createAndCondition(rules: ConditionRule[]): Conditions
createOrCondition(rules: ConditionRule[]): Conditions
```

### Usage Examples

```typescript
import { evaluateConditions, createSimpleCondition } from './utils/conditionEvaluator';

// Example 1: Simple condition
const condition = createSimpleCondition('totalAmount', 'greater_than', 200);
const result = evaluateConditions(condition, { totalAmount: 250 }); // true

// Example 2: Complex AND/OR conditions
const complexCondition = {
  logic: 'OR',
  rules: [
    {
      field: 'customer.totalOrders',
      operator: 'greater_than',
      value: 10
    },
    {
      logic: 'AND',
      rules: [
        { field: 'totalAmount', operator: 'greater_than', value: 500 },
        { field: 'customer.tags', operator: 'contains', value: 'vip' }
      ]
    }
  ]
};

const context = {
  customer: { totalOrders: 5, tags: ['vip', 'premium'] },
  totalAmount: 600
};

const result = evaluateConditions(complexCondition, context); // true

// Example 3: Nested field access
const orderContext = {
  customer: {
    totalOrders: 15,
    totalSpent: 5000
  },
  deliveryArea: 'Downtown',
  paymentStatus: 'pending'
};

const condition = {
  logic: 'AND',
  rules: [
    { field: 'customer.totalOrders', operator: 'greater_than', value: 10 },
    { field: 'deliveryArea', operator: 'equals', value: 'Downtown' }
  ]
};

const passes = evaluateConditions(condition, orderContext); // true
```

### Features

- **Nested Field Access**: Use dot notation (e.g., `customer.totalOrders`)
- **Type Safety**: Automatic type checking for operators
- **Short-circuit Evaluation**: Optimizes performance
- **Recursive Groups**: Support for nested condition groups
- **Validation**: Validates condition structure before execution

---

## 3. Updated Workflow Service

**Location:** `/backend/src/services/workflowService.ts`

### New Features

#### Conditional Actions
Actions can now have their own conditions, enabling IF/ELSE logic:

```typescript
{
  type: 'send_sms',
  conditions: {
    logic: 'AND',
    rules: [
      { field: 'totalAmount', operator: 'greater_than', value: 100 }
    ]
  },
  phoneNumber: '{{customer.phoneNumber}}',
  message: 'High value order confirmation',
  elseBranch: [
    {
      type: 'send_email',
      email: '{{customer.email}}',
      subject: 'Order confirmation'
    }
  ]
}
```

#### New Action Type: `assign_user`

Replaces the basic `assign_agent` with a more flexible user assignment action:

```typescript
{
  type: 'assign_user',
  userRole: 'delivery_agent',           // Required
  targetField: 'deliveryAgentId',        // Optional, defaults to 'deliveryAgentId'
  assignmentMethod: 'round_robin',       // 'round_robin' or 'weighted'
  area: 'Downtown',                      // Optional, for context-specific round-robin
  weights: {                             // Required if method is 'weighted'
    'user-id-1': 0.5,
    'user-id-2': 0.3,
    'user-id-3': 0.2
  },
  additionalFilters: {                   // Optional Prisma filters
    country: 'USA'
  },
  priority: 5                            // Optional, sets order priority
}
```

### Action Execution Flow

1. Check if action has conditions
2. Evaluate conditions against context
3. If conditions met → Execute main action
4. If conditions not met → Execute `elseBranch` if defined
5. Return execution result

### Integration Points

```typescript
// Import new services
import { evaluateConditions } from '../utils/conditionEvaluator';
import assignmentService from './assignmentService';

// New method added
private async executeAssignUserAction(action: any, context: any): Promise<any>

// Updated validation
private validateWorkflowActions(actions: any[]): void {
  // Now includes 'assign_user' validation
}
```

---

## 4. Workflow Templates

**Location:** `/backend/src/data/workflowTemplates.ts`

### Purpose
Provides 10 pre-built workflow templates for common scenarios that can be used as-is or customized.

### Available Templates

#### 1. Auto-Assign Orders by Product Type
- **ID**: `assign-by-product`
- **Category**: Assignment
- **Trigger**: Order confirmed
- **Logic**: IF product contains "Electronics" → Assign to electronics specialists, ELSE → Standard assignment

#### 2. High-Value Order Notification
- **ID**: `high-value-alert`
- **Category**: Notification
- **Trigger**: Order confirmed
- **Condition**: Total amount > $200
- **Actions**: Set high priority, add tag, notify manager via email and SMS

#### 3. Customer Order Confirmation SMS
- **ID**: `send-confirmation-sms`
- **Category**: Communication
- **Trigger**: Order confirmed
- **Actions**: Send SMS to customer, add confirmation tag

#### 4. Auto-Assign Delivery Agent by Area
- **ID**: `assign-by-area`
- **Category**: Assignment
- **Trigger**: Ready for pickup
- **Logic**: IF area = "Downtown" → Assign downtown agents, ELSE IF area = "Suburbs" → Assign suburb agents, ELSE → Generic assignment

#### 5. VIP Customer Priority Handling
- **ID**: `vip-customer-priority`
- **Category**: Customer Management
- **Trigger**: Pending confirmation
- **Condition**: Customer total orders > 10 OR total spent > $1000
- **Actions**: Set high priority, add VIP tag, assign to senior sales rep (weighted), notify rep

#### 6. Failed Delivery Follow-up
- **ID**: `failed-delivery-followup`
- **Category**: Delivery Management
- **Trigger**: Failed delivery
- **Actions**: Send SMS and email to customer, add tag, increase priority

#### 7. Out for Delivery Notification
- **ID**: `out-for-delivery-notification`
- **Category**: Communication
- **Trigger**: Out for delivery
- **Actions**: Send SMS and email to customer with agent details

#### 8. Low Stock Alert
- **ID**: `low-stock-alert`
- **Category**: Inventory
- **Trigger**: Order preparing
- **Condition**: Has low stock items
- **Actions**: Email inventory manager

#### 9. COD Payment Collection Reminder
- **ID**: `collect-payment-reminder`
- **Category**: Financial
- **Trigger**: Out for delivery
- **Condition**: Payment status = pending AND COD amount exists
- **Actions**: Remind delivery agent via SMS, add tag

#### 10. Weekend Order Handling
- **ID**: `weekend-order-handling`
- **Category**: Operations
- **Trigger**: Manual
- **Actions**: Set priority, add weekend tag, notify operations team

### Helper Functions

```typescript
// Get template by ID
getTemplateById(templateId: string): WorkflowTemplate | undefined

// Get templates by category
getTemplatesByCategory(category: string): WorkflowTemplate[]

// Get all categories
getTemplateCategories(): string[]

// Get all templates
getAllTemplates(): WorkflowTemplate[]
```

### Usage Example

```typescript
import { getTemplateById, getAllTemplates } from './data/workflowTemplates';
import workflowService from './services/workflowService';

// Use a template to create a workflow
const template = getTemplateById('high-value-alert');

if (template) {
  const workflow = await workflowService.createWorkflow({
    name: template.name,
    description: template.description,
    triggerType: template.triggerType,
    triggerData: template.triggerData,
    conditions: template.conditions,
    actions: template.actions
  });
}

// List all templates for UI
const allTemplates = getAllTemplates();
const categories = getTemplateCategories();
```

---

## Complete Integration Example

Here's a complete example showing how all components work together:

```typescript
import workflowService from './services/workflowService';
import { getTemplateById } from './data/workflowTemplates';

// 1. Create workflow from template
const template = getTemplateById('assign-by-area');
const workflow = await workflowService.createWorkflow({
  name: 'Auto-assign delivery agents',
  description: 'Automatically assign orders to delivery agents based on area',
  triggerType: template.triggerType,
  triggerData: template.triggerData,
  actions: template.actions
});

// 2. Execute workflow when order status changes
const orderContext = {
  orderId: 'order-123',
  orderNumber: 'ORD-001',
  deliveryArea: 'Downtown',
  totalAmount: 250,
  customer: {
    phoneNumber: '+1234567890',
    totalOrders: 15,
    totalSpent: 2500
  }
};

await workflowService.executeWorkflow(workflow.id, orderContext);

// 3. Behind the scenes:
// - Condition evaluator checks if deliveryArea = 'Downtown'
// - Assignment service uses round-robin for 'delivery_agent_Downtown' context
// - Selected agent is assigned to order
// - SMS notification sent to agent
```

---

## API Integration

### Create Workflow from Template

```http
POST /api/workflows/from-template
Content-Type: application/json

{
  "templateId": "high-value-alert",
  "customizations": {
    "name": "Custom High Value Alert",
    "conditions": {
      "logic": "AND",
      "rules": [
        { "field": "totalAmount", "operator": "greater_than", "value": 500 }
      ]
    }
  }
}
```

### Execute Workflow

```http
POST /api/workflows/:workflowId/execute
Content-Type: application/json

{
  "input": {
    "orderId": "order-123",
    "deliveryArea": "Downtown",
    "totalAmount": 300
  }
}
```

---

## Testing

### Unit Tests

```typescript
// Test assignment service
describe('AssignmentService', () => {
  it('should select users in round-robin fashion', () => {
    const users = [user1, user2, user3];
    const first = assignmentService.selectUserRoundRobin(users, 'test');
    const second = assignmentService.selectUserRoundRobin(users, 'test');
    expect(first).not.toBe(second);
  });

  it('should validate weights correctly', () => {
    const result = assignmentService.validateWeights({
      'user1': 0.5,
      'user2': 0.3,
      'user3': 0.2
    });
    expect(result.valid).toBe(true);
  });
});

// Test condition evaluator
describe('ConditionEvaluator', () => {
  it('should evaluate simple conditions', () => {
    const condition = createSimpleCondition('age', 'greater_than', 18);
    const result = evaluateConditions(condition, { age: 25 });
    expect(result).toBe(true);
  });

  it('should handle nested field access', () => {
    const condition = createSimpleCondition('user.profile.age', 'equals', 30);
    const result = evaluateConditions(condition, {
      user: { profile: { age: 30 } }
    });
    expect(result).toBe(true);
  });
});
```

---

## Performance Considerations

1. **Round-Robin State**: Currently in-memory. For production, use Redis to persist state across server restarts.

2. **Condition Evaluation**: Short-circuit evaluation optimizes performance for AND/OR logic.

3. **User Queries**: Assignment service caches user queries. Consider adding Redis cache for frequently accessed user lists.

4. **Workflow Execution**: Async processing via Bull queues prevents blocking.

---

## Security Considerations

1. **Input Validation**: All user inputs are validated before workflow execution.

2. **Permission Checks**: Ensure only authorized users can create/execute workflows.

3. **Condition Injection**: Condition evaluator sanitizes field names to prevent injection attacks.

4. **Weight Validation**: Assignment weights are validated to prevent invalid distributions.

---

## Future Enhancements

1. **Machine Learning**: Predict best assignments based on historical performance.

2. **A/B Testing**: Test different assignment strategies and measure outcomes.

3. **Advanced Scheduling**: Time-based conditions and delayed executions.

4. **External Integrations**: Webhook-based triggers from external systems.

5. **Visual Workflow Builder**: Drag-and-drop UI for workflow creation.

---

## File Structure Summary

```
backend/
├── src/
│   ├── services/
│   │   ├── assignmentService.ts    (8.4 KB) - User assignment logic
│   │   └── workflowService.ts      (17.6 KB) - Enhanced workflow execution
│   ├── utils/
│   │   └── conditionEvaluator.ts   (10.6 KB) - Condition evaluation engine
│   └── data/
│       └── workflowTemplates.ts    (12.5 KB) - Pre-built templates
└── docs/
    └── WORKFLOW_SERVICES_IMPLEMENTATION.md (This file)
```

---

## Quick Reference

### Create a Simple Workflow

```typescript
const workflow = await workflowService.createWorkflow({
  name: 'Send confirmation SMS',
  triggerType: 'status_change',
  triggerData: { status: 'confirmed' },
  actions: [
    {
      type: 'send_sms',
      phoneNumber: '{{customer.phoneNumber}}',
      message: 'Order confirmed!'
    }
  ]
});
```

### Create a Conditional Workflow

```typescript
const workflow = await workflowService.createWorkflow({
  name: 'VIP handling',
  triggerType: 'status_change',
  triggerData: { status: 'confirmed' },
  conditions: {
    logic: 'AND',
    rules: [
      { field: 'customer.totalOrders', operator: 'greater_than', value: 10 }
    ]
  },
  actions: [
    {
      type: 'assign_user',
      userRole: 'sales_rep',
      assignmentMethod: 'weighted',
      weights: { 'senior-rep-id': 0.7, 'mid-rep-id': 0.3 }
    }
  ]
});
```

---

## Support

For questions or issues, refer to:
- Main documentation: `/backend/docs/API.md`
- Prisma schema: `/backend/prisma/schema.prisma`
- Frontend integration: `/frontend/src/services/workflows.service.ts`
