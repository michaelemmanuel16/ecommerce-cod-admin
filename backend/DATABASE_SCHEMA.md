# E-Commerce COD Admin Dashboard - Database Schema Documentation

## Overview

This document provides comprehensive documentation for the PostgreSQL database schema used in the E-Commerce Cash-on-Delivery (COD) Admin Dashboard. The schema is designed to support a full-featured admin dashboard for managing orders, deliveries, customers, products, financial transactions, and automated workflows.

## Table of Contents

1. [Custom Types (Enums)](#custom-types-enums)
2. [Tables](#tables)
3. [Relationships](#relationships)
4. [Indexes](#indexes)
5. [Triggers](#triggers)
6. [Views](#views)
7. [JSONB Field Structures](#jsonb-field-structures)
8. [Query Optimization Notes](#query-optimization-notes)

---

## Custom Types (Enums)

### user_role
Defines the different types of users in the system.
- `admin` - System administrators with full access
- `manager` - Managers who oversee operations
- `customer_rep` - Customer service representatives
- `delivery_agent` - Delivery personnel
- `accountant` - Financial/accounting staff

### availability_status
Tracks real-time availability of users (especially delivery agents).
- `available` - Ready to take assignments
- `busy` - Currently occupied
- `offline` - Not available

### order_status
Comprehensive order lifecycle tracking.
- `new` - Order just created
- `confirmation_pending` - Awaiting customer confirmation
- `confirmed` - Customer confirmed the order
- `being_prepared` - Order is being prepared/packed
- `ready_for_pickup` - Ready for delivery agent pickup
- `out_for_delivery` - Currently being delivered
- `delivered` - Successfully delivered
- `returned` - Returned by customer
- `cancelled` - Order cancelled

### priority_level
Order priority for processing and delivery.
- `high` - High priority orders
- `medium` - Standard priority
- `low` - Low priority

### payment_status
Payment collection status.
- `pending` - Payment not yet collected
- `collected` - Payment received
- `refunded` - Payment refunded

### payment_method
Methods of payment.
- `COD` - Cash on Delivery
- `bank_transfer` - Bank transfer
- `cash` - Direct cash payment

### order_source
Origin of the order.
- `manual` - Manually created by staff
- `webhook` - Created from webhook integration
- `csv` - Imported from CSV file
- `api` - Created via API

### transaction_type
Types of financial transactions.
- `revenue` - Income from orders
- `expense` - Business expenses
- `refund` - Refunded amounts

### workflow_trigger
Events that trigger automated workflows.
- `webhook` - Triggered by incoming webhook
- `order_status` - Triggered by order status change
- `customer_tag` - Triggered by customer tag addition
- `time_based` - Triggered at specific times
- `manual` - Manually triggered

### execution_status
Status of workflow executions.
- `running` - Currently executing
- `completed` - Successfully completed
- `failed` - Execution failed

### webhook_source
Source platforms for webhooks.
- `shopify` - Shopify integration
- `woocommerce` - WooCommerce integration
- `custom` - Custom webhook
- `other` - Other sources

### notification_type
Categories of notifications.
- `order` - Order-related notifications
- `delivery` - Delivery updates
- `system` - System notifications
- `workflow` - Workflow notifications
- `alert` - Important alerts

---

## Tables

### 1. users

**Purpose:** Stores all admin users including administrators, managers, customer service representatives, delivery agents, and accountants.

**Columns:**
- `id` (UUID, PK) - Unique identifier
- `email` (VARCHAR, UNIQUE) - User email address
- `password_hash` (VARCHAR) - Hashed password (use bcrypt)
- `full_name` (VARCHAR) - User's full name
- `phone` (VARCHAR) - Contact phone number
- `role` (user_role) - User role/type
- `permissions` (JSONB) - Granular permissions (see JSONB structure)
- `is_active` (BOOLEAN) - Account active status
- `availability_status` (availability_status) - Real-time availability
- `created_at` (TIMESTAMP) - Record creation time
- `updated_at` (TIMESTAMP) - Last update time

**Indexes:**
- `idx_users_role` - Fast filtering by role
- `idx_users_is_active` - Filter active users
- `idx_users_availability` - Find available delivery agents
- `idx_users_email` - Login lookups

---

### 2. customers

**Purpose:** Stores end-customer information with analytics metrics.

**Columns:**
- `id` (UUID, PK) - Unique identifier
- `full_name` (VARCHAR) - Customer's full name
- `email` (VARCHAR) - Email address
- `phone` (VARCHAR) - Phone number (required)
- `address` (TEXT) - Full address
- `city` (VARCHAR) - City
- `area` (VARCHAR) - Area/zone for delivery routing
- `postal_code` (VARCHAR) - Postal code
- `tags` (JSONB) - Customer tags for segmentation
- `total_orders` (INTEGER) - Total number of orders placed
- `total_spent` (DECIMAL) - Total amount spent
- `return_rate` (DECIMAL) - Percentage of returned orders
- `notes` (TEXT) - Internal notes about customer
- `created_at` (TIMESTAMP) - Record creation time
- `updated_at` (TIMESTAMP) - Last update time

**Indexes:**
- `idx_customers_phone` - Lookup by phone
- `idx_customers_email` - Lookup by email
- `idx_customers_area` - Delivery area filtering
- `idx_customers_city` - City-based filtering
- `idx_customers_tags` - GIN index for tag searching
- `idx_customers_created_at` - Recent customers
- `idx_customers_total_orders` - Find top customers
- `idx_customers_total_spent` - Revenue-based sorting

**Notes:** Customer statistics (total_orders, total_spent, return_rate) are automatically updated via triggers when orders change.

---

### 3. products

**Purpose:** Product catalog with variants and inventory management.

**Columns:**
- `id` (UUID, PK) - Unique identifier
- `name` (VARCHAR) - Product name
- `sku` (VARCHAR, UNIQUE) - Stock Keeping Unit
- `description` (TEXT) - Product description
- `category` (VARCHAR) - Product category
- `price` (DECIMAL) - Selling price
- `cost_price` (DECIMAL) - Cost/wholesale price
- `stock_quantity` (INTEGER) - Current stock level
- `low_stock_threshold` (INTEGER) - Alert threshold
- `variants` (JSONB) - Product variants (see JSONB structure)
- `images` (JSONB) - Product images array
- `is_active` (BOOLEAN) - Product availability status
- `created_at` (TIMESTAMP) - Record creation time
- `updated_at` (TIMESTAMP) - Last update time

**Indexes:**
- `idx_products_sku` - SKU lookups
- `idx_products_category` - Category filtering
- `idx_products_is_active` - Active products only
- `idx_products_stock_quantity` - Inventory checks
- `idx_products_name` - Full-text search on name (GIN)
- `idx_products_variants` - Search within variants (GIN)

---

### 4. orders

**Purpose:** Main orders table with comprehensive tracking and assignment.

**Columns:**
- `id` (UUID, PK) - Unique identifier
- `order_number` (VARCHAR, UNIQUE) - Human-readable order number
- `customer_id` (UUID, FK) - Reference to customer
- `assigned_rep_id` (UUID, FK) - Assigned customer rep
- `assigned_agent_id` (UUID, FK) - Assigned delivery agent
- `status` (order_status) - Current order status
- `priority` (priority_level) - Order priority
- `items` (JSONB) - Order line items (see JSONB structure)
- `subtotal` (DECIMAL) - Items total
- `delivery_fee` (DECIMAL) - Delivery charge
- `total_amount` (DECIMAL) - Final total amount
- `payment_status` (payment_status) - Payment collection status
- `payment_method` (payment_method) - Payment method
- `customer_notes` (TEXT) - Notes from customer
- `internal_notes` (TEXT) - Internal staff notes
- `delivery_address` (TEXT) - Delivery address
- `delivery_area` (VARCHAR) - Delivery area/zone
- `source` (order_source) - How order was created
- `webhook_source` (VARCHAR) - Specific webhook source
- `delivery_proof` (JSONB) - Proof of delivery data
- `return_reason` (TEXT) - Reason for return
- `created_at` (TIMESTAMP) - Order creation time
- `updated_at` (TIMESTAMP) - Last update time
- `confirmed_at` (TIMESTAMP) - When order was confirmed
- `delivered_at` (TIMESTAMP) - When order was delivered

**Indexes:**
- `idx_orders_order_number` - Order lookup
- `idx_orders_customer_id` - Customer's orders
- `idx_orders_assigned_rep_id` - Rep's assigned orders
- `idx_orders_assigned_agent_id` - Agent's assigned orders
- `idx_orders_status` - Status filtering
- `idx_orders_priority` - Priority sorting
- `idx_orders_payment_status` - Payment tracking
- `idx_orders_delivery_area` - Area-based routing
- `idx_orders_source` - Source filtering
- `idx_orders_created_at` - Recent orders
- `idx_orders_delivered_at` - Delivery history
- `idx_orders_items` - Search within items (GIN)
- `idx_orders_status_created` - Composite for dashboard queries
- `idx_orders_agent_status` - Agent's orders by status
- `idx_orders_rep_status` - Rep's orders by status
- `idx_orders_area_status` - Area-based status queries

**Foreign Keys:**
- `customer_id` -> customers(id) - ON DELETE RESTRICT
- `assigned_rep_id` -> users(id) - ON DELETE SET NULL
- `assigned_agent_id` -> users(id) - ON DELETE SET NULL

---

### 5. order_history

**Purpose:** Audit trail for all order status changes.

**Columns:**
- `id` (UUID, PK) - Unique identifier
- `order_id` (UUID, FK) - Reference to order
- `changed_by_user_id` (UUID, FK) - User who made the change
- `old_status` (order_status) - Previous status
- `new_status` (order_status) - New status
- `notes` (TEXT) - Additional notes about the change
- `created_at` (TIMESTAMP) - When change occurred

**Indexes:**
- `idx_order_history_order_id` - History for specific order
- `idx_order_history_user_id` - Changes by user
- `idx_order_history_created_at` - Recent changes
- `idx_order_history_new_status` - Filter by new status

**Foreign Keys:**
- `order_id` -> orders(id) - ON DELETE CASCADE
- `changed_by_user_id` -> users(id) - ON DELETE SET NULL

**Notes:** Automatically populated via trigger when order status changes.

---

### 6. deliveries

**Purpose:** Detailed delivery tracking with proof and feedback.

**Columns:**
- `id` (UUID, PK) - Unique identifier
- `order_id` (UUID, FK) - Reference to order
- `agent_id` (UUID, FK) - Assigned delivery agent
- `pickup_time` (TIMESTAMP) - When order was picked up
- `delivery_time` (TIMESTAMP) - When order was delivered
- `route_data` (JSONB) - GPS route tracking data
- `proof_of_delivery` (JSONB) - Delivery proof details
- `signature_url` (VARCHAR) - Customer signature image
- `photo_url` (VARCHAR) - Delivery photo
- `customer_feedback` (TEXT) - Customer comments
- `rating` (INTEGER) - Rating 1-5
- `created_at` (TIMESTAMP) - Record creation time
- `updated_at` (TIMESTAMP) - Last update time

**Indexes:**
- `idx_deliveries_order_id` - Delivery for order
- `idx_deliveries_agent_id` - Agent's deliveries
- `idx_deliveries_pickup_time` - Time-based queries
- `idx_deliveries_delivery_time` - Delivery history
- `idx_deliveries_rating` - Rating analysis
- `idx_deliveries_agent_delivery_time` - Agent performance

**Foreign Keys:**
- `order_id` -> orders(id) - ON DELETE CASCADE
- `agent_id` -> users(id) - ON DELETE RESTRICT

---

### 7. expenses

**Purpose:** Track business expenses for financial reporting.

**Columns:**
- `id` (UUID, PK) - Unique identifier
- `category` (VARCHAR) - Expense category
- `amount` (DECIMAL) - Expense amount
- `description` (TEXT) - Expense description
- `receipt_url` (VARCHAR) - Receipt image/document URL
- `recorded_by_user_id` (UUID, FK) - User who recorded it
- `date` (DATE) - Expense date
- `created_at` (TIMESTAMP) - Record creation time

**Indexes:**
- `idx_expenses_category` - Category filtering
- `idx_expenses_date` - Date-based queries
- `idx_expenses_recorded_by` - Who recorded it
- `idx_expenses_created_at` - Recent expenses

**Foreign Keys:**
- `recorded_by_user_id` -> users(id) - ON DELETE SET NULL

---

### 8. financial_transactions

**Purpose:** Comprehensive financial transaction tracking (revenue, expenses, refunds).

**Columns:**
- `id` (UUID, PK) - Unique identifier
- `order_id` (UUID, FK) - Related order (if applicable)
- `type` (transaction_type) - Transaction type
- `amount` (DECIMAL) - Transaction amount
- `method` (payment_method) - Payment method
- `recorded_by_user_id` (UUID, FK) - User who recorded it
- `notes` (TEXT) - Additional notes
- `date` (DATE) - Transaction date
- `created_at` (TIMESTAMP) - Record creation time

**Indexes:**
- `idx_financial_transactions_order_id` - Order-related transactions
- `idx_financial_transactions_type` - Type filtering
- `idx_financial_transactions_date` - Date-based reporting
- `idx_financial_transactions_recorded_by` - Who recorded it
- `idx_financial_transactions_method` - Payment method analysis
- `idx_financial_transactions_created_at` - Recent transactions

**Foreign Keys:**
- `order_id` -> orders(id) - ON DELETE SET NULL
- `recorded_by_user_id` -> users(id) - ON DELETE SET NULL

---

### 9. workflows

**Purpose:** Define automated workflow configurations.

**Columns:**
- `id` (UUID, PK) - Unique identifier
- `name` (VARCHAR) - Workflow name
- `description` (TEXT) - Workflow description
- `trigger_type` (workflow_trigger) - What triggers the workflow
- `trigger_config` (JSONB) - Trigger configuration (see JSONB structure)
- `workflow_steps` (JSONB) - Workflow steps definition
- `is_active` (BOOLEAN) - Whether workflow is enabled
- `created_by_user_id` (UUID, FK) - Creator
- `created_at` (TIMESTAMP) - Creation time
- `updated_at` (TIMESTAMP) - Last update time

**Indexes:**
- `idx_workflows_trigger_type` - Filter by trigger type
- `idx_workflows_is_active` - Active workflows only
- `idx_workflows_created_by` - Who created it
- `idx_workflows_trigger_config` - Search within config (GIN)

**Foreign Keys:**
- `created_by_user_id` -> users(id) - ON DELETE SET NULL

---

### 10. workflow_executions

**Purpose:** Log all workflow execution attempts and results.

**Columns:**
- `id` (UUID, PK) - Unique identifier
- `workflow_id` (UUID, FK) - Reference to workflow
- `order_id` (UUID, FK) - Related order (if applicable)
- `customer_id` (UUID, FK) - Related customer (if applicable)
- `status` (execution_status) - Execution status
- `steps_completed` (JSONB) - Which steps completed
- `error_log` (JSONB) - Error details if failed
- `started_at` (TIMESTAMP) - Execution start time
- `completed_at` (TIMESTAMP) - Execution end time

**Indexes:**
- `idx_workflow_executions_workflow_id` - Executions for workflow
- `idx_workflow_executions_order_id` - Order-related executions
- `idx_workflow_executions_customer_id` - Customer-related executions
- `idx_workflow_executions_status` - Status filtering
- `idx_workflow_executions_started_at` - Recent executions

**Foreign Keys:**
- `workflow_id` -> workflows(id) - ON DELETE CASCADE
- `order_id` -> orders(id) - ON DELETE SET NULL
- `customer_id` -> customers(id) - ON DELETE SET NULL

---

### 11. webhooks

**Purpose:** Configure external webhook integrations.

**Columns:**
- `id` (UUID, PK) - Unique identifier
- `name` (VARCHAR) - Webhook name
- `source` (webhook_source) - Platform source
- `api_key` (VARCHAR) - API authentication key
- `secret_key` (VARCHAR) - Secret for signature verification
- `endpoint_url` (VARCHAR) - Webhook endpoint URL
- `field_mapping` (JSONB) - Field mapping configuration
- `is_active` (BOOLEAN) - Whether webhook is enabled
- `created_at` (TIMESTAMP) - Creation time
- `updated_at` (TIMESTAMP) - Last update time

**Indexes:**
- `idx_webhooks_source` - Filter by source
- `idx_webhooks_is_active` - Active webhooks
- `idx_webhooks_endpoint_url` - URL lookup

---

### 12. webhook_logs

**Purpose:** Log all incoming webhook requests for debugging and auditing.

**Columns:**
- `id` (UUID, PK) - Unique identifier
- `webhook_id` (UUID, FK) - Reference to webhook config
- `request_payload` (JSONB) - Full webhook payload
- `response_status` (INTEGER) - HTTP response status
- `order_created_id` (UUID, FK) - Created order (if successful)
- `error_message` (TEXT) - Error details if failed
- `created_at` (TIMESTAMP) - Request time

**Indexes:**
- `idx_webhook_logs_webhook_id` - Logs for webhook
- `idx_webhook_logs_order_created_id` - Which order was created
- `idx_webhook_logs_created_at` - Recent logs
- `idx_webhook_logs_response_status` - Status filtering
- `idx_webhook_logs_payload` - Search within payload (GIN)

**Foreign Keys:**
- `webhook_id` -> webhooks(id) - ON DELETE SET NULL
- `order_created_id` -> orders(id) - ON DELETE SET NULL

---

### 13. notifications

**Purpose:** In-app notification system for users.

**Columns:**
- `id` (UUID, PK) - Unique identifier
- `user_id` (UUID, FK) - Target user
- `type` (notification_type) - Notification category
- `title` (VARCHAR) - Notification title
- `message` (TEXT) - Notification message
- `data` (JSONB) - Additional structured data
- `is_read` (BOOLEAN) - Read status
- `created_at` (TIMESTAMP) - Notification time

**Indexes:**
- `idx_notifications_user_id` - User's notifications
- `idx_notifications_is_read` - Read/unread filtering
- `idx_notifications_created_at` - Recent notifications
- `idx_notifications_user_unread` - Composite for unread count
- `idx_notifications_type` - Type filtering

**Foreign Keys:**
- `user_id` -> users(id) - ON DELETE CASCADE

---

### 14. activity_logs

**Purpose:** Comprehensive audit trail for all user actions.

**Columns:**
- `id` (UUID, PK) - Unique identifier
- `user_id` (UUID, FK) - User who performed action
- `action` (VARCHAR) - Action type (e.g., 'order_created', 'status_changed')
- `entity_type` (VARCHAR) - Type of entity affected
- `entity_id` (UUID) - ID of affected entity
- `details` (JSONB) - Additional action details
- `ip_address` (VARCHAR) - User's IP address
- `created_at` (TIMESTAMP) - Action timestamp

**Indexes:**
- `idx_activity_logs_user_id` - User's activity
- `idx_activity_logs_action` - Action filtering
- `idx_activity_logs_entity` - Entity-based queries
- `idx_activity_logs_created_at` - Recent activity
- `idx_activity_logs_user_created` - User activity timeline

**Foreign Keys:**
- `user_id` -> users(id) - ON DELETE SET NULL

---

### 15. sessions

**Purpose:** Store JWT refresh tokens for authentication.

**Columns:**
- `id` (UUID, PK) - Unique identifier
- `user_id` (UUID, FK) - User who owns the session
- `refresh_token` (VARCHAR, UNIQUE) - JWT refresh token
- `expires_at` (TIMESTAMP) - Token expiration time
- `created_at` (TIMESTAMP) - Session creation time

**Indexes:**
- `idx_sessions_user_id` - User's sessions
- `idx_sessions_refresh_token` - Token lookup
- `idx_sessions_expires_at` - Cleanup expired tokens

**Foreign Keys:**
- `user_id` -> users(id) - ON DELETE CASCADE

---

## Relationships

### One-to-Many Relationships

1. **customers -> orders**
   - One customer can have many orders
   - FK: orders.customer_id -> customers.id
   - ON DELETE: RESTRICT (prevent deleting customers with orders)

2. **users -> orders (as rep)**
   - One customer rep can be assigned to many orders
   - FK: orders.assigned_rep_id -> users.id
   - ON DELETE: SET NULL (unassign if user deleted)

3. **users -> orders (as agent)**
   - One delivery agent can be assigned to many orders
   - FK: orders.assigned_agent_id -> users.id
   - ON DELETE: SET NULL (unassign if user deleted)

4. **orders -> order_history**
   - One order has many history entries
   - FK: order_history.order_id -> orders.id
   - ON DELETE: CASCADE (delete history when order deleted)

5. **orders -> deliveries**
   - One order can have one delivery record (but modeled as one-to-many for flexibility)
   - FK: deliveries.order_id -> orders.id
   - ON DELETE: CASCADE

6. **users -> deliveries (as agent)**
   - One agent can have many deliveries
   - FK: deliveries.agent_id -> users.id
   - ON DELETE: RESTRICT (prevent deleting agents with deliveries)

7. **users -> expenses**
   - One user can record many expenses
   - FK: expenses.recorded_by_user_id -> users.id
   - ON DELETE: SET NULL

8. **orders -> financial_transactions**
   - One order can have multiple transactions (payment, refund, etc.)
   - FK: financial_transactions.order_id -> orders.id
   - ON DELETE: SET NULL

9. **users -> financial_transactions**
   - One user can record many transactions
   - FK: financial_transactions.recorded_by_user_id -> users.id
   - ON DELETE: SET NULL

10. **workflows -> workflow_executions**
    - One workflow can have many executions
    - FK: workflow_executions.workflow_id -> workflows.id
    - ON DELETE: CASCADE

11. **orders -> workflow_executions**
    - One order can trigger many workflow executions
    - FK: workflow_executions.order_id -> orders.id
    - ON DELETE: SET NULL

12. **customers -> workflow_executions**
    - One customer can trigger many workflow executions
    - FK: workflow_executions.customer_id -> customers.id
    - ON DELETE: SET NULL

13. **webhooks -> webhook_logs**
    - One webhook config has many log entries
    - FK: webhook_logs.webhook_id -> webhooks.id
    - ON DELETE: SET NULL

14. **orders -> webhook_logs**
    - One order can be created from one webhook
    - FK: webhook_logs.order_created_id -> orders.id
    - ON DELETE: SET NULL

15. **users -> notifications**
    - One user can have many notifications
    - FK: notifications.user_id -> users.id
    - ON DELETE: CASCADE

16. **users -> activity_logs**
    - One user can have many activity log entries
    - FK: activity_logs.user_id -> users.id
    - ON DELETE: SET NULL

17. **users -> sessions**
    - One user can have many sessions
    - FK: sessions.user_id -> users.id
    - ON DELETE: CASCADE

18. **users -> workflows (as creator)**
    - One user can create many workflows
    - FK: workflows.created_by_user_id -> users.id
    - ON DELETE: SET NULL

---

## Indexes

### Index Strategy

Indexes are created based on these principles:

1. **Foreign Keys:** All foreign key columns have indexes for join performance
2. **Frequently Filtered Fields:** Status, role, is_active, dates
3. **Sort Fields:** created_at, updated_at, dates (DESC for recent-first)
4. **Unique Constraints:** email, order_number, SKU, refresh_token
5. **Composite Indexes:** Common query patterns (status + date, user + status)
6. **JSONB Fields:** GIN indexes for searching within JSON structures
7. **Full-Text Search:** GIN indexes with tsvector for text search

### Critical Indexes for Performance

#### Orders Table
```sql
-- Most important for dashboard queries
idx_orders_status_created       -- Status filter + sort by date
idx_orders_agent_status         -- Agent's active orders
idx_orders_rep_status           -- Rep's active orders
idx_orders_area_status          -- Area-based routing
```

#### Customers Table
```sql
-- Customer analytics and search
idx_customers_phone             -- Primary lookup method
idx_customers_area              -- Delivery routing
idx_customers_tags              -- Segmentation queries
idx_customers_total_spent       -- VIP customer identification
```

#### Activity Logs
```sql
-- Audit trail queries
idx_activity_logs_user_created  -- User timeline
idx_activity_logs_entity        -- Entity history
```

#### Notifications
```sql
-- Real-time notification delivery
idx_notifications_user_unread   -- Unread count (composite)
```

### JSONB Indexes (GIN)

GIN (Generalized Inverted Index) indexes enable fast searching within JSONB fields:

- `customers.tags` - Customer segmentation
- `products.variants` - Variant searches
- `orders.items` - Item searches
- `workflows.trigger_config` - Workflow configuration queries
- `webhook_logs.request_payload` - Webhook debugging

---

## Triggers

### 1. updated_at Trigger

**Function:** `update_updated_at_column()`

**Purpose:** Automatically update the `updated_at` timestamp whenever a record is modified.

**Applied to:**
- users
- customers
- products
- orders
- deliveries
- workflows
- webhooks

**Usage Example:**
```sql
-- Automatically updates updated_at when order is modified
UPDATE orders SET status = 'delivered' WHERE id = '...';
-- updated_at is automatically set to CURRENT_TIMESTAMP
```

---

### 2. Customer Statistics Trigger

**Function:** `update_customer_stats()`

**Purpose:** Automatically recalculate customer metrics when orders change.

**Applied to:** orders (AFTER INSERT OR UPDATE)

**Updates:**
- `total_orders` - Count of non-cancelled orders
- `total_spent` - Sum of delivered & collected orders
- `return_rate` - Percentage of returned orders

**Usage Example:**
```sql
-- When order is delivered, customer's total_spent is automatically updated
UPDATE orders SET status = 'delivered', payment_status = 'collected'
WHERE id = '...';
-- Customer's statistics are recalculated automatically
```

---

### 3. Order Status History Trigger

**Function:** `log_order_status_change()`

**Purpose:** Automatically create audit trail entries when order status changes.

**Applied to:** orders (AFTER UPDATE)

**Creates entry in:** order_history table

**Usage Example:**
```sql
-- Status change is automatically logged
UPDATE orders SET status = 'out_for_delivery' WHERE id = '...';
-- New record in order_history with old_status and new_status
```

---

## Views

### 1. order_details_view

**Purpose:** Simplified view for displaying order information with customer and assigned user details.

**Includes:**
- Order basic info (number, status, priority, amount)
- Customer details (name, phone, email)
- Assigned rep name
- Assigned agent name and availability

**Usage:**
```sql
SELECT * FROM order_details_view
WHERE status = 'out_for_delivery'
ORDER BY created_at DESC;
```

---

### 2. agent_performance_view

**Purpose:** Delivery agent performance metrics.

**Includes:**
- Agent details
- Total deliveries
- Average rating
- Completed deliveries count
- Successful orders count

**Usage:**
```sql
SELECT * FROM agent_performance_view
ORDER BY average_rating DESC, total_deliveries DESC;
```

---

### 3. daily_financial_summary

**Purpose:** Daily financial summary for reporting.

**Includes:**
- Total revenue
- Total expenses
- Total refunds
- Net profit

**Usage:**
```sql
SELECT * FROM daily_financial_summary
WHERE date >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY date DESC;
```

---

## JSONB Field Structures

### users.permissions

Structure for granular role-based permissions:

```json
{
  "orders": {
    "view": true,
    "create": true,
    "edit": true,
    "delete": false,
    "assign": true
  },
  "customers": {
    "view": true,
    "create": true,
    "edit": true,
    "delete": false
  },
  "products": {
    "view": true,
    "create": false,
    "edit": false,
    "delete": false
  },
  "financial": {
    "view": false,
    "create": false,
    "edit": false,
    "export": false
  },
  "workflows": {
    "view": true,
    "create": false,
    "edit": false,
    "delete": false
  }
}
```

---

### customers.tags

Array of tag objects for customer segmentation:

```json
[
  {
    "id": "vip",
    "label": "VIP Customer",
    "color": "#FFD700"
  },
  {
    "id": "frequent_returner",
    "label": "Frequent Returns",
    "color": "#FF0000"
  }
]
```

---

### products.variants

Array of product variant objects:

```json
[
  {
    "id": "var-1",
    "name": "Size: Large, Color: Red",
    "sku": "PROD-001-LG-RED",
    "price": 29.99,
    "stock": 15,
    "attributes": {
      "size": "Large",
      "color": "Red"
    }
  },
  {
    "id": "var-2",
    "name": "Size: Medium, Color: Blue",
    "sku": "PROD-001-MD-BLUE",
    "price": 27.99,
    "stock": 8,
    "attributes": {
      "size": "Medium",
      "color": "Blue"
    }
  }
]
```

---

### products.images

Array of image URLs with metadata:

```json
[
  {
    "url": "https://cdn.example.com/products/prod-001-main.jpg",
    "alt": "Product main view",
    "is_primary": true,
    "order": 1
  },
  {
    "url": "https://cdn.example.com/products/prod-001-side.jpg",
    "alt": "Product side view",
    "is_primary": false,
    "order": 2
  }
]
```

---

### orders.items

Array of order line items:

```json
[
  {
    "product_id": "uuid-here",
    "variant_id": "var-1",
    "sku": "PROD-001-LG-RED",
    "name": "Product Name - Large/Red",
    "quantity": 2,
    "unit_price": 29.99,
    "total": 59.98,
    "notes": "Gift wrap requested"
  },
  {
    "product_id": "uuid-here-2",
    "variant_id": null,
    "sku": "PROD-002",
    "name": "Another Product",
    "quantity": 1,
    "unit_price": 15.00,
    "total": 15.00,
    "notes": null
  }
]
```

---

### orders.delivery_proof

Delivery proof of delivery information:

```json
{
  "signature_url": "https://cdn.example.com/signatures/sig-123.png",
  "photo_url": "https://cdn.example.com/deliveries/del-123.jpg",
  "gps_location": {
    "latitude": 40.7128,
    "longitude": -74.0060
  },
  "timestamp": "2025-10-07T14:30:00Z",
  "notes": "Delivered to front door, customer not home"
}
```

---

### deliveries.route_data

GPS route tracking information:

```json
{
  "waypoints": [
    {
      "latitude": 40.7128,
      "longitude": -74.0060,
      "timestamp": "2025-10-07T13:00:00Z"
    },
    {
      "latitude": 40.7138,
      "longitude": -74.0070,
      "timestamp": "2025-10-07T13:05:00Z"
    }
  ],
  "distance_km": 8.5,
  "duration_minutes": 35
}
```

---

### deliveries.proof_of_delivery

Comprehensive delivery proof:

```json
{
  "method": "signature",
  "signature_url": "https://cdn.example.com/signatures/sig-123.png",
  "photo_url": "https://cdn.example.com/deliveries/del-123.jpg",
  "recipient_name": "John Doe",
  "recipient_relation": "Self",
  "gps_location": {
    "latitude": 40.7128,
    "longitude": -74.0060
  },
  "timestamp": "2025-10-07T14:30:00Z",
  "device_id": "agent-device-123"
}
```

---

### workflows.trigger_config

Configuration for workflow triggers:

```json
{
  "type": "order_status",
  "conditions": {
    "status": ["delivered"],
    "payment_status": ["collected"],
    "min_order_value": 100
  }
}
```

Or for webhook triggers:

```json
{
  "type": "webhook",
  "webhook_id": "uuid-here",
  "event_types": ["order.created", "order.updated"]
}
```

Or for time-based triggers:

```json
{
  "type": "time_based",
  "schedule": "0 9 * * *",
  "timezone": "America/New_York"
}
```

---

### workflows.workflow_steps

Array of workflow step definitions:

```json
[
  {
    "id": "step-1",
    "type": "send_notification",
    "config": {
      "target": "customer",
      "template": "order_delivered",
      "channel": "sms"
    },
    "order": 1
  },
  {
    "id": "step-2",
    "type": "update_customer_tag",
    "config": {
      "tag_id": "vip",
      "action": "add",
      "condition": "total_orders >= 10"
    },
    "order": 2
  },
  {
    "id": "step-3",
    "type": "create_task",
    "config": {
      "assigned_to": "customer_rep",
      "title": "Follow up with customer",
      "due_days": 3
    },
    "order": 3
  }
]
```

---

### workflow_executions.steps_completed

Array tracking which steps were executed:

```json
[
  {
    "step_id": "step-1",
    "status": "completed",
    "started_at": "2025-10-07T14:30:00Z",
    "completed_at": "2025-10-07T14:30:05Z",
    "output": {
      "message_id": "msg-123",
      "status": "sent"
    }
  },
  {
    "step_id": "step-2",
    "status": "completed",
    "started_at": "2025-10-07T14:30:05Z",
    "completed_at": "2025-10-07T14:30:06Z",
    "output": {
      "tag_added": true
    }
  }
]
```

---

### workflow_executions.error_log

Array of errors encountered during execution:

```json
[
  {
    "step_id": "step-1",
    "error": "SMS delivery failed",
    "error_code": "SMS_DELIVERY_FAILED",
    "details": {
      "provider_error": "Invalid phone number",
      "phone": "+1234567890"
    },
    "timestamp": "2025-10-07T14:30:05Z"
  }
]
```

---

### webhooks.field_mapping

Mapping between webhook fields and internal fields:

```json
{
  "customer": {
    "name": "customer.full_name",
    "email": "customer.email",
    "phone": "customer.phone",
    "address": "shipping_address.address1",
    "city": "shipping_address.city",
    "postal_code": "shipping_address.zip"
  },
  "order": {
    "order_number": "order_number",
    "total": "total_price",
    "subtotal": "subtotal_price",
    "items": "line_items"
  },
  "items": {
    "name": "title",
    "sku": "sku",
    "quantity": "quantity",
    "price": "price"
  }
}
```

---

### webhook_logs.request_payload

Full webhook request payload (structure varies by source):

```json
{
  "id": 123456789,
  "order_number": "ORD-2025-001",
  "email": "customer@example.com",
  "created_at": "2025-10-07T14:00:00Z",
  "total_price": "129.99",
  "subtotal_price": "119.99",
  "total_tax": "10.00",
  "currency": "USD",
  "financial_status": "pending",
  "customer": {
    "id": 987654321,
    "email": "customer@example.com",
    "first_name": "John",
    "last_name": "Doe",
    "phone": "+1234567890"
  },
  "shipping_address": {
    "address1": "123 Main St",
    "address2": "Apt 4B",
    "city": "New York",
    "province": "NY",
    "zip": "10001",
    "country": "USA"
  },
  "line_items": [
    {
      "id": 111222333,
      "title": "Product Name",
      "sku": "PROD-001",
      "quantity": 2,
      "price": "59.99"
    }
  ]
}
```

---

### notifications.data

Additional structured data for notifications:

```json
{
  "order_id": "uuid-here",
  "order_number": "ORD-2025-001",
  "action": "status_changed",
  "old_status": "confirmed",
  "new_status": "out_for_delivery",
  "link": "/orders/uuid-here"
}
```

---

### activity_logs.details

Activity-specific details:

```json
{
  "action": "order_status_changed",
  "changes": {
    "status": {
      "old": "confirmed",
      "new": "out_for_delivery"
    },
    "assigned_agent_id": {
      "old": null,
      "new": "agent-uuid"
    }
  },
  "user_agent": "Mozilla/5.0...",
  "session_id": "session-uuid"
}
```

---

## Query Optimization Notes

### Dashboard Queries

#### 1. Recent Orders Dashboard

```sql
-- Optimized query for dashboard recent orders
SELECT
  o.id, o.order_number, o.status, o.priority, o.total_amount,
  o.created_at, c.full_name, c.phone
FROM orders o
INNER JOIN customers c ON o.customer_id = c.id
WHERE o.status IN ('new', 'confirmation_pending', 'confirmed')
ORDER BY o.priority DESC, o.created_at DESC
LIMIT 50;

-- Uses: idx_orders_status_created
```

---

#### 2. Agent's Active Deliveries

```sql
-- Get delivery agent's current assignments
SELECT
  o.id, o.order_number, o.delivery_address, o.delivery_area,
  o.customer_notes, c.phone, o.total_amount
FROM orders o
INNER JOIN customers c ON o.customer_id = c.id
WHERE o.assigned_agent_id = $1
  AND o.status IN ('ready_for_pickup', 'out_for_delivery')
ORDER BY o.priority DESC, o.created_at ASC;

-- Uses: idx_orders_agent_status
```

---

#### 3. Area-Based Order Routing

```sql
-- Find unassigned orders in specific area
SELECT
  o.id, o.order_number, o.delivery_address, o.delivery_area,
  o.priority, o.total_amount, c.full_name, c.phone
FROM orders o
INNER JOIN customers c ON o.customer_id = c.id
WHERE o.delivery_area = $1
  AND o.status = 'ready_for_pickup'
  AND o.assigned_agent_id IS NULL
ORDER BY o.priority DESC, o.created_at ASC;

-- Uses: idx_orders_area_status
```

---

#### 4. Customer Order History

```sql
-- Get customer's complete order history
SELECT
  o.id, o.order_number, o.status, o.total_amount,
  o.created_at, o.delivered_at
FROM orders o
WHERE o.customer_id = $1
ORDER BY o.created_at DESC
LIMIT 100;

-- Uses: idx_orders_customer_id
```

---

#### 5. Financial Daily Summary

```sql
-- Today's financial summary
SELECT
  COUNT(*) FILTER (WHERE status = 'delivered') as delivered_count,
  SUM(total_amount) FILTER (WHERE status = 'delivered' AND payment_status = 'collected') as collected_amount,
  SUM(total_amount) FILTER (WHERE status = 'delivered' AND payment_status = 'pending') as pending_amount,
  COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled_count,
  COUNT(*) FILTER (WHERE status = 'returned') as returned_count
FROM orders
WHERE DATE(created_at) = CURRENT_DATE;

-- Uses: idx_orders_created_at
```

---

#### 6. Low Stock Products

```sql
-- Products needing restock
SELECT
  id, name, sku, category, stock_quantity, low_stock_threshold
FROM products
WHERE is_active = true
  AND stock_quantity <= low_stock_threshold
ORDER BY stock_quantity ASC;

-- Uses: idx_products_is_active, idx_products_stock_quantity
```

---

#### 7. Agent Performance Report

```sql
-- Agent performance for date range
SELECT * FROM agent_performance_view
WHERE agent_id = $1
  AND total_deliveries > 0
ORDER BY average_rating DESC;

-- Uses view: agent_performance_view
```

---

#### 8. Customer Segmentation by Tags

```sql
-- Find VIP customers in specific area
SELECT
  c.id, c.full_name, c.phone, c.area, c.total_orders, c.total_spent
FROM customers c
WHERE c.tags @> '[{"id": "vip"}]'::jsonb
  AND c.area = $1
ORDER BY c.total_spent DESC;

-- Uses: idx_customers_tags (GIN), idx_customers_area
```

---

#### 9. Order Item Search

```sql
-- Find orders containing specific product
SELECT DISTINCT
  o.id, o.order_number, o.status, o.created_at,
  c.full_name
FROM orders o
INNER JOIN customers c ON o.customer_id = c.id
WHERE o.items @> '[{"sku": "PROD-001"}]'::jsonb
ORDER BY o.created_at DESC;

-- Uses: idx_orders_items (GIN)
```

---

#### 10. Unread Notifications Count

```sql
-- Get user's unread notification count
SELECT COUNT(*)
FROM notifications
WHERE user_id = $1
  AND is_read = false;

-- Uses: idx_notifications_user_unread
```

---

### Performance Tips

1. **Always filter by indexed columns first** - Start WHERE clauses with indexed columns
2. **Use composite indexes** - For queries that filter by multiple columns
3. **Limit result sets** - Use LIMIT for pagination
4. **Use EXPLAIN ANALYZE** - Check query plans for optimization opportunities
5. **Avoid SELECT *** - Only select needed columns
6. **Use JOINs efficiently** - Inner joins on indexed foreign keys
7. **JSONB queries** - Use @>, ?, ?& operators with GIN indexes
8. **Date range queries** - Use >= and < instead of BETWEEN for better index usage
9. **Partial indexes** - Consider partial indexes for commonly filtered subsets
10. **Regular VACUUM** - Keep statistics updated for query planner

---

### Maintenance Queries

#### Clean Up Old Sessions

```sql
-- Delete expired sessions
DELETE FROM sessions
WHERE expires_at < CURRENT_TIMESTAMP;
```

#### Archive Old Webhook Logs

```sql
-- Archive webhook logs older than 90 days
DELETE FROM webhook_logs
WHERE created_at < CURRENT_DATE - INTERVAL '90 days';
```

#### Find Slow Queries

```sql
-- Enable query logging in postgresql.conf:
-- log_min_duration_statement = 1000  # Log queries taking > 1 second
```

---

## Security Considerations

1. **Password Storage:** Always hash passwords using bcrypt (cost factor 10+)
2. **API Keys:** Encrypt webhook API keys and secret keys at rest
3. **Row-Level Security:** Consider implementing RLS for multi-tenant scenarios
4. **SQL Injection:** Always use parameterized queries
5. **Sensitive Data:** Consider encrypting customer addresses and phone numbers
6. **Audit Trail:** Activity logs provide complete audit trail
7. **Access Control:** Use permissions JSONB field for granular access control
8. **Session Management:** Regularly clean up expired sessions
9. **IP Logging:** Track IP addresses for security monitoring
10. **Backup Strategy:** Regular backups with point-in-time recovery

---

## Migration Notes

### Running the Migration

```bash
# Using psql
psql -U username -d database_name -f 001_initial_schema.sql

# Using Node.js with pg
const { Pool } = require('pg');
const fs = require('fs');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const sql = fs.readFileSync('001_initial_schema.sql', 'utf8');
await pool.query(sql);
```

### Rollback Plan

To rollback this migration, drop all tables in reverse dependency order:

```sql
DROP VIEW IF EXISTS daily_financial_summary CASCADE;
DROP VIEW IF EXISTS agent_performance_view CASCADE;
DROP VIEW IF EXISTS order_details_view CASCADE;

DROP TABLE IF EXISTS sessions CASCADE;
DROP TABLE IF EXISTS activity_logs CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS webhook_logs CASCADE;
DROP TABLE IF EXISTS webhooks CASCADE;
DROP TABLE IF EXISTS workflow_executions CASCADE;
DROP TABLE IF EXISTS workflows CASCADE;
DROP TABLE IF EXISTS financial_transactions CASCADE;
DROP TABLE IF EXISTS expenses CASCADE;
DROP TABLE IF EXISTS deliveries CASCADE;
DROP TABLE IF EXISTS order_history CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS customers CASCADE;
DROP TABLE IF EXISTS users CASCADE;

DROP TYPE IF EXISTS notification_type CASCADE;
DROP TYPE IF EXISTS webhook_source CASCADE;
DROP TYPE IF EXISTS execution_status CASCADE;
DROP TYPE IF EXISTS workflow_trigger CASCADE;
DROP TYPE IF EXISTS transaction_type CASCADE;
DROP TYPE IF EXISTS order_source CASCADE;
DROP TYPE IF EXISTS payment_method CASCADE;
DROP TYPE IF EXISTS payment_status CASCADE;
DROP TYPE IF EXISTS priority_level CASCADE;
DROP TYPE IF EXISTS order_status CASCADE;
DROP TYPE IF EXISTS availability_status CASCADE;
DROP TYPE IF EXISTS user_role CASCADE;

DROP EXTENSION IF EXISTS "uuid-ossp";
```

---

## Future Enhancements

Potential schema improvements for future versions:

1. **Soft Deletes:** Add `deleted_at` timestamp for soft delete functionality
2. **Multi-Warehouse:** Add warehouse/location table for inventory management
3. **Product Categories:** Separate category table with hierarchical structure
4. **Customer Addresses:** Separate addresses table for multiple addresses per customer
5. **Discount Codes:** Promo code and discount management
6. **Shipping Zones:** Dedicated shipping zone configuration table
7. **Return Management:** Enhanced return/exchange workflow tables
8. **Inventory Tracking:** Detailed inventory movement logs
9. **Commission Tracking:** Agent commission calculation tables
10. **Analytics Tables:** Pre-aggregated analytics tables for reporting

---

## Contact & Support

For questions about this schema or suggestions for improvements, please contact the database team.

**Version:** 1.0
**Last Updated:** 2025-10-07
**Maintained By:** Database Architecture Team
