# Manual Testing Guide for Financial Management Module

Since automated E2E tests require some configuration adjustments, here's a comprehensive manual testing checklist to verify all functionality works correctly.

## Prerequisites

1. **Backend running** on port 3000: `cd backend && npm run dev`
2. **Frontend running** on port 5173: `cd frontend && npm run dev`
3. **Database seeded** with test data: User has imported orders
4. **Login credentials**:
   - Email: `admin@codadmin.com`
   - Password: `password123`

## Manual Test Checklist

### Login
- [ ] Navigate to http://localhost:5173/login
- [ ] Enter credentials: `admin@codadmin.com` / `password123`
- [ ] Click "Sign In"
- [ ] Verify redirect to dashboard

### Navigate to Financial Management
- [ ] Click "Financial" in sidebar or navigate to http://localhost:5173/financial
- [ ] Verify page title shows "Financial Management"
- [ ] Verify 3 main tabs are visible: "Overview", "Agent Collections", "Accounting & Analysis"

---

## OVERVIEW TAB VERIFICATION

### Core Financial Health KPIs (5 cards)
- [ ] **Total Revenue** - Shows GHS amount with green money icon
- [ ] **Net Profit** - Shows GHS amount with green trend icon
- [ ] **Outstanding AR** - Shows GHS amount with blue clock icon (merged COD + Agent AR)
- [ ] **Total Expenses** - Shows GHS amount with red minus icon
- [ ] **Expected Revenue** - Shows GHS amount with purple chart icon (from active orders)

**Verification Steps:**
1. Check each card has:
   - Colored icon (green/blue/red/purple)
   - Label text
   - GHS amount (properly formatted with commas, e.g., "GHS 12,345.67")
2. Verify amounts are NOT "GHS 0.00" (should have data from imported orders)
3. Verify no "NaN", "undefined", or "null" values

### Performance Trends Section
- [ ] **Revenue vs Expense Chart** - Line/area chart showing trends over time
  - X-axis: Dates
  - Y-axis: Amounts in GHS
  - Two lines: Revenue (blue/green) and Expenses (red/orange)
  - Tooltip appears on hover with date and values

### Cash Flow Forecasting Section
- [ ] **Cash Position Summary** (3 cards)
  - Cash in Transit - Cash held by delivery agents
  - Cash Expected - From confirmed/out-for-delivery orders
  - Total Available Cash - Current liquid cash position
- [ ] **30-Day Cash Forecast Chart** - Line chart with projected cash flow
  - Shows next 30 days
  - Includes expected collections
  - Dotted line for projections

**Data Integrity Checks:**
- [ ] Outstanding AR = Sum of agent cash held (verify in Agent Collections tab)
- [ ] Total Expenses matches sum in Expense Management tab
- [ ] All numbers are formatted correctly (GHS currency with 2 decimals)

---

## AGENT COLLECTIONS TAB VERIFICATION

### Agent Collections KPIs (6 cards)
- [ ] **Agents Holding Cash** - Count of agents with cash > 0
- [ ] **Total Cash Held** - Sum of all agent cash
- [ ] **Overdue Settlements** - Cash held > 7 days
- [ ] **Outstanding AR** (aging view) - Total receivable from agents
- [ ] **Critical (8+ Days)** - Amount in critical aging bucket
- [ ] **Warning (4-7 Days)** - Amount in warning aging bucket

**Verification Steps:**
1. Verify KPI values are numbers/amounts (not NaN or undefined)
2. Check that "Total Cash Held" = sum of individual agent balances in table below
3. Verify color coding: Critical (red), Warning (yellow), Normal (green)

### Exposure Distribution Chart
- [ ] Pie chart showing aging buckets
  - Green slice: 0-3 Days
  - Yellow slice: 4-7 Days
  - Red slice: 8+ Days
- [ ] Legend shows percentages
- [ ] Hover shows exact amounts

### Unified Agent Table
**Required Columns:**
- [ ] Agent Name
- [ ] Email
- [ ] Cash Held (GHS amount)
- [ ] Oldest Collection Date
- [ ] Aging Buckets: 0-3 Days, 4-7 Days, 8+ Days (with progress bars or amounts)
- [ ] Status Badge (Green/Yellow/Red based on oldest collection)
- [ ] Actions (View, Remind, Block buttons)

**Data Integrity:**
- [ ] Sum of "Cash Held" column = "Total Cash Held" KPI above
- [ ] Each agent row shows proper GHS amounts
- [ ] Status badges match oldest collection age
- [ ] Progress bars (if shown) add up to 100%

### Table Functionality
**Sorting:**
- [ ] Click column headers to sort
- [ ] Try sorting by: Agent Name, Cash Held, Oldest Collection
- [ ] Verify ascending/descending toggle works

**Filtering:**
- [ ] "Show Overdue Only" checkbox - filters to agents with collections > 7 days
- [ ] "Show Blocked Agents" checkbox - filters to blocked agents only
- [ ] Verify filters work correctly

**Search:**
- [ ] Type agent name or email in search box
- [ ] Verify table filters to matching results
- [ ] Clear search shows all agents again

**Actions:**
- [ ] Click "View Collections" on any agent
  - Opens modal/drawer with detailed collections
  - Shows list of orders with amounts and dates
  - Verify amounts match
  - Close modal
- [ ] "Send Reminder" button (if visible)
  - Should show confirmation or send reminder
- [ ] "Block/Unblock Agent" button
  - Should toggle agent status

**Export:**
- [ ] Click "Export CSV" button
- [ ] Verify file downloads with name like "agent-collections-YYYY-MM-DD.csv"
- [ ] Open CSV and verify data matches table

### No Duplication Check
- [ ] Verify Agent Collections shows DIFFERENT data than Overview
- [ ] Agent Collections = detailed per-agent breakdown
- [ ] Overview = high-level summary totals only

---

## ACCOUNTING & ANALYSIS TAB VERIFICATION

### Sub-Tab Navigation
- [ ] Verify 4 sub-tabs visible:
  - General Ledger
  - Financial Statements
  - Profitability Analysis
  - Expense Management
- [ ] Click each sub-tab and verify it switches content
- [ ] Verify active tab has blue underline indicator

---

### SUB-TAB 1: General Ledger

**Chart of Accounts Table:**
- [ ] Table shows GL accounts with columns:
  - Account Code (e.g., 1000, 1100, 2000)
  - Account Name (e.g., Cash, Accounts Receivable, Revenue)
  - Account Type (Asset, Liability, Revenue, Expense, Equity)
  - Current Balance (GHS amount)
- [ ] Verify accounts are grouped by type
- [ ] Verify balances are not all zero

**Account Actions:**
- [ ] Click "View Ledger" on any account
  - Should show account transactions
  - Columns: Date, Description, Debit, Credit, Balance
  - Verify running balance is correct
  - "Export CSV" button works
- [ ] Click "Back to Accounts" to return

**Record Journal Entry:**
- [ ] Click "Record Journal Entry" button
- [ ] Modal opens with form fields:
  - Date picker
  - Description textarea
  - Transaction rows (Account, Debit, Credit)
  - "Add Row" button
  - Balance indicator (Debits = Credits)
- [ ] Try to submit without balanced entries
  - Should show error "Debits must equal Credits"
- [ ] Click "Cancel" to close modal

**Data Integrity:**
- [ ] Asset accounts have debit balances (positive)
- [ ] Liability/Revenue accounts have credit balances
- [ ] Balance Sheet equation holds: Assets = Liabilities + Equity

---

### SUB-TAB 2: Financial Statements

**Income Statement (P&L):**
- [ ] Shows sections:
  - **Revenue** - Total from sales
  - **Cost of Goods Sold (COGS)** - Product costs
  - **Gross Profit** - Revenue - COGS
  - **Operating Expenses** - Breakdown by category (Logistics, Marketing, Office, Other)
  - **Net Income/Profit** - Gross Profit - Expenses

**Verification:**
- [ ] Revenue > 0 (from delivered orders)
- [ ] Gross Profit = Revenue - COGS
- [ ] Net Profit = Gross Profit - Total Expenses
- [ ] All amounts formatted as GHS with 2 decimals

**Balance Sheet:**
- [ ] Shows sections:
  - **Assets** - Cash, AR, Inventory, etc.
  - **Liabilities** - COD Payables, AP, etc.
  - **Equity** - Capital, Retained Earnings
- [ ] Verify equation: Total Assets = Total Liabilities + Total Equity

**Actions:**
- [ ] "Export PDF" button downloads formal statement
- [ ] Verify exported PDF has proper formatting

**Cross-Check:**
- [ ] Net Profit here = Net Profit on Overview tab (should match exactly)
- [ ] Total Expenses here = Total Expenses on Overview tab

---

### SUB-TAB 3: Profitability Analysis

**Profitability KPIs (4 cards):**
- [ ] **Gross Profit** - Revenue - COGS
- [ ] **Net Profit** - After all expenses
- [ ] **Total COGS** - Sum of product costs
- [ ] **Marketing & Shipping** - Combined operating expenses

**Profitability Trend Chart:**
- [ ] Line chart showing Revenue vs Gross Profit over time
- [ ] Two lines: Revenue (blue) and Gross Profit (green)
- [ ] Hover tooltip shows date and amounts

**Product Profitability Table:**
- [ ] Columns:
  - Product SKU
  - Product Name
  - Units Sold
  - Revenue (GHS)
  - COGS (GHS)
  - Gross Profit (GHS)
  - Margin % (calculated as Gross Profit / Revenue * 100)
- [ ] Verify margin % is calculated correctly for each product
- [ ] Products sorted by margin % (best sellers at top)

**Data Integrity:**
- [ ] Net Profit on this tab = Net Profit on Overview tab
- [ ] Total COGS for all products = Total COGS in KPI card
- [ ] Margin % for each product is between 0-100%
- [ ] Sum of product revenues ≈ Total Revenue (may differ slightly due to rounding)

**Export:**
- [ ] "Export CSV" or "Export Excel" button works
- [ ] File contains product profitability data

---

### SUB-TAB 4: Expense Management

**Expense Category Cards (4 cards):**
- [ ] **Logistics** - Delivery, shipping, fuel costs
- [ ] **Marketing** - Ads, promotions, social media
- [ ] **Office** - Rent, utilities, salaries
- [ ] **Other** - Miscellaneous expenses

**Verification:**
- [ ] Each card shows GHS amount
- [ ] Sum of 4 categories = Total Expenses on Overview tab

**Expense Breakdown Pie Chart:**
- [ ] Pie chart shows distribution across 4 categories
- [ ] Hover shows exact amount and percentage
- [ ] Legend matches category cards

**Expense Table:**
- [ ] Columns:
  - Date
  - Description
  - Category (Logistics/Marketing/Office/Other)
  - Amount (GHS)
  - Actions (Edit, Delete)
- [ ] Table shows recent expenses
- [ ] Verify amounts match category totals

**Table Functionality:**
- [ ] **Search:** Type description text to filter expenses
- [ ] **Filter by Category:** Dropdown to filter by single category
- [ ] **Sort:** Click column headers to sort

**Add Expense:**
- [ ] Click "Add Expense" button
- [ ] Modal opens with form:
  - Date picker
  - Amount input (number)
  - Category dropdown
  - Description textarea
  - Receipt upload (optional)
- [ ] Fill in test expense
- [ ] Click "Cancel" to close without saving
- [ ] (Optional) Add real expense and verify it appears in table

**Edit/Delete Expense:**
- [ ] Click "Edit" on any expense
  - Modal opens with pre-filled data
  - Make changes
  - Click "Cancel" to close without saving
- [ ] Click "Delete" on any expense (if allowed)
  - Confirmation dialog appears
  - Click "Cancel" to not delete

**Data Integrity:**
- [ ] Total Expenses (sum of table) = Total Expenses KPI on Overview tab
- [ ] Category totals (cards) = sum of respective category expenses in table

---

## CROSS-TAB DATA INTEGRITY CHECKS

These tests verify the SAME data shows consistently across all tabs:

### 1. Outstanding AR Consistency
- [ ] Overview Tab: Note "Outstanding AR" value
- [ ] Agent Collections Tab: Note "Total Cash Held" value
- [ ] ✅ **Both should be EXACTLY the same amount**

### 2. Total Expenses Consistency
- [ ] Overview Tab: Note "Total Expenses" value
- [ ] Accounting & Analysis → Expense Management: Sum all category cards
- [ ] ✅ **Both should be EXACTLY the same amount**

### 3. Net Profit Consistency (3-way check)
- [ ] Overview Tab: Note "Net Profit" value
- [ ] Accounting & Analysis → Financial Statements: Note "Net Income/Profit"
- [ ] Accounting & Analysis → Profitability Analysis: Note "Net Profit" KPI
- [ ] ✅ **All THREE should be EXACTLY the same amount**

### 4. Revenue Consistency
- [ ] Overview Tab: Note "Total Revenue" value
- [ ] Accounting & Analysis → Financial Statements: Note "Revenue" line
- [ ] Accounting & Analysis → Profitability Analysis: Sum product revenues
- [ ] ✅ **All should match (product sum may differ slightly due to other revenue sources)**

---

## PERFORMANCE & UX CHECKS

### Page Load Performance
- [ ] Open browser DevTools → Network tab
- [ ] Navigate to Financial page
- [ ] Verify page loads in < 5 seconds
- [ ] Check that API calls return quickly (< 2 seconds each)

### Tab Switching Performance
- [ ] Switch between Overview → Agent Collections → Accounting tabs
- [ ] Each switch should be instant or < 2 seconds
- [ ] No loading spinners for more than 2 seconds

### Console Errors
- [ ] Open browser DevTools → Console tab
- [ ] Navigate to Financial page and all tabs
- [ ] Verify NO critical errors (red text)
- [ ] Warnings (yellow) are acceptable if not breaking

### Empty State Handling
- [ ] If no data exists (fresh database), verify friendly messages:
  - "No agents found"
  - "No expenses recorded"
  - "No data available for selected period"
- [ ] Should NOT show broken UI, "NaN", or error messages

### Responsive Design (Optional)
- [ ] Resize browser to mobile width (375px)
- [ ] Verify KPI cards stack vertically
- [ ] Verify tables scroll horizontally or collapse
- [ ] Verify charts resize properly

---

## SUMMARY CHECKLIST

After completing all tests above:

- [ ] All KPIs display correct data (no NaN/undefined/null)
- [ ] All charts render with data
- [ ] All tables show data with proper formatting
- [ ] All actions (view, edit, delete, export) work correctly
- [ ] Cross-tab data is consistent (same values across tabs)
- [ ] No console errors
- [ ] Page performance is acceptable (< 5s load, < 2s tab switch)
- [ ] Date range filtering works (if tested)

---

## Known Issues / Expected Behavior

- **No GL Transaction History:** If database is fresh, GL accounts may have zero transactions. This is normal.
- **No Profitability Data:** If no products have COGS set, profitability may show "N/A". Add COGS to products in Products page.
- **Empty Expense List:** If no expenses recorded, Expense Management shows empty table. Use "Add Expense" to create test expense.
- **Agent Cash All Zero:** If no deliveries completed, agents won't have cash. This is normal for fresh imports.

---

## Reporting Issues

When reporting issues, please include:
1. **Screenshot** of the problem
2. **Browser Console Errors** (F12 → Console tab)
3. **Network Tab** errors (F12 → Network tab, filter by "Fetch/XHR")
4. **Steps to reproduce** the issue
5. **Expected vs Actual** behavior

---

## Automated Testing (Future)

Once the E2E tests are configured correctly with proper credentials and selectors, run:

```bash
npm run test:e2e:financial
```

This will automatically verify all the manual tests above in ~1 minute.

---

**✅ Testing Complete!** If all checks pass, the Financial Management module is working correctly.
