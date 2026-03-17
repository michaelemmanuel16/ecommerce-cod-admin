# Product Requirements Document: Financial Management Module (Phase 1 & 2)

**Version:** 1.0
**Date:** January 13, 2026
**Author:** Product Manager
**Status:** Ready for Engineering Review

---

## 1. Executive Summary

### Product Overview

This PRD defines the implementation of a comprehensive financial management system for a Cash-on-Delivery (COD) e-commerce admin dashboard. The system introduces double-entry general ledger (GL) accounting, agent reconciliation workflows, and financial reporting capabilities to provide complete financial visibility and control.

### Background & Context

**Current State:**
- Order tracking and delivery management exist
- Basic transaction logging (pending → collected → deposited → reconciled)
- Limited financial visibility: no GL, no proper agent settlement tracking, no profitability analysis
- Manual reconciliation processes prone to discrepancies and delays
- No formal accounting structure for compliance or decision-making

**Business Problem:**
1. **Cash Visibility Gap:** Cannot track where money is at any given time (with agents, in bank, in transit)
2. **Agent Settlement Losses:** Delivery agents collect COD but settlement tracking is manual and error-prone
3. **Profitability Blindness:** Cannot determine true profit margins after all costs (COGS, delivery, returns)
4. **Compliance Risk:** No proper financial statements for tax reporting or accounting standards

### Objectives

| Objective | Success Metric | Target |
|-----------|----------------|--------|
| Complete cash visibility | 100% of cash tracked in GL accounts | Day 1 of Phase 1 launch |
| Agent settlement accuracy | Discrepancy rate < 2% | Within 30 days of launch |
| Profitability transparency | Gross margin calculated for 100% of delivered orders | Day 1 of Phase 2 launch |
| Financial statement generation | Balance Sheet & P&L available daily | Day 1 of Phase 2 launch |
| Agent settlement timeliness | 90% of collections deposited within 3 days | Within 60 days of launch |
| Automated reporting | Daily cash position emails sent to CFO/Accountant | Day 1 of Phase 2 launch |

### Scope

**Phase 1 - Foundation (In Scope):**
- Chart of Accounts (12-15 standard accounts)
- Double-entry general ledger system
- Automated GL entries for order lifecycle
- Agent reconciliation workflow (draft → verified → approved → deposited → reconciled)
- Agent balance tracking and aging
- Agent blocking mechanism for overdue settlements
- Deposit matching to collections

**Phase 2 - Visibility (In Scope):**
- Cash Flow Report (priority: cash in hand, in transit, expected, 30-day forecast)
- Agent Aging Report (0-1, 2-3, 4-7, 8+ day buckets)
- Profitability Analysis (by order, product, customer, region)
- Balance Sheet and Profit & Loss statements
- General Ledger viewer
- Automated email notifications (daily cash summary, overdue agents)
- Multi-format exports (PDF, CSV, Dashboard charts)

**Out of Scope (Future Phases):**
- Multi-currency support (design for but don't implement)
- Tax management and remittance
- Budgeting and forecasting beyond 30 days
- Integration with external accounting software (QuickBooks, Xero)
- Supplier/vendor management (Accounts Payable beyond expenses)
- Inventory cost methods (FIFO/LIFO)
- Commission automation for sales reps
- Payment gateway integration for prepayments

---

## 2. Problem Statement & User Personas

### Problem Definition

**For:** Business owners, accountants, and operations managers managing COD e-commerce
**Who:** Need complete financial visibility and control over cash flows
**The problem is:** Lack of formal accounting structure leads to cash leakage, settlement discrepancies, and inability to make data-driven financial decisions
**Which impacts:** Profitability, compliance, and scalability of the business
**A successful solution would:** Provide real-time cash position tracking, automated agent reconciliation, accurate profitability analysis, and standard financial reporting

### User Personas

#### Persona 1: Business Owner / CFO
- **Role:** Strategic financial oversight and decision-making
- **Goals:** Understand cash position, profitability, and business health at a glance
- **Pain Points:** Can't answer "how much cash do we have?" or "are we profitable?" without manual calculations
- **Needs:**
  - Dashboard with key financial KPIs
  - Cash flow forecast for planning
  - Profitability analysis to optimize product mix
  - Financial statements for investors/lenders
- **Technical Proficiency:** Medium (can use dashboards, export reports, but not create GL entries)
- **Access Level:** View all reports, approve major transactions

#### Persona 2: Accountant
- **Role:** Daily reconciliation, bookkeeping, and financial recording
- **Goals:** Ensure all transactions are accurately recorded, balanced, and reconciled
- **Pain Points:** Manual matching of agent collections to bank deposits is time-consuming and error-prone
- **Needs:**
  - Agent collection verification workflow
  - Deposit reconciliation tools
  - GL entry validation and review
  - Exception management (discrepancies, failed deliveries)
- **Technical Proficiency:** High (understands double-entry accounting, can create manual journal entries)
- **Access Level:** Verify collections, verify deposits, reconcile transactions, create manual GL entries

#### Persona 3: Operations Manager
- **Role:** Manage delivery agent performance and operations
- **Goals:** Ensure agents settle collections promptly and operations run smoothly
- **Pain Points:** Don't know which agents are holding cash for too long or have settlement issues
- **Needs:**
  - Agent aging report to identify overdue settlements
  - Agent performance dashboard
  - Ability to block/unblock agents based on settlement behavior
  - Alerts for overdue collections
- **Technical Proficiency:** Medium (can use dashboards and reports)
- **Access Level:** View agent balances, approve verified collections, block/unblock agents

#### Persona 4: Delivery Agent
- **Role:** Deliver orders and collect COD payments
- **Goals:** Understand how much cash they owe the company and when to deposit
- **Pain Points:** Unclear on current balance, don't receive reminders to settle
- **Needs:**
  - View own collections and deposits
  - See current balance owed
  - Submit deposits easily
  - Understand aging status
- **Technical Proficiency:** Low to Medium (mobile-first, simple interfaces)
- **Access Level:** View own data only, submit deposit records

### Use Cases

**UC-1: Order Delivered - Revenue Recognition**
1. Delivery agent marks order as delivered
2. System auto-creates draft agent collection for COD amount
3. System creates GL journal entry: Debit Cash in Transit, Credit Revenue, Debit COGS, Credit Inventory
4. Order marked as revenueRecognized = true
5. Agent balance updated: totalCollected += codAmount

**UC-2: Accountant Verifies Collection**
1. Accountant reviews list of draft collections
2. Verifies delivery proof matches COD amount
3. Approves or flags discrepancy
4. If approved: Collection status → verified, GL entry: Debit AR-Agents, Credit Cash in Transit

**UC-3: Agent Submits Deposit**
1. Agent deposits cash via mobile money and gets reference number
2. Agent submits deposit record with amount and reference
3. System creates deposit record with status = pending
4. Accountant verifies deposit matches bank records
5. System matches deposit to approved collections
6. GL entry: Debit Cash in Hand, Credit AR-Agents
7. Agent balance updated: totalDeposited += amount, currentBalance -= amount

**UC-4: Manager Reviews Agent Aging**
1. Manager opens Agent Aging Report
2. Sees agents grouped by aging buckets (0-1, 2-3, 4-7, 8+ days)
3. Identifies agent with 8+ days outstanding
4. Reviews collections for that agent
5. Contacts agent to resolve delay
6. If no resolution, blocks agent from receiving new deliveries

**UC-5: CFO Reviews Cash Flow**
1. CFO logs in at 9:00 AM
2. Navigates to Cash Flow Dashboard
3. Sees KPI cards: Cash in Hand, Cash in Transit, AR-Agents, Cash Expected
4. Reviews 30-day forecast chart
5. Identifies potential cash shortfall in 2 weeks
6. Decides to delay planned equipment purchase
7. Exports PDF report to share with investors

**UC-6: Business Owner Analyzes Profitability**
1. Owner opens Profitability Dashboard
2. Selects date range: Last 30 days
3. Reviews gross margin: 35%
4. Drills down to profitability by product
5. Discovers Product A has 50% margin, Product B has 15% margin
6. Decides to increase marketing spend on Product A and discontinue Product B

---

## 3. Functional Requirements

### F-001: Chart of Accounts
**Priority:** P0 (Critical - Foundation)

**Description:**
System shall maintain a chart of accounts (COA) with standard accounting structure for COD e-commerce. COA includes asset, liability, equity, revenue, and expense accounts with hierarchical organization.

**Standard Accounts:**
- **Assets:**
  - 1010: Cash in Hand (Bank Account) - DEBIT
  - 1020: Cash in Transit (Collected by Agents) - DEBIT
  - 1030: Accounts Receivable - Agents - DEBIT
  - 1040: Inventory - DEBIT
- **Liabilities:**
  - 2010: Accounts Payable - CREDIT
  - 2020: Agent Deposits Pending - CREDIT
- **Equity:**
  - 3010: Owner's Equity - CREDIT
  - 3020: Retained Earnings - CREDIT
- **Revenue:**
  - 4010: Product Sales Revenue - CREDIT
  - 4020: Shipping Revenue - CREDIT
- **Expenses:**
  - 5010: Cost of Goods Sold (COGS) - DEBIT
  - 5020: Delivery Expense - DEBIT
  - 5030: Failed Delivery Expense - DEBIT
  - 5040: Return Processing Expense - DEBIT
  - 5050: Operating Expenses - DEBIT

**Acceptance Criteria:**
- [ ] System seeds 12-15 standard accounts on initial migration
- [ ] Each account has unique code, name, type, normal balance (debit/credit)
- [ ] Accounts can be marked as system accounts (prevents deletion)
- [ ] Accounts can be activated/deactivated
- [ ] Account hierarchy supported (parent-child relationships)
- [ ] API endpoint to retrieve chart of accounts: `GET /api/gl/accounts`

**Technical Notes:**
- Store in `accounts` table
- Seed script runs on first deployment
- System accounts cannot be deleted, only deactivated

---

### F-002: Double-Entry General Ledger
**Priority:** P0 (Critical - Foundation)

**Description:**
All financial transactions shall create balanced journal entries following double-entry bookkeeping principles. Every entry must have equal debits and credits, ensuring the accounting equation (Assets = Liabilities + Equity) always balances.

**Acceptance Criteria:**
- [ ] Journal entries have unique entry numbers (format: JE-YYYYMMDD-XXXXX)
- [ ] Each journal entry contains 2+ account transactions (debits and credits)
- [ ] Total debits MUST equal total credits (validation enforced)
- [ ] Account transactions update running account balances
- [ ] Journal entries track source (order_delivery, agent_deposit, expense, manual)
- [ ] Journal entries can be voided (creates reversing entry, not deletion)
- [ ] API endpoints:
  - `POST /api/gl/journal-entries` - Create manual entry (super_admin only)
  - `GET /api/gl/journal-entries` - List entries with filters
  - `POST /api/gl/journal-entries/:id/void` - Void entry
- [ ] All GL operations wrapped in database transactions (ACID compliance)

**Technical Notes:**
- Use Prisma transaction API for atomicity
- Floating-point tolerance for balance checks: 0.01
- Journal entry creation is immutable (no updates, only void and recreate)

---

### F-003: Automated GL Entries for Order Lifecycle
**Priority:** P0 (Critical - Foundation)

**Description:**
System shall automatically create journal entries at key points in the order lifecycle: delivery, failed delivery, return. These entries recognize revenue, record expenses, and update inventory.

**GL Entry Rules:**

**3.1 Order Delivered (Revenue Recognition)**
- **Trigger:** Order status → 'delivered'
- **Entry Date:** Delivery completion date
- **Debits:**
  - Cash in Transit (1020): Order.totalAmount
  - COGS (5010): Sum of (OrderItem.product.cogs × quantity)
- **Credits:**
  - Product Sales Revenue (4010): Order.subtotal
  - Shipping Revenue (4020): Order.shippingCost
  - Inventory (1040): Sum of (OrderItem.product.cogs × quantity)

**3.2 Failed Delivery**
- **Trigger:** Order status → 'failed_delivery' (not rescheduled)
- **Entry Date:** Failed delivery date
- **Debits:**
  - Failed Delivery Expense (5030): Fixed amount (e.g., 10 GHS)
- **Credits:**
  - Cash in Hand (1010): 10 GHS

**3.3 Order Returned**
- **Trigger:** Order status → 'returned'
- **Entry Date:** Return processed date
- **Reverse Revenue Entry:**
  - Debit: Product Sales Revenue (4010): Order.subtotal
  - Debit: Shipping Revenue (4020): Order.shippingCost
  - Debit: Inventory (1040): COGS
  - Credit: Cash in Transit (1020): Order.totalAmount
  - Credit: COGS (5010): COGS
- **Return Processing:**
  - Debit: Return Processing Expense (5040): Fixed amount (e.g., 15 GHS)
  - Credit: Cash in Hand (1010): 15 GHS

**Acceptance Criteria:**
- [ ] GL entries auto-created on order status changes (no manual intervention)
- [ ] Order.revenueRecognized flag set to true on delivery
- [ ] Order.glJournalEntryId links to created journal entry
- [ ] Socket.io event emitted: `gl:entry-created`
- [ ] All entries validated for balance before saving
- [ ] Failed entry creation rolls back entire order status change
- [ ] Entries logged with source='order_delivery', sourceId=orderId

**Technical Notes:**
- Implement in `deliveryService.completeDelivery()` and `orderService.updateOrderStatus()`
- COGS must be set on Product model (new field required)
- Use database transaction to ensure atomicity

---

### F-004: Agent Collection Workflow
**Priority:** P0 (Critical - Foundation)

**Description:**
When an agent delivers an order and collects COD payment, the system shall create a collection record that flows through a verification and approval workflow before being deposited and reconciled.

**Collection States:**
1. **draft** - Auto-created on delivery
2. **verified** - Accountant verified against delivery proof
3. **approved** - Manager approved verified collection
4. **deposited** - Agent deposited funds to bank
5. **reconciled** - Matched to bank statement

**State Transitions:**
- draft → verified: Accountant action `PUT /api/agent-reconciliation/collections/:id/verify`
- verified → approved: Manager action `PUT /api/agent-reconciliation/collections/:id/approve`
- approved → deposited: Agent submits deposit, accountant verifies deposit
- deposited → reconciled: Accountant matches to bank statement

**Acceptance Criteria:**
- [ ] Collection auto-created when order status → 'delivered'
- [ ] Collection amount = Order.codAmount (must match exactly, no tolerance)
- [ ] Collection.agentId = Order.deliveryAgentId
- [ ] Collection.collectionDate = Delivery.actualDeliveryTime
- [ ] Only accountant role can verify collections
- [ ] Only manager/admin role can approve collections
- [ ] Agent can view their own collections: `GET /api/agent-reconciliation/agents/:id/collections`
- [ ] Accountant can view all collections: `GET /api/agent-reconciliation/collections?status=draft`
- [ ] Bulk verify action supported: `PUT /api/agent-reconciliation/collections/bulk-verify`
- [ ] Discrepancy flagging: Accountant can add notes to collection
- [ ] Collection verification creates GL entry: Debit AR-Agents, Credit Cash in Transit
- [ ] Collection approval updates agent balance: totalCollected += amount

**Technical Notes:**
- Implement in `agentReconciliationService.ts`
- Use Prisma transactions for state changes + GL entry creation
- Socket event: `collection:verified`, `collection:approved`

---

### F-005: Agent Balance Tracking
**Priority:** P0 (Critical - Foundation)

**Description:**
System shall maintain real-time balance for each delivery agent showing total collected, total deposited, and current amount owed. Balance determines agent eligibility for new deliveries.

**Balance Calculation:**
- `totalCollected` = Sum of approved collections
- `totalDeposited` = Sum of verified deposits
- `currentBalance` = totalCollected - totalDeposited

**Acceptance Criteria:**
- [ ] AgentBalance record created when agent receives first delivery
- [ ] Balance updated in real-time on collection approval and deposit verification
- [ ] API endpoint: `GET /api/agent-reconciliation/agents/:id/balance`
- [ ] Balance displayed on agent dashboard
- [ ] Manager can view all agent balances: `GET /api/agent-reconciliation/agents`
- [ ] Agent can view only their own balance (role-based access control)
- [ ] Balance includes lastSettlementDate timestamp
- [ ] Negative balance not allowed (agents only collect, never pay company)

**Technical Notes:**
- Use database triggers or service-level hooks to update balance
- Index on agentId for fast lookups

---

### F-006: Agent Aging Analysis
**Priority:** P0 (Critical - Foundation)

**Description:**
System shall calculate aging of agent collections based on days since collection date. Aging determines agent status and triggers alerts/blocks.

**Aging Buckets:**
- **0-1 day:** Current collections (green)
- **2-3 days:** Slightly aged (yellow)
- **4-7 days:** Overdue (orange)
- **8+ days:** Critically overdue (red)

**Acceptance Criteria:**
- [ ] Aging calculated for each approved collection not yet deposited
- [ ] Collections grouped by agent and aging bucket
- [ ] Aging report shows: agent name, total balance, amount per bucket, oldest collection date
- [ ] API endpoint: `GET /api/agent-reconciliation/aging`
- [ ] Aging refreshed daily via cron job (cache results in `agent_aging_buckets` table)
- [ ] Overdue agents highlighted in UI with color coding
- [ ] Export aging report to CSV: `GET /api/agent-reconciliation/aging/export`

**Calculation Logic:**
```
daysSinceCollection = floor((now - collection.collectionDate) / 86400000)
if daysSinceCollection <= 1: bucket = '0-1'
else if daysSinceCollection <= 3: bucket = '2-3'
else if daysSinceCollection <= 7: bucket = '4-7'
else: bucket = '8+'
```

**Technical Notes:**
- Cron job runs daily at 6:00 AM to update `agent_aging_buckets` table
- Query aging table for reports (avoid real-time calculation on every request)

---

### F-007: Agent Blocking for Discrepancies
**Priority:** P0 (Critical - Foundation)

**Description:**
System shall automatically or manually block agents from receiving new deliveries when settlement discrepancies or delays are detected. Blocked agents require manager intervention to unblock.

**Blocking Triggers:**
1. **Manual Block:** Manager flags agent for investigation
2. **Automatic Block:** Agent has collections in 4-7 day or 8+ day buckets (checked daily)
3. **Discrepancy Block:** Collection amount ≠ Order.codAmount

**Acceptance Criteria:**
- [ ] AgentBalance.isBlocked flag prevents new order assignments
- [ ] Block reason required: AgentBalance.blockReason (string)
- [ ] Blocked timestamp recorded: AgentBalance.blockedAt
- [ ] Blocked by user tracked: AgentBalance.blockedBy (userId)
- [ ] Only manager/admin can unblock: `POST /api/agent-reconciliation/agents/:id/unblock`
- [ ] Unblock requires manager to review and resolve issue
- [ ] Agent receives notification when blocked (email or in-app)
- [ ] Manager receives notification of automatic blocks
- [ ] API endpoints:
  - `POST /api/agent-reconciliation/agents/:id/block` - Manual block
  - `POST /api/agent-reconciliation/agents/:id/unblock` - Unblock
  - `GET /api/agent-reconciliation/agents/blocked` - List blocked agents
- [ ] Socket event: `agent:blocked`, `agent:unblocked`

**Business Rules:**
- Partial collections NOT allowed (must collect full amount or return product)
- Agents cannot go negative (no advances or disbursements in Phase 1)

**Technical Notes:**
- Check isBlocked in order assignment logic
- Cron job at 10:00 AM daily checks aging and auto-blocks agents with 4+ day balances

---

### F-008: Agent Deposit Reconciliation
**Priority:** P0 (Critical - Foundation)

**Description:**
Agents deposit collected cash via mobile money or bank transfer. System records deposits, verifies against bank records, and matches to collections to clear agent balance.

**Deposit Methods:**
- **mobile_money:** Agent transfers via MTN Mobile Money, Vodafone Cash, etc.
- **bank_transfer:** Agent transfers from personal bank account
- **cash_bank_deposit:** Agent physically deposits cash at bank branch

**Acceptance Criteria:**
- [ ] Agent submits deposit with: amount, depositDate, depositMethod, referenceNumber
- [ ] Deposit creates record with status = 'pending'
- [ ] Accountant verifies deposit against bank statement: `PUT /api/agent-reconciliation/deposits/:id/verify`
- [ ] Verification requires reference number match
- [ ] Verified deposit creates GL entry: Debit Cash in Hand, Credit AR-Agents
- [ ] System attempts auto-match deposit to oldest approved collections for agent
- [ ] Matched collections status → 'deposited'
- [ ] Agent balance updated: totalDeposited += amount, currentBalance -= amount
- [ ] Deposit amount cannot exceed agent currentBalance
- [ ] API endpoints:
  - `POST /api/agent-reconciliation/deposits` - Submit deposit
  - `GET /api/agent-reconciliation/deposits` - List deposits (filtered by agent, status)
  - `PUT /api/agent-reconciliation/deposits/:id/verify` - Verify deposit
- [ ] Socket event: `deposit:recorded`, `deposit:verified`

**Matching Logic:**
- Match deposit to approved collections FIFO (oldest first)
- If deposit amount > total approved collections, flag for review (should not happen)
- If deposit amount < total approved collections, partial match (agent still owes balance)

**Technical Notes:**
- Reference number must be unique (database constraint)
- Use Prisma transaction for deposit verification + GL entry + collection status updates

---

### F-009: Cash Flow Report
**Priority:** P0 (Critical - Phase 2)

**Description:**
Business owner and accountant need real-time visibility into cash position: cash on hand, cash in transit with agents, cash expected from out-for-delivery orders, and 30-day forecast.

**Report Sections:**

**9.1 Current Cash Position:**
- **Cash in Hand:** Balance of account 1010 (bank balance)
- **Cash in Transit:** Balance of account 1020 (collected by agents, not yet deposited)
- **Accounts Receivable - Agents:** Balance of account 1030 (owed by agents)
- **Cash Expected:** Sum of Order.codAmount where status = 'out_for_delivery'
- **Total Cash Position:** Sum of above

**9.2 30-Day Forecast:**
- **Expected Collections:** Orders scheduled for delivery (grouped by day)
- **Expected Deposits:** Based on agent aging patterns (avg deposit time per agent)
- **Projected Bank Balance:** Cash in Hand + Expected Deposits - Planned Expenses

**9.3 Breakdown:**
- **By Agent:** Each agent's collected, deposited, pending amounts
- **By Status:** Grouped by collection status (verified, approved, deposited)

**Acceptance Criteria:**
- [ ] Report accessible at: `GET /api/financial/cash-flow?startDate=...&endDate=...`
- [ ] Dashboard displays KPI cards for each cash position metric
- [ ] Line chart visualizes 30-day forecast
- [ ] Table shows agent breakdown (sortable by pending amount)
- [ ] Forecast uses historical data (last 30 days) to predict deposit timing
- [ ] Report refreshes every 5 minutes on dashboard (WebSocket or polling)
- [ ] Export to PDF: `GET /api/financial/cash-flow/export/pdf`
- [ ] Export to CSV: `GET /api/financial/cash-flow/export/csv`
- [ ] Email delivery: `POST /api/financial/cash-flow/email` (sends PDF to recipients)
- [ ] Report renders in <2 seconds for standard date ranges

**Technical Notes:**
- Query GL account balances directly (indexed queries)
- Cache forecast calculation (regenerate hourly)
- Use Recharts for frontend visualization

---

### F-010: Agent Aging Report
**Priority:** P0 (Critical - Phase 2)

**Description:**
Operations manager needs to identify agents with overdue settlements and take corrective action (reminders, blocks, termination).

**Report Layout:**

**Summary Cards:**
- Total Agents with Outstanding Balances
- Total Outstanding Amount
- Number of Overdue Agents (4+ days)
- Number of Blocked Agents

**Aging Breakdown:**
- Pie chart: Distribution by bucket (0-1, 2-3, 4-7, 8+)
- Table: Agent list with columns for each bucket + total

**Agent Details Table:**
- Agent Name | Total Balance | 0-1 | 2-3 | 4-7 | 8+ | Status (Blocked/Active) | Actions

**Acceptance Criteria:**
- [ ] Report endpoint: `GET /api/financial/agent-aging`
- [ ] Aging calculated daily at 6:00 AM (cron job)
- [ ] Results cached in `agent_aging_buckets` table
- [ ] Report includes percentage of total for each bucket
- [ ] Agents sortable by total balance, oldest collection, or bucket amount
- [ ] Filter: Show only overdue agents (4+ days)
- [ ] Export to PDF and CSV
- [ ] Click agent name drills down to collection details
- [ ] Action buttons: Email agent, Block agent, View collections

**Technical Notes:**
- Pre-calculate aging to avoid slow queries on every page load
- Use indexed queries on `agent_aging_buckets` table

---

### F-011: Profitability Analysis
**Priority:** P1 (High - Phase 2)

**Description:**
Business owner needs to understand true profitability after all costs (COGS, delivery, returns). Analysis available at order, product, customer, and region levels.

**Report Metrics:**
- **Total Revenue:** Sum of delivered orders (Order.totalAmount)
- **Total COGS:** Sum of (OrderItem.product.cogs × quantity) for delivered orders
- **Gross Profit:** Revenue - COGS
- **Gross Margin %:** (Gross Profit / Revenue) × 100
- **Total Expenses:** Sum of all expenses in period
- **Net Profit:** Gross Profit - Total Expenses
- **Net Margin %:** (Net Profit / Revenue) × 100

**Granularity:**

**11.1 By Product:**
- Product Name | Units Sold | Revenue | COGS | Gross Profit | Gross Margin %

**11.2 By Customer:**
- Customer Name | Order Count | Revenue | COGS | Gross Profit | Avg Order Value

**11.3 By Region/Delivery Area:**
- Region | Order Count | Revenue | COGS | Delivery Expense | Net Profit

**11.4 By Order:**
- Order ID | Customer | Product(s) | Revenue | COGS | Gross Profit | Gross Margin %

**Acceptance Criteria:**
- [ ] Report endpoint: `GET /api/financial/profitability?startDate=...&endDate=...&granularity=product|customer|region|order`
- [ ] Only includes delivered orders (status = 'delivered')
- [ ] Product COGS tracked in Product model (new field required)
- [ ] Summary KPI cards: Revenue, COGS, Gross Profit, Gross Margin %, Net Profit, Net Margin %
- [ ] Bar chart: Top 10 most profitable products
- [ ] Table: Product profitability (sortable by margin)
- [ ] Export to PDF and CSV
- [ ] Report filtered by date range
- [ ] Calculations accurate to 2 decimal places

**Technical Notes:**
- Add `cogs: Float?` field to Product model
- Query optimized with indexes on Order.status, Order.deliveryDate
- Consider materialized view for large datasets

---

### F-012: Balance Sheet and Profit & Loss Statements
**Priority:** P1 (High - Phase 2)

**Description:**
Accountant and business owner need standard financial statements for compliance, tax reporting, and investor presentations.

**12.1 Balance Sheet (as of date):**

**Assets:**
- Current Assets: Cash in Hand, Cash in Transit, AR-Agents, Inventory
- Total Assets

**Liabilities:**
- Current Liabilities: Accounts Payable, Agent Deposits Pending
- Total Liabilities

**Equity:**
- Owner's Equity
- Retained Earnings (calculated from P&L)
- Total Equity

**Balance Check:** Assets = Liabilities + Equity

**12.2 Profit & Loss Statement (period):**

**Revenue:**
- Product Sales Revenue
- Shipping Revenue
- **Total Revenue**

**Cost of Goods Sold:**
- COGS
- **Gross Profit** = Revenue - COGS
- **Gross Margin %**

**Operating Expenses:**
- Delivery Expense
- Failed Delivery Expense
- Return Processing Expense
- Operating Expenses
- **Total Expenses**

**Net Income** = Gross Profit - Total Expenses
**Net Margin %**

**Acceptance Criteria:**
- [ ] Balance Sheet endpoint: `GET /api/financial/balance-sheet?asOfDate=...`
- [ ] P&L endpoint: `GET /api/financial/profit-loss?startDate=...&endDate=...`
- [ ] Balance Sheet always balances (Assets = Liabilities + Equity within 0.01 tolerance)
- [ ] Retained Earnings auto-calculated from P&L cumulative results
- [ ] Reports formatted in standard accounting layout
- [ ] Export to PDF (formatted templates)
- [ ] Export to CSV (tabular data)
- [ ] Period comparison NOT required in Phase 2 (keep it simple)

**Technical Notes:**
- Query account balances from `account_transactions` table
- Calculate retained earnings by summing all revenue - expense account balances
- Use accounting formatting (negative numbers in parentheses)

---

### F-013: General Ledger Viewer
**Priority:** P2 (Medium - Phase 2)

**Description:**
Accountant needs to view detailed transaction history for each account (account ledger) and browse all journal entries for audit purposes.

**Features:**
- List all accounts with current balances
- Drill down to account ledger (all transactions for one account)
- View journal entry details (all account transactions in one entry)
- Filter by date range, account, entry source

**Acceptance Criteria:**
- [ ] Accounts list: `GET /api/gl/accounts` (shows code, name, balance)
- [ ] Account ledger: `GET /api/gl/accounts/:id/ledger?startDate=...&endDate=...`
- [ ] Journal entries list: `GET /api/gl/journal-entries?source=...&startDate=...&endDate=...`
- [ ] Journal entry detail: `GET /api/gl/journal-entries/:id`
- [ ] Ledger shows running balance after each transaction
- [ ] Entry detail shows all debits and credits (must sum to equal)
- [ ] Voided entries displayed with strikethrough
- [ ] Export ledger to Excel (CSV with running balance column)

**Technical Notes:**
- Paginate ledger results (large accounts can have thousands of transactions)
- Calculate running balance efficiently (indexed query on createdAt)

---

### F-014: Automated Notifications
**Priority:** P1 (High - Phase 2)

**Description:**
Key stakeholders receive automated email notifications for important financial events without having to check dashboard.

**14.1 Daily Cash Position Summary:**
- **Recipients:** Business Owner/CFO, Accountant (from SystemConfig)
- **Schedule:** Daily at 8:00 AM
- **Content:**
  - Cash Position KPIs (Cash in Hand, in Transit, AR-Agents, Total)
  - Agent Aging Summary (total outstanding, overdue agents count)
  - Overdue Agents List (name, amount, days overdue)
  - Link to full dashboard

**14.2 Agent Settlement Overdue Alert:**
- **Recipients:** Operations Manager, Accountant
- **Schedule:** Daily at 10:00 AM
- **Trigger:** Agent has collections > 3 days old
- **Content:**
  - List of overdue agents with balances and days overdue
  - Recommended actions (contact agent, block, etc.)
  - Link to agent reconciliation dashboard

**Acceptance Criteria:**
- [ ] Email templates created with company branding
- [ ] Emails sent via existing email service (from SystemConfig)
- [ ] Cron jobs scheduled using Bull queue
- [ ] Unsubscribe link included in emails (user preferences)
- [ ] Email delivery logged (success/failure)
- [ ] Failed email delivery retried 3 times
- [ ] Email recipients configurable in SystemConfig or user preferences
- [ ] Emails include PDF attachment for cash position summary

**Technical Notes:**
- Use existing email provider (check SystemConfig model)
- Implement in `backend/src/queues/notificationQueue.ts`
- Schedule with Bull: `queue.add('daily-cash-position-email', {}, { repeat: { cron: '0 8 * * *' } })`

---

### F-015: Multi-Format Report Exports
**Priority:** P1 (High - Phase 2)

**Description:**
All financial reports shall be exportable to PDF (for sharing), CSV (for analysis), and viewable as interactive dashboard charts.

**Export Formats:**

**15.1 PDF Export:**
- Professional template with company logo, header, footer
- Report title, date range, generation timestamp
- KPI summary tables
- Charts rendered as images
- Paginated for long reports
- Downloadable via: `GET /api/financial/{report-type}/export/pdf`

**15.2 CSV Export:**
- Tabular data only (no charts)
- Column headers in first row
- Compatible with Excel, Google Sheets
- Downloadable via: `GET /api/financial/{report-type}/export/csv`

**15.3 Dashboard Charts:**
- Interactive charts with tooltips
- Responsive design (mobile/desktop)
- Real-time updates via WebSocket or 5-minute polling
- Drill-down capabilities (click bar to see details)

**15.4 Email Delivery:**
- Email report as PDF attachment
- Summary in email body
- Endpoint: `POST /api/financial/{report-type}/email`
- Recipients: comma-separated emails or user IDs

**Acceptance Criteria:**
- [ ] Cash Flow Report: All 4 formats (Dashboard, PDF, CSV, Email)
- [ ] Agent Aging Report: All 4 formats
- [ ] Profitability Report: All 4 formats
- [ ] Balance Sheet: Dashboard, PDF, CSV
- [ ] P&L Statement: Dashboard, PDF, CSV
- [ ] PDF generation completes in <10 seconds for standard reports
- [ ] CSV exports include proper escaping (commas, quotes)
- [ ] Email delivery includes personalized message

**Technical Notes:**
- PDF: Use `pdfkit` (Node.js) or `puppeteer` (headless Chrome)
- CSV: Generate server-side for data security
- Charts: Recharts library (React)
- Email: Use existing email service

---

## 4. User Experience Flow

### UX-1: Accountant Daily Reconciliation Workflow

1. Accountant logs in at 9:00 AM
2. Dashboard shows notification: "15 new collections to verify"
3. Clicks "Collection Review" page
4. Sees list of draft collections with delivery proof thumbnails
5. For each collection:
   - Reviews delivery proof image/signature
   - Verifies amount matches order total
   - Clicks "Verify" button
6. System creates GL entry and updates collection status
7. Manager reviews verified collections and approves
8. Collections move to "Approved" status
9. Agents can now submit deposits
10. Accountant receives email: "Agent John deposited 500 GHS"
11. Accountant verifies deposit reference in bank statement
12. Clicks "Verify Deposit" button
13. System matches deposit to approved collections
14. Agent balance cleared, collections marked as "deposited"

### UX-2: Operations Manager Agent Performance Review

1. Manager opens "Agent Aging Report"
2. Sees summary: 5 agents overdue (4+ days)
3. Pie chart shows 60% of outstanding balance in 8+ day bucket
4. Table lists agents with aging breakdown
5. Clicks agent "Mary" with 8+ day balance of 800 GHS
6. Drills down to Mary's collection details
7. Sees 10 collections, oldest is 12 days old
8. Clicks "Email Agent" to send reminder
9. Agent doesn't respond in 24 hours
10. Manager clicks "Block Agent" and enters reason: "12 days overdue, no response"
11. Mary blocked from new deliveries until resolved
12. Manager contacts Mary by phone to resolve issue
13. Mary deposits 800 GHS with reference number
14. Accountant verifies deposit
15. Manager clicks "Unblock Agent"
16. Mary can receive deliveries again

### UX-3: Business Owner Monthly Financial Review

1. Owner opens dashboard on first of month
2. Receives daily cash position email at 8:00 AM
3. Opens email, sees: "Total Cash Position: 15,000 GHS, 30-day forecast shows shortfall"
4. Clicks link to Cash Flow Dashboard
5. Reviews KPI cards and 30-day forecast chart
6. Notices cash dip in week 3 due to large inventory purchase
7. Opens "Profitability Analysis" page
8. Selects last 30 days, views by product
9. Sees Product A: 50% margin, Product B: 15% margin
10. Decides to increase Product A inventory and phase out Product B
11. Exports Profitability Report to PDF
12. Opens "Balance Sheet" report
13. Reviews total assets, liabilities, equity
14. Exports Balance Sheet and P&L to PDF
15. Emails reports to accountant and investors
16. Uses insights to plan next month's operations

---

## 5. Data Requirements

### 5.1 Database Schema

**New Tables:**

**accounts**
- id (PK), code (unique), name, type (enum: asset, liability, equity, revenue, expense)
- subtype (string), normalBalance (enum: debit, credit), description
- isActive (boolean), isSystem (boolean), parentId (FK to accounts)
- createdAt, updatedAt

**account_transactions**
- id (PK), accountId (FK), journalEntryId (FK), debit (float), credit (float)
- balance (float, running balance), description, createdAt

**journal_entries**
- id (PK), entryNumber (unique), entryDate, description, source (string), sourceId (int)
- status (enum: draft, posted, void), totalDebit (float), totalCredit (float)
- createdBy (FK to users), metadata (JSON), createdAt, updatedAt

**agent_balances**
- id (PK), agentId (FK to users, unique), totalCollected (float), totalDeposited (float)
- currentBalance (float), isBlocked (boolean), blockReason (string), blockedAt, blockedBy (FK)
- lastSettlementDate, updatedAt

**agent_collections**
- id (PK), agentId (FK), agentBalanceId (FK), orderId (FK, unique)
- amount (float), collectionDate, status (enum: draft, verified, approved, deposited, reconciled)
- verifiedBy (FK), verifiedAt, approvedBy (FK), approvedAt
- discrepancyNotes (string), journalEntryId (FK), createdAt, updatedAt

**agent_deposits**
- id (PK), agentId (FK), agentBalanceId (FK), amount (float), depositDate
- depositMethod (enum: mobile_money, bank_transfer, cash_bank_deposit), referenceNumber (unique)
- bankAccount (string), status (enum: pending, verified, reconciled)
- verifiedBy (FK), verifiedAt, journalEntryId (FK), notes, createdAt, updatedAt

**agent_aging_buckets**
- id (PK), agentId (FK), bucket (string: '0-1', '2-3', '4-7', '8+'), amount (float)
- collectionCount (int), oldestDate, calculatedAt
- Unique constraint: (agentId, bucket)

**Model Updates:**

**orders**
- Add: revenueRecognized (boolean, default false), revenueRecognizedAt (datetime)
- Add: glJournalEntryId (FK to journal_entries)

**products**
- Add: cogs (float, nullable) - Cost of goods sold per unit

**users**
- Existing: deliveryRate (float, nullable) for agents
- Existing: totalEarnings (float, nullable) for agents

### 5.2 Validation Rules

**Account Creation:**
- Account code must be unique and follow numbering convention (1000-5999)
- Account type must be valid enum
- Normal balance must match type (assets/expenses = debit, liabilities/equity/revenue = credit)
- System accounts cannot be deleted, only deactivated

**Journal Entry Creation:**
- Total debits MUST equal total credits (tolerance: 0.01)
- Entry date cannot be in future
- Each account transaction must have either debit OR credit (not both, not neither)
- All referenced accounts must be active
- Source and sourceId must be valid if provided

**Agent Collection:**
- Amount must equal Order.codAmount exactly
- Order must have status = 'delivered'
- Agent must be assigned to order (Order.deliveryAgentId = Collection.agentId)
- Cannot create duplicate collection for same order

**Agent Deposit:**
- Amount must be > 0
- Reference number must be unique
- Deposit date cannot be in future
- Deposit amount should not exceed agent currentBalance (soft warning, not hard constraint)

---

## 6. Technical Specifications

### 6.1 Technology Stack

**Backend:**
- Runtime: Node.js 18+
- Framework: Express.js
- ORM: Prisma
- Database: PostgreSQL 14+
- Job Queue: Bull + Redis
- Real-time: Socket.io
- Email: Existing email service (check SystemConfig)

**Frontend:**
- Framework: React 18+ with Vite
- State Management: Zustand
- UI Library: Shadcn UI
- Charts: Recharts
- Forms: React Hook Form + Zod validation
- API Client: Axios with interceptors

**DevOps:**
- Docker & Docker Compose
- GitHub Actions (CI/CD)
- Nginx reverse proxy

### 6.2 Architecture

**Layered Backend Architecture:**
```
Routes (HTTP endpoints)
  ↓
Controllers (request/response handling)
  ↓
Services (business logic)
  ↓
Prisma ORM
  ↓
PostgreSQL Database
```

**Event-Driven Side Effects:**
- Socket.io emits events on state changes
- Frontend stores listen to events and update UI
- Background jobs (Bull) process async tasks (emails, aging calculations)

### 6.3 API Design

**RESTful Endpoints:**

**GL Endpoints (`/api/gl`):**
- `GET /api/gl/accounts` - List chart of accounts
- `POST /api/gl/accounts` - Create account (admin only)
- `GET /api/gl/accounts/:id/balance` - Get account balance
- `GET /api/gl/accounts/:id/ledger` - Get account ledger
- `GET /api/gl/trial-balance` - Get trial balance
- `GET /api/gl/journal-entries` - List journal entries
- `POST /api/gl/journal-entries` - Manual journal entry (super_admin only)
- `POST /api/gl/journal-entries/:id/void` - Void entry

**Agent Reconciliation (`/api/agent-reconciliation`):**
- `GET /api/agent-reconciliation/collections` - List all collections (accountant)
- `GET /api/agent-reconciliation/collections/:id` - Get collection details
- `PUT /api/agent-reconciliation/collections/:id/verify` - Verify collection (accountant)
- `PUT /api/agent-reconciliation/collections/:id/approve` - Approve collection (manager)
- `PUT /api/agent-reconciliation/collections/bulk-verify` - Bulk verify (accountant)
- `GET /api/agent-reconciliation/agents/:id/collections` - Agent's collections
- `GET /api/agent-reconciliation/agents/:id/balance` - Agent balance
- `POST /api/agent-reconciliation/deposits` - Record deposit (agent)
- `GET /api/agent-reconciliation/deposits` - List deposits
- `PUT /api/agent-reconciliation/deposits/:id/verify` - Verify deposit (accountant)
- `POST /api/agent-reconciliation/agents/:id/block` - Block agent (manager)
- `POST /api/agent-reconciliation/agents/:id/unblock` - Unblock agent (manager)
- `GET /api/agent-reconciliation/aging` - Agent aging report
- `GET /api/agent-reconciliation/overdue` - Overdue agents

**Financial Reports (`/api/financial`):**
- `GET /api/financial/cash-flow` - Cash flow report
- `GET /api/financial/cash-flow/export/pdf` - Export PDF
- `GET /api/financial/cash-flow/export/csv` - Export CSV
- `POST /api/financial/cash-flow/email` - Email report
- `GET /api/financial/agent-aging` - Agent aging report (mirrors /api/agent-reconciliation/aging)
- `GET /api/financial/profitability` - Profitability analysis
- `GET /api/financial/balance-sheet` - Balance sheet
- `GET /api/financial/profit-loss` - P&L statement
- `GET /api/financial/general-ledger` - General ledger report

**Authentication & Authorization:**
- All endpoints require JWT authentication
- Role-based access control (RBAC):
  - `delivery_agent`: View own collections, submit deposits
  - `accountant`: Verify collections, verify deposits, reconcile, view all reports
  - `manager`, `admin`: Approve collections, block/unblock agents, view all reports
  - `super_admin`: All permissions + manual GL entries

### 6.4 Security Considerations

**Data Protection:**
- All financial data protected by role-based access control
- Agents can only view own balance and collections
- Immutable journal entries (no updates, only void and recreate)
- Audit trail for all state changes (verifiedBy, approvedBy, blockedBy)

**Transaction Integrity:**
- Use Prisma transactions for all GL operations
- Enforce referential integrity (foreign key constraints)
- Database-level unique constraints (reference numbers, collection per order)

**Input Validation:**
- Zod schemas for all API inputs
- Validate GL balance before saving
- Sanitize user inputs to prevent SQL injection (Prisma protects)

---

## 7. Testing Requirements

### 7.1 Unit Tests

**GL Service Tests:**
- Test: Create balanced journal entry → Success
- Test: Create unbalanced entry → Throws error
- Test: Void journal entry → Creates reversing entry
- Test: Calculate account balance → Correct amount
- Test: Get trial balance → Sum of debits = Sum of credits

**Agent Reconciliation Service Tests:**
- Test: Create collection on delivery → Draft collection created
- Test: Verify collection → Status changes, GL entry created
- Test: Agent balance calculation → totalCollected - totalDeposited
- Test: Aging bucket calculation → Correct bucket assignment
- Test: Auto-block agent with 4+ day balance → isBlocked = true

### 7.2 Integration Tests

**Order Delivery Workflow:**
- Test: Complete delivery → GL entry created, collection created, order.revenueRecognized = true
- Test: Failed delivery → No revenue recognized, expense recorded
- Test: Return order → Revenue reversed, inventory restored

**Agent Settlement Workflow:**
- Test: End-to-end flow: Deliver → Verify → Approve → Deposit → Reconcile
- Test: Deposit amount > agent balance → Rejected
- Test: Deposit matches multiple collections → All collections updated

**Financial Reports:**
- Test: Cash flow report with real data → Correct totals
- Test: Profitability report → Margin calculations accurate
- Test: Balance sheet → Assets = Liabilities + Equity

### 7.3 Edge Cases

- Test: Concurrent deliveries by same agent → Race conditions handled
- Test: Large deposit amount (floating point precision) → Accurate to 2 decimals
- Test: Agent blocked mid-delivery → Cannot be assigned new orders
- Test: GL entry creation fails → Order status rollback
- Test: Email delivery fails → Retry 3 times

### 7.4 Performance Tests

- Test: Cash flow report with 10,000+ orders → Response time < 2 seconds
- Test: Agent aging calculation with 100 agents → Completes in < 5 seconds
- Test: Concurrent collection verifications → No deadlocks

---

## 8. Success Metrics

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Collection verification time | < 30 seconds per collection | Time from delivery to verified status |
| Agent settlement cycle | 90% within 3 days | Aging report analysis |
| Discrepancy rate | < 2% of collections | Collections flagged / total collections |
| Report generation speed | < 2 seconds for standard reports | API response time monitoring |
| Email delivery success | > 99% | Email service logs |
| User adoption (agent portal) | > 80% of agents log in weekly | User activity tracking |
| Financial data accuracy | 100% GL balances | Nightly trial balance check |
| System uptime | > 99.5% | Server monitoring |

---

## 9. Implementation Roadmap

### Phase 1: Foundation (4-6 weeks)

**Week 1-2: Database & GL Infrastructure**
- Create Prisma migrations for Account, AccountTransaction, JournalEntry
- Seed standard chart of accounts (12-15 accounts)
- Implement GLService with core methods (createJournalEntry, getAccountBalance, getTrialBalance)
- Write unit tests for GL balancing logic
- **Deliverable:** GL system operational, trial balance report available

**Week 3-4: Agent Reconciliation**
- Create migrations for AgentBalance, AgentCollection, AgentDeposit, AgentAgingBucket
- Implement AgentReconciliationService (collection workflow, deposit matching, blocking)
- Update DeliveryService.completeDelivery() to create GL entries and collections
- Build API endpoints for agent reconciliation
- Write integration tests for agent workflow
- **Deliverable:** Agent reconciliation workflow operational

**Week 5-6: Frontend Integration**
- Build Agent Reconciliation Dashboard (frontend page)
- Build Collection Review page (list, verify, bulk actions)
- Build Deposit Management page (verify, match)
- Build GL Viewer page (accounts, ledger, journal entries)
- Update financialStore and create agentReconciliationStore
- Socket.io integration for real-time updates
- **Deliverable:** Phase 1 complete, agents can be reconciled end-to-end

**Phase 1 Testing & Launch:**
- End-to-end testing with staging data
- UAT with 2-3 agents and accountant
- Fix bugs and performance issues
- Deploy to production
- Train users (video tutorials, documentation)

---

### Phase 2: Visibility (3-4 weeks)

**Week 7-8: Cash Flow & Agent Aging Reports**
- Implement cash flow report backend (current position + 30-day forecast)
- Implement agent aging report backend (leverage aging buckets)
- Build Cash Flow Dashboard (KPIs, chart, agent breakdown)
- Build Agent Aging Report page (summary, pie chart, table)
- Add PDF/CSV export functionality
- **Deliverable:** Cash flow and aging reports available

**Week 9-10: Profitability & Financial Statements**
- Add Product.cogs field (migration + UI to set COGS)
- Implement profitability analysis backend (by order, product, customer, region)
- Implement Balance Sheet and P&L backend
- Build Profitability Dashboard (KPIs, charts, tables)
- Build Balance Sheet/P&L Report pages
- Add export functionality
- **Deliverable:** Profitability and financial statements available

**Week 11: Automated Notifications & Polish**
- Implement daily cash position email (cron job)
- Implement agent overdue alert email (cron job)
- Email template design with company branding
- Performance optimization (caching, query tuning)
- End-to-end testing
- Bug fixes and UI polish
- **Deliverable:** Phase 2 complete, all reports and notifications operational

**Phase 2 Testing & Launch:**
- End-to-end testing with full production data
- Performance testing with realistic load
- UAT with business owner, accountant, operations manager
- Deploy to production
- Training and documentation updates
- Monitor for 2 weeks, collect feedback

---

## 10. Risks & Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| **GL balancing errors** | High (financial accuracy) | Medium | Rigorous unit tests, nightly trial balance check, transaction-level validation |
| **Agent resistance to new workflow** | Medium (adoption) | Medium | Training, simple UI, gradual rollout, agent feedback sessions |
| **Performance degradation with large data** | High (UX) | Low | Database indexes, query optimization, caching, pagination |
| **Data migration issues** | High (data integrity) | Medium | Backup before migration, dry-run on staging, manual verification of migrated data |
| **Email delivery failures** | Low (notifications) | Low | Retry logic, email service monitoring, fallback to in-app notifications |
| **Concurrent update race conditions** | Medium (data accuracy) | Low | Database transactions, optimistic locking, row-level locks for critical operations |
| **Floating-point precision errors** | Medium (financial accuracy) | Medium | Use decimal type in database, validate totals within tolerance (0.01) |
| **Scope creep** | Medium (timeline) | High | Strict adherence to PRD, "nice-to-have" features deferred to Phase 3 |

---

## 11. Future Enhancements (Phase 3+)

**Not in Current Scope (Phase 1-2), Consider for Later:**

1. **Multi-Currency Support:**
   - Store transactions in local currency + base currency
   - Exchange rate tracking per transaction
   - Foreign exchange gain/loss reporting

2. **Tax Management:**
   - VAT/GST tracking per order
   - Tax liability reporting
   - Tax remittance workflow
   - Tax rate database by jurisdiction

3. **Commission Automation:**
   - Auto-calculate sales rep commissions on delivery
   - Commission approval workflow
   - Commission payout batch processing
   - Commission vs. salary tracking

4. **Payment Gateway Integration:**
   - Stripe/PayPal for prepayments
   - Reduce COD risk with partial prepayment option
   - Reconcile gateway payouts to bank deposits

5. **Advanced Forecasting:**
   - Machine learning for cash flow prediction
   - Seasonal trend analysis
   - Demand forecasting for inventory planning

6. **External Accounting Integration:**
   - QuickBooks/Xero sync
   - Export GL entries to accounting software
   - Import bank statements automatically

7. **Audit Trail Enhancements:**
   - Detailed change history (who changed what when)
   - Immutable audit log
   - Compliance reporting (SOX, GAAP)

8. **Mobile App for Agents:**
   - Native iOS/Android app
   - Offline collection recording
   - Push notifications for settlement reminders

---

## 12. Appendices

### 12.1 Glossary

- **Chart of Accounts (COA):** Organized list of all accounts used in the general ledger
- **Double-Entry Bookkeeping:** Accounting method where every transaction affects at least two accounts (debit and credit)
- **General Ledger (GL):** Complete record of all financial transactions
- **Journal Entry:** Record of a financial transaction with debits and credits
- **Debit:** Left side of accounting equation; increases assets/expenses, decreases liabilities/equity/revenue
- **Credit:** Right side of accounting equation; increases liabilities/equity/revenue, decreases assets/expenses
- **Trial Balance:** Report showing all account balances to verify debits = credits
- **Balance Sheet:** Financial statement showing assets, liabilities, and equity at a point in time
- **Profit & Loss (P&L):** Financial statement showing revenue, expenses, and net income over a period
- **Cash Flow:** Movement of cash in and out of business
- **COGS (Cost of Goods Sold):** Direct cost of producing goods sold
- **Gross Profit:** Revenue minus COGS
- **Gross Margin:** (Gross Profit / Revenue) × 100%
- **Net Profit:** Gross profit minus all operating expenses
- **Accounts Receivable (AR):** Money owed to the business (in this case, by agents)
- **Aging:** Analysis of how long receivables have been outstanding
- **Reconciliation:** Process of matching two sets of records (e.g., collections vs. deposits)

### 12.2 References

**Existing Codebase Files:**
- Backend Schema: `/Users/mac/Downloads/claude/ecommerce-cod-admin/backend/prisma/schema.prisma`
- Financial Service: `/Users/mac/Downloads/claude/ecommerce-cod-admin/backend/src/services/financialService.ts`
- Delivery Service: `/Users/mac/Downloads/claude/ecommerce-cod-admin/backend/src/services/deliveryService.ts`
- Financial Store: `/Users/mac/Downloads/claude/ecommerce-cod-admin/frontend/src/stores/financialStore.ts`

**External References:**
- BigCapital codebase analysis (financial concepts source)
- Double-entry accounting principles (standard accounting practice)
- Ghana mobile money systems (MTN Mobile Money, Vodafone Cash)

### 12.3 Change Log

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-01-13 | Product Manager | Initial PRD creation |

---

## Next Steps

1. **Engineering Review:** Dev team reviews PRD, asks clarifying questions, estimates effort
2. **Stakeholder Approval:** Business owner and accountant approve requirements
3. **Design Mockups:** UI/UX designer creates high-fidelity mockups for key screens (optional, can use Shadcn components directly)
4. **Sprint Planning:** Break down into 2-week sprints with clear deliverables
5. **Kickoff:** Phase 1 development begins

**Questions for Engineering:**
- Are there any technical constraints or blockers not addressed in this PRD?
- Do you need more detail on any specific feature?
- What is your estimated timeline for Phase 1 and Phase 2?
- Do you recommend any changes to the database schema or API design?

**Questions for Stakeholders:**
- Are the aging buckets (0-1, 2-3, 4-7, 8+ days) appropriate for your settlement expectations?
- Do you want to pilot with a subset of agents before full rollout?
- Are there any additional reports or metrics you need that aren't covered?
- What is your preferred format for training materials (video, written guide, live session)?

---

**End of PRD**
