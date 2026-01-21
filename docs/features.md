# E-Commerce COD Admin Dashboard Features

This document provides a comprehensive overview of the features present in the application, as of the current development status.

---

## 1. Core Order Management
The heart of the application, designed for high-volume order processing.

- **Unified Order List**: A high-performance list view with advanced filtering, searching, and customizable columns.
- **Order Kanban (Experimental)**: A visual board for tracking orders through status stages (currently deactivated).
- **Bulk Import Engine**: Robust CSV/XLSX import tool with data validation and duplicate detection (by phone, address, or product).
- **Order Lifecycle Tracking**: Full management of order statuses:
    - `pending_confirmation` → `confirmed` → `preparing` → `ready_for_pickup` → `out_for_delivery` → `delivered`
    - Handling for `cancelled`, `returned`, and `failed_delivery`.
- **Order Audit Trail**: A complete history of every status change, including who made the change and when.
- **Detailed Order View**: Deep-dive into order items, customer history, delivery details, and internal notes.

## 2. Financial Management & GL
A comprehensive suite for tracking cash flow and ensuring agent accountability.

- **Agent Collections**: System for tracking COD cash collected by delivery agents.
- **Agent Deposits**: Management of cash deposits made by agents back to the business. (See [detailed doc](features/agent-deposit-reconciliation.md))
- **Agent Blocking**: Automated and manual restriction of agents with overdue collections. (See [detailed doc](features/agent-blocking.md))
- **Financial Reconciliation Dashboard**: Real-time monitoring of collected vs. pending COD, agent balances, and settlement status.
- **Expense Tracking**: Categorized recording of operational costs (e.g., fuel, packaging) with support for receipt uploads.
- **General Ledger (GL)**: A sophisticated double-entry accounting system with:
    - Chart of Accounts (Assets, Liabilities, Equity, Revenue, Expenses).
    - Automated Journal Entries triggered by operations (deliveries, deposits, expenses).
    - Journal Entry Voids and Reversals.
- **Profit & Loss Analysis**: High-level reports on business profitability.
- **Payout Management**: Tracking commissions and payments to sales reps and agents.

## 3. Workflow Automation
A powerful, rule-based engine to reduce manual overhead.

- **Visual Workflow Builder**: An interactive editor (using React Flow) to design automation logic.
- **Triggers**: Automated actions triggered by events: `order_created`, `status_change`, `payment_received`, `time_based`, or `manual`.
- **Actions**: Multi-step automated tasks:
    - **Notifications**: Send SMS or Email.
    - **Logic**: Assign agents, add tags, update order fields.
    - **Integration**: Send HTTP Webhook requests to external systems.
- **Conditional Branching**: Logic paths based on order total, shipping area, product weights, etc.
- **Execution Tracking**: Monitor the status and history of every workflow run.

## 4. Dashboard & Real-Time Analytics
Instant visibility into business performance.

- **Order Fulfillment Trend**: Real-time charts visualizing the gap between "Created" and "Delivered" orders.
- **Sales Rep Leaderboard**: Performance tracking for confirmation success rates and call metrics.
- **Real-Time Notifications**: Live bi-directional updates (via Socket.io) for new orders and status changes without page refreshes.
- **Operational KPIs**: Quick-view cards for critical metrics like today's revenue, pending orders, and RTO (Return-to-Origin) rates.
- **Customer Rep Dashboard**: Specialized view for teams managing customer calls and confirmations.

## 5. Public Checkout Form Builder
Convert social media traffic directly into COD orders.

- **No-Code Form Construction**: Builder to create custom, single-product landing pages.
- **Multi-Package Support**: Define upsells, bundles, and "popular" item highlights.
- **Regional Support**: Tailored for Ghana/Nigeria with region and city selection.
- **Public Checkout Pages**: Unauthenticated, embeddable forms for customers to place orders directly.
- **Form Analytics**: Tracking submissions and conversion rates.

## 6. CRM & Communication
Tools for managing relationships and verifying orders.

- **Customer Database**: Unified view of all customers, their order history, lifetime value (spent), and tags.
- **Call Management**: Logging system for "Call Center" operations:
    - Log outcomes: `confirmed`, `rescheduled`, `no_answer`, `cancelled`.
    - Track duration and sales rep performance.
- **Role-Based Access Control (RBAC)**: 7 distinct user roles:
    - `super_admin`, `admin`, `manager`, `sales_rep`, `inventory_manager`, `delivery_agent`, `accountant`.
- **In-App Notifications**: Real-time alerts for users regarding order updates or system events.

## 7. Product & Inventory
- **Product Catalog**: Manage SKUs, pricing, categories, and images.
- **Stock Management**: Track quantities and set low-stock thresholds for replenishment alerts.
- **Product Category Insights**: Analytics on top-performing product categories.

## 8. Integration & Infrastructure
- **Webhook System**: Receive data from external platforms (Shopify, WooCommerce, TikTok Ads).
- **External API Access**: Secure endpoints for 3rd-party integrations.
- **Developer Tools**:
    - Comprehensive Audit Logging for all system actions.
    - Database Health Monitoring and Automated Backups.
    - Performance Testing Scripts.
