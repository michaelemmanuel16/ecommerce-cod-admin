# CodAdmin SaaS — Getting Started Guide

Welcome to **CodAdmin**, the Cash-on-Delivery order management platform built for e-commerce teams in Ghana and Nigeria. This guide walks you through everything you need to go from sign-up to fully operational.

---

## Table of Contents

1. [Creating Your Account](#creating-your-account)
2. [Business Setup (Onboarding Wizard)](#business-setup-onboarding-wizard)
3. [Inviting Your Team](#inviting-your-team)
4. [Understanding Your Dashboard](#understanding-your-dashboard)
5. [Managing Orders](#managing-orders)
6. [Products & Inventory](#products--inventory)
7. [Customer Management](#customer-management)
8. [Delivery Agents](#delivery-agents)
9. [Workflow Automation](#workflow-automation)
10. [Analytics & Reporting](#analytics--reporting)
11. [Billing & Plans](#billing--plans)
12. [Settings](#settings)
13. [Getting Help](#getting-help)

---

## Creating Your Account

1. Go to **[codadminpro.com](https://codadminpro.com)** and click **Get Started**.
2. Enter your name, email address, and a strong password.
3. Click **Create Account** — you will receive a confirmation email.
4. Confirm your email, then log in.

> **Trial period:** Every new account starts on a **14-day free trial** of the Pro plan. No credit card required. Your data is preserved when you choose a paid plan.

---

## Business Setup (Onboarding Wizard)

After your first login, a two-step setup wizard collects the details CodAdmin needs to configure your workspace.

### Step 1 — Country & Currency

| Field | Description |
|-------|-------------|
| **Country** | Where your business operates (Ghana or Nigeria). This sets default currency and regional formatting. |
| **Currency** | Auto-filled from your country selection (GHS or NGN). Can be changed later in Settings. |

### Step 2 — Business Details *(optional)*

| Field | Description |
|-------|-------------|
| Business Email | Public contact email shown on customer receipts |
| Business Phone | Support number for your customers |
| Business Address | Physical address for invoicing |
| Tax ID | VAT or TIN number (Ghana: TINGH / Nigeria: FIRS TIN) |

Click **Finish Setup** to enter your dashboard.

> You can update all these details later under **Settings → Business Settings**.

---

## Inviting Your Team

CodAdmin supports role-based team access:

| Role | What they can do |
|------|-----------------|
| **Admin** | Full access to all features, settings, and team management |
| **Manager** | Manage orders, products, customers. Cannot change billing or team roles. |
| **Customer Rep** | Process orders, view customers. No access to financial data or settings. |
| **Delivery Agent** | Mobile-optimised view. Mark orders delivered/returned. |

### To invite a team member:

1. Navigate to **Settings → Team**.
2. Click **Invite User**.
3. Enter their email address and select their role.
4. Click **Send Invite** — they receive an email with a sign-in link.

> Invited users are scoped to your workspace only. They cannot see other tenants' data.

---

## Understanding Your Dashboard

Your dashboard shows a live summary of your business:

- **Pending Orders** — orders awaiting processing
- **Out for Delivery** — orders assigned to delivery agents today
- **Delivered Today** — completed deliveries (last 24 hours)
- **Revenue This Month** — confirmed delivered order value
- **Delivery Rate** — percentage of orders successfully delivered (trailing 30 days)

The dashboard refreshes automatically. Use the **date range picker** in Analytics for historical trends.

---

## Managing Orders

### Creating an order

1. Go to **Orders → New Order**.
2. Fill in customer name, phone, delivery address, and select products.
3. Set the **COD amount** (amount to collect on delivery).
4. Assign a delivery agent (optional at creation).
5. Click **Create Order**.

### Order statuses

| Status | Meaning |
|--------|---------|
| **Pending** | Order received, not yet dispatched |
| **Processing** | Confirmed, being prepared |
| **Out for Delivery** | Assigned to an agent, en route |
| **Delivered** | Agent confirmed delivery, COD collected |
| **Failed Delivery** | Delivery attempted but unsuccessful |
| **Returned** | Item returned to warehouse |
| **Cancelled** | Order cancelled |

### Bulk import

Import orders from a spreadsheet using the **Import Orders** button on the Orders page. Download the template from the same page to ensure the correct column format.

---

## Products & Inventory

- **Products → New Product**: Add a product with name, SKU, price, and stock quantity.
- **Low stock alerts**: Set a minimum stock threshold per product — you'll be notified when stock drops below it.
- **Collections**: Group products into categories for faster order entry.

---

## Customer Management

Every customer is automatically created when their first order is placed. From the **Customers** page you can:

- View all orders for a customer
- See delivery success rate per customer
- Add notes to a customer's profile
- Flag a customer (e.g. repeat failed deliveries)

---

## Delivery Agents

### Adding a delivery agent

1. Go to **Delivery Agents → Add Agent**.
2. Enter their name and phone number.
3. Optionally assign them a permanent zone or route.

### Agent view

Delivery agents can log in and see only their assigned orders. They can:
- Mark orders as **Delivered** or **Failed Delivery**
- Record the COD amount collected

### Earnings & reconciliation

View agent earnings under **Financial → Agent Earnings**. The reconciliation screen shows expected vs actual COD collected per agent per day.

---

## Workflow Automation

Workflows let you automate repetitive tasks using triggers and actions.

**Example workflows:**
- When an order status changes to *Out for Delivery* → Send SMS to customer
- When a delivery fails twice → Flag order for review
- When a new order is created → Assign to the agent with the lowest current load

### Creating a workflow

1. Navigate to **Workflows → New Workflow**.
2. Set a **Trigger** (e.g. order status change).
3. Add one or more **Conditions** (optional).
4. Add one or more **Actions** (SMS, email, status update, webhook).
5. Click **Save & Activate**.

---

## Analytics & Reporting

Access reports from the **Analytics** page:

| Report | Description |
|--------|-------------|
| **Order Volume** | Daily/weekly/monthly order counts |
| **Delivery Rate** | Success vs failed/returned over time |
| **Revenue** | Confirmed COD collected |
| **Agent Performance** | Deliveries and success rate per agent |
| **Product Sales** | Units sold per product |

> Analytics is available on **Starter** and **Pro** plans.

---

## Billing & Plans

### Available plans

| Plan | Monthly Cost | Orders/Month | Users | Key Features |
|------|-------------|-------------|-------|--------------|
| **Free** | GHS 0 | 100 | 3 | Core order management |
| **Starter** | GHS 299 | 1,000 | 10 | + Analytics, webhooks |
| **Pro** | GHS 799 | Unlimited | Unlimited | + API access, priority support |

### Upgrading

1. Go to **Settings → Billing & Plans**.
2. Click **Upgrade** on the plan you want.
3. Your plan is activated immediately (manual billing — contact support to pay).

### Trial

Your 14-day Pro trial gives you full Pro access. At the end of the trial, you are automatically moved to the Free plan unless you upgrade. Your data is never deleted when downgrading.

---

## Settings

| Section | What you can configure |
|---------|----------------------|
| **Business Settings** | Company name, email, phone, address, currency |
| **Team** | Invite, remove, or change roles for team members |
| **Billing & Plans** | View current plan, usage, upgrade |
| **Integrations** | WhatsApp, webhooks, checkout form builder |
| **Notifications** | Email notification preferences |
| **Security** | Change password, active sessions |
| **Delete Account** | Permanently remove your workspace and all data |

---

## Getting Help

- **In-app help**: Click the **?** icon in the top-right corner of any page.
- **Email support**: support@codadminpro.com
- **Priority support**: Pro plan customers receive responses within 4 business hours.
- **Documentation**: [docs.codadminpro.com](https://docs.codadminpro.com) *(coming soon)*

---

*Last updated: April 2026 — CodAdmin v2.0.0*
