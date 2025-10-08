# Workflow Automation Guide

Complete guide to automating order workflows in the E-Commerce COD Admin Dashboard.

## Table of Contents

- [Introduction](#introduction)
- [Workflow Components](#workflow-components)
- [Creating Workflows](#creating-workflows)
- [Triggers](#triggers)
- [Conditions](#conditions)
- [Actions](#actions)
- [Common Workflow Examples](#common-workflow-examples)
- [Best Practices](#best-practices)
- [Advanced Workflows](#advanced-workflows)
- [Testing Workflows](#testing-workflows)
- [Troubleshooting](#troubleshooting)

## Introduction

Workflow automation allows you to automate repetitive tasks and streamline your order processing. With workflows, you can automatically update order statuses, send notifications, assign orders to team members, and integrate with external systems.

### Benefits of Automation

- **Save Time**: Eliminate manual, repetitive tasks
- **Reduce Errors**: Consistent automated processes
- **Improve Response Time**: Instant actions on triggers
- **Scale Operations**: Handle more orders with same team
- **Better Customer Experience**: Faster, more reliable service

## Workflow Components

Every workflow consists of three main components:

### 1. Triggers
Events that start the workflow execution.

### 2. Conditions
Rules that determine if the workflow should run.

### 3. Actions
Operations performed when conditions are met.

```
[Trigger] → [Conditions] → [Actions]
    ↓            ↓              ↓
Order Created  Amount > 1000  Update Status
                               Send Email
                               Assign User
```

## Creating Workflows

### Step-by-Step Guide

1. **Navigate to Workflows**
   - Go to the Workflows section
   - Click "Create Workflow"

2. **Basic Information**
   - Name: Descriptive workflow name
   - Description: What the workflow does
   - Status: Enable or disable

3. **Configure Trigger**
   - Select trigger event
   - Set trigger parameters

4. **Add Conditions**
   - Define when workflow runs
   - Use operators (equals, greater than, etc.)

5. **Define Actions**
   - Add actions to perform
   - Configure action parameters
   - Set action order

6. **Test & Save**
   - Test with sample data
   - Save and activate

## Triggers

### Available Triggers

#### Order Triggers

**order.created**
- Fires when a new order is created
- Use for: Initial order processing, assignment

**order.updated**
- Fires when order details change
- Use for: Tracking changes, notifications

**order.status.changed**
- Fires when order status changes
- Use for: Status-specific actions, notifications

**order.payment.received**
- Fires when payment is confirmed
- Use for: Payment processing, fulfillment

#### Customer Triggers

**customer.created**
- Fires when new customer registered
- Use for: Welcome emails, initial setup

**customer.order.count**
- Fires based on customer order count
- Use for: Loyalty programs, VIP status

#### Product Triggers

**product.stock.low**
- Fires when product stock is low
- Use for: Reorder alerts, notifications

**product.out_of_stock**
- Fires when product is out of stock
- Use for: Supplier notifications, alternatives

#### Time-Based Triggers

**schedule.daily**
- Runs at specified time daily
- Use for: Reports, cleanup tasks

**schedule.weekly**
- Runs weekly at specified time
- Use for: Weekly reports, maintenance

### Trigger Configuration

```json
{
  "trigger": {
    "event": "order.created",
    "parameters": {
      "source": "shopify"
    }
  }
}
```

## Conditions

### Condition Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `eq` | Equals | `status eq "PENDING"` |
| `ne` | Not equals | `source ne "manual"` |
| `gt` | Greater than | `amount gt 1000` |
| `gte` | Greater than or equal | `amount gte 500` |
| `lt` | Less than | `items lt 5` |
| `lte` | Less than or equal | `days lte 7` |
| `in` | In array | `status in ["PENDING", "CONFIRMED"]` |
| `contains` | Contains string | `email contains "@vip.com"` |
| `startsWith` | Starts with | `orderNumber startsWith "VIP-"` |

### Condition Examples

**Single Condition:**
```json
{
  "conditions": {
    "totalAmount": { "gte": 1000 }
  }
}
```

**Multiple Conditions (AND):**
```json
{
  "conditions": {
    "totalAmount": { "gte": 1000 },
    "status": { "eq": "PENDING" },
    "paymentMethod": { "eq": "COD" }
  }
}
```

**Complex Conditions (OR):**
```json
{
  "conditions": {
    "or": [
      { "totalAmount": { "gte": 1000 } },
      { "customer.vip": { "eq": true } }
    ]
  }
}
```

## Actions

### Available Actions

#### Status Actions

**updateStatus**
```json
{
  "type": "updateStatus",
  "params": {
    "status": "CONFIRMED",
    "note": "Automatically confirmed"
  }
}
```

#### User Assignment

**assignUser**
```json
{
  "type": "assignUser",
  "params": {
    "userId": "user-id",
    "strategy": "round-robin"
  }
}
```

Strategies:
- `specific`: Assign to specific user
- `round-robin`: Rotate among team
- `least-loaded`: User with fewest orders
- `random`: Random assignment

#### Notification Actions

**sendEmail**
```json
{
  "type": "sendEmail",
  "params": {
    "to": "customer.email",
    "template": "order-confirmation",
    "subject": "Order Confirmed"
  }
}
```

**sendSMS**
```json
{
  "type": "sendSMS",
  "params": {
    "to": "customer.phone",
    "message": "Your order has been confirmed"
  }
}
```

#### Tag Actions

**addTag**
```json
{
  "type": "addTag",
  "params": {
    "tag": "high-value"
  }
}
```

#### Webhook Actions

**callWebhook**
```json
{
  "type": "callWebhook",
  "params": {
    "url": "https://example.com/webhook",
    "method": "POST",
    "headers": {
      "Authorization": "Bearer token"
    }
  }
}
```

## Common Workflow Examples

### Example 1: Auto-Confirm High-Value Orders

**Goal**: Automatically confirm orders over $1000

```json
{
  "name": "Auto-Confirm High-Value Orders",
  "trigger": "order.created",
  "conditions": {
    "totalAmount": { "gte": 1000 }
  },
  "actions": [
    {
      "type": "updateStatus",
      "params": { "status": "CONFIRMED" }
    },
    {
      "type": "addTag",
      "params": { "tag": "high-value" }
    },
    {
      "type": "sendEmail",
      "params": {
        "to": "manager@example.com",
        "template": "high-value-order-alert"
      }
    }
  ]
}
```

### Example 2: New Customer Welcome

**Goal**: Send welcome email to new customers

```json
{
  "name": "New Customer Welcome",
  "trigger": "customer.created",
  "conditions": {},
  "actions": [
    {
      "type": "sendEmail",
      "params": {
        "to": "customer.email",
        "template": "welcome-email"
      }
    },
    {
      "type": "addTag",
      "params": { "tag": "new-customer" }
    }
  ]
}
```

### Example 3: Low Stock Alert

**Goal**: Alert manager when product stock is low

```json
{
  "name": "Low Stock Alert",
  "trigger": "product.stock.low",
  "conditions": {
    "stock": { "lte": 10 }
  },
  "actions": [
    {
      "type": "sendEmail",
      "params": {
        "to": "inventory@example.com",
        "template": "low-stock-alert"
      }
    },
    {
      "type": "callWebhook",
      "params": {
        "url": "https://supplier.com/api/reorder",
        "method": "POST"
      }
    }
  ]
}
```

### Example 4: Order Auto-Assignment

**Goal**: Automatically assign new orders to available agents

```json
{
  "name": "Auto-Assign Orders",
  "trigger": "order.created",
  "conditions": {
    "status": { "eq": "PENDING" }
  },
  "actions": [
    {
      "type": "assignUser",
      "params": {
        "strategy": "least-loaded"
      }
    },
    {
      "type": "sendEmail",
      "params": {
        "to": "assigned.user.email",
        "template": "new-order-assignment"
      }
    }
  ]
}
```

### Example 5: Abandoned Order Follow-Up

**Goal**: Follow up on orders pending for 24 hours

```json
{
  "name": "Abandoned Order Follow-Up",
  "trigger": "schedule.daily",
  "conditions": {
    "status": { "eq": "PENDING" },
    "createdAt": { "lt": "24h" }
  },
  "actions": [
    {
      "type": "sendEmail",
      "params": {
        "to": "customer.email",
        "template": "order-follow-up"
      }
    },
    {
      "type": "addTag",
      "params": { "tag": "follow-up-sent" }
    }
  ]
}
```

### Example 6: VIP Customer Priority

**Goal**: Prioritize orders from VIP customers

```json
{
  "name": "VIP Customer Priority",
  "trigger": "order.created",
  "conditions": {
    "customer.tags": { "contains": "VIP" }
  },
  "actions": [
    {
      "type": "updateStatus",
      "params": { "status": "CONFIRMED" }
    },
    {
      "type": "addTag",
      "params": { "tag": "priority" }
    },
    {
      "type": "assignUser",
      "params": {
        "userId": "senior-agent-id"
      }
    }
  ]
}
```

## Best Practices

### Design Principles

1. **Start Simple**
   - Begin with basic workflows
   - Add complexity gradually
   - Test thoroughly

2. **One Purpose Per Workflow**
   - Each workflow should have one clear goal
   - Easier to maintain and troubleshoot
   - Better performance

3. **Clear Naming**
   - Use descriptive names
   - Include purpose in name
   - Example: "Auto-Confirm-High-Value-Orders"

4. **Document Workflows**
   - Add detailed descriptions
   - Document expected behavior
   - Note any dependencies

### Condition Best Practices

- Use specific conditions
- Avoid overlapping workflows
- Test edge cases
- Consider null values

### Action Best Practices

- Order actions logically
- Handle failures gracefully
- Avoid circular dependencies
- Limit number of actions (max 10)

### Performance Tips

- Avoid heavy computations in workflows
- Use async actions when possible
- Implement timeouts
- Monitor execution times

## Advanced Workflows

### Conditional Actions

Execute actions based on sub-conditions:

```json
{
  "actions": [
    {
      "type": "conditional",
      "if": { "amount": { "gte": 5000 } },
      "then": [
        { "type": "assignUser", "params": { "userId": "senior-id" } }
      ],
      "else": [
        { "type": "assignUser", "params": { "strategy": "round-robin" } }
      ]
    }
  ]
}
```

### Delayed Actions

Schedule actions for future execution:

```json
{
  "type": "delay",
  "params": {
    "duration": "24h",
    "then": [
      { "type": "sendEmail", "params": { "template": "follow-up" } }
    ]
  }
}
```

### Chained Workflows

Trigger other workflows:

```json
{
  "type": "triggerWorkflow",
  "params": {
    "workflowId": "workflow-2-id"
  }
}
```

## Testing Workflows

### Test Mode

1. Enable test mode in workflow settings
2. Test with sample data
3. Review execution logs
4. Verify expected outcomes

### Debugging

**Check Execution Logs:**
```
Workflow: Auto-Confirm High-Value Orders
Trigger: order.created
Conditions: PASSED (amount: 1500 >= 1000)
Actions:
  ✓ updateStatus: SUCCESS
  ✓ addTag: SUCCESS
  ✓ sendEmail: SUCCESS
Duration: 234ms
```

**Common Issues:**
- Conditions not matching
- Missing permissions
- Invalid action parameters
- Network errors (webhooks)

## Troubleshooting

### Workflow Not Executing

**Check:**
- Is workflow enabled?
- Do conditions match?
- Are there conflicting workflows?
- Check trigger configuration

### Actions Failing

**Check:**
- Action parameters correct?
- Required resources available?
- Network connectivity (for webhooks)
- Permissions granted?

### Performance Issues

**Check:**
- Number of active workflows
- Complexity of conditions
- Number of actions per workflow
- Database query performance

---

**For more examples and updates:**
- [User Guide](USER_GUIDE.md)
- [API Documentation](API_DOCUMENTATION.md)

**Last Updated:** 2025-10-08
