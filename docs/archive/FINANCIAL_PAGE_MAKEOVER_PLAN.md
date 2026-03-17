# Financial Page Makeover - Comprehensive Implementation Plan

**Created:** 2025-12-24
**Status:** Planned for Future Implementation
**Priority:** Post-MVP (Production Launch First)

---

## Business Context

**Multi-Country Operations:**
- Sell in Ghana (GHS), Kenya (KES)
- Receive payments weekly from delivery agents in Nigerian Naira (NGN)
- Customers pay in local currency (GHS in Ghana, KES in Kenya)
- Agents collect in local currency, convert to NGN, then remit weekly
- Base currency: Nigerian Naira (NGN) with flexibility to switch

**Current Financial Page Limitations:**
- No multi-currency support
- Basic transaction tracking (revenue, expenses, COD collections)
- No proper accounting/bookkeeping system
- No forex gains/losses tracking
- Limited expense management
- No financial statements (P&L, Balance Sheet, Cash Flow)
- No accounts receivable/payable
- No commission automation
- Basic reporting only

---

## PHASE 1: CORE MULTI-CURRENCY FOUNDATION

### 1.1 Multi-Currency Database Schema

**New Models:**

```prisma
model Currency {
  id        Int      @id @default(autoincrement())
  code      String   @unique // GHS, KES, NGN, USD
  name      String   // Ghana Cedi, Kenyan Shilling, etc.
  symbol    String   // ₵, KSh, ₦
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("currencies")
}

model ExchangeRate {
  id            Int      @id @default(autoincrement())
  fromCurrency  String   // GHS
  toCurrency    String   // NGN
  rate          Float    // 128.5
  effectiveDate DateTime
  source        String   // "api" or "manual"
  fetchedAt     DateTime @default(now())

  @@index([fromCurrency, toCurrency, effectiveDate])
  @@map("exchange_rates")
}

model CurrencyConversion {
  id             Int      @id @default(autoincrement())
  transactionId  Int?
  orderId        Int?
  fromAmount     Float
  fromCurrency   String
  toAmount       Float
  toCurrency     String
  rate           Float
  conversionDate DateTime
  createdAt      DateTime @default(now())

  @@index([transactionId])
  @@index([orderId])
  @@map("currency_conversions")
}

model SystemSettings {
  id               Int      @id @default(autoincrement())
  baseCurrency     String   @default("NGN")
  autoFetchRates   Boolean  @default(true)
  rateApiKey       String?
  rateApiProvider  String?  @default("exchangerate-api")
  updatedAt        DateTime @updatedAt

  @@map("system_settings")
}
```

**Updated Existing Models:**

```prisma
// Order model updates
model Order {
  // ... existing fields ...

  // New multi-currency fields
  currency              String   @default("NGN") // Order currency (GHS/KES/NGN)
  originalAmount        Float?   // Amount in original currency
  baseCurrencyAmount    Float?   // Amount converted to base currency
  exchangeRate          Float?   // Exchange rate used
  country               String?  // Ghana, Kenya, Nigeria

  // ... rest of fields ...
}

// Transaction model updates
model Transaction {
  // ... existing fields ...

  // New multi-currency fields
  currency           String @default("NGN")
  originalAmount     Float?
  baseCurrencyAmount Float?
  exchangeRate       Float?
  conversionId       Int?

  // ... rest of fields ...
}

// Product model updates
model Product {
  // ... existing fields ...

  // New multi-currency pricing
  prices Json? // {"GHS": 50, "KES": 150, "NGN": 5000}

  // ... rest of fields ...
}
```

### 1.2 Exchange Rate Service

**Features:**
- Integration with exchangerate-api.com (free tier: 1,500 requests/month)
- Alternative APIs: fixer.io, currencyapi.com
- Auto-fetch rates daily via cron job (midnight UTC)
- Manual rate override capability
- Historical rate storage
- Fallback to manual rates if API fails
- Support currencies: GHS, KES, NGN, USD

**API Endpoints:**
```
GET    /api/currencies                           - List active currencies
GET    /api/currencies/:code                     - Get currency details
POST   /api/currencies                           - Add currency (admin)
PATCH  /api/currencies/:code/toggle              - Activate/deactivate

GET    /api/exchange-rates                       - Get current rates
GET    /api/exchange-rates/history               - Historical rates
GET    /api/exchange-rates?from=GHS&to=NGN&date=2025-01-15 - Get specific rate
POST   /api/exchange-rates/fetch                 - Manually trigger rate fetch
POST   /api/exchange-rates/manual                - Set manual rate
DELETE /api/exchange-rates/:id                   - Delete rate

GET    /api/system-settings                      - Get system settings
PATCH  /api/system-settings/base-currency        - Change base currency
PATCH  /api/system-settings/rate-api             - Update API config
```

**Backend Service Methods:**
```typescript
class ExchangeRateService {
  async fetchLiveRates(baseCurrency: string): Promise<ExchangeRate[]>
  async getRate(from: string, to: string, date?: Date): Promise<number>
  async convertAmount(amount: number, from: string, to: string, date?: Date): Promise<ConversionResult>
  async setManualRate(from: string, to: string, rate: number): Promise<ExchangeRate>
  async getHistoricalRates(from: string, to: string, startDate: Date, endDate: Date): Promise<ExchangeRate[]>
}
```

### 1.3 Multi-Currency Order Processing

**Updates to Order Creation:**
1. Order created in customer's local currency (GHS in Ghana, KES in Kenya)
2. Store original amount and currency
3. Auto-convert to base currency (NGN) using current exchange rate
4. Store both original and converted amounts
5. Track exchange rate used for each order
6. Update financial summaries in base currency

**Checkout Form Updates:**
- Add country selector (Ghana, Kenya, Nigeria)
- Auto-set currency based on country
- Display prices in local currency
- Show NGN equivalent (optional)

---

## PHASE 2: ACCOUNTING & FINANCIAL STATEMENTS

### 2.1 Chart of Accounts

**Database Model:**
```prisma
model Account {
  id                Int       @id @default(autoincrement())
  code              String    @unique // 1000, 1100, 4000, etc.
  name              String    // Cash, Accounts Receivable, Sales Revenue
  type              String    // asset, liability, equity, revenue, expense
  subtype           String?   // current_asset, fixed_asset, etc.
  parentId          Int?
  balance           Float     @default(0)
  currency          String?   // If account is currency-specific
  isActive          Boolean   @default(true)
  description       String?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  parent            Account?  @relation("AccountHierarchy", fields: [parentId], references: [id])
  children          Account[] @relation("AccountHierarchy")
  journalEntryLines JournalEntryLine[]

  @@index([type, isActive])
  @@map("accounts")
}
```

**Predefined Chart of Accounts for COD Business:**

**Assets (1000-1999):**
- 1000: Cash and Cash Equivalents
  - 1010: Cash - Ghana (GHS)
  - 1020: Cash - Kenya (KES)
  - 1030: Cash - Nigeria (NGN)
- 1100: Bank Accounts
  - 1110: Bank - Ghana (GHS)
  - 1120: Bank - Kenya (KES)
  - 1130: Bank - Nigeria (NGN)
- 1200: Accounts Receivable
  - 1210: Customer Receivables
  - 1220: Agent Settlements Receivable
- 1300: Inventory
  - 1310: Product Inventory

**Liabilities (2000-2999):**
- 2000: Accounts Payable
  - 2010: Vendor Payables
  - 2020: Agent Settlements Payable
- 2100: Accrued Expenses
  - 2110: Accrued Commissions
  - 2120: Accrued Delivery Fees

**Equity (3000-3999):**
- 3000: Owner's Equity
- 3100: Retained Earnings

**Revenue (4000-4999):**
- 4000: Product Sales
  - 4010: Sales - Ghana (GHS)
  - 4020: Sales - Kenya (KES)
  - 4030: Sales - Nigeria (NGN)
- 4100: Shipping Revenue
- 4200: Other Income
  - 4210: Forex Gains

**Expenses (5000-5999):**
- 5000: Cost of Goods Sold
  - 5010: COGS - Ghana
  - 5020: COGS - Kenya
  - 5030: COGS - Nigeria
- 5100: Delivery Expenses
  - 5110: Delivery Fees
  - 5120: Fuel & Vehicle Maintenance
- 5200: Commission Expenses
  - 5210: Sales Rep Commissions
  - 5220: Agent Commissions
- 5300: Marketing & Advertising
- 5400: Operating Expenses
  - 5410: Rent
  - 5420: Utilities
  - 5430: Office Supplies
  - 5440: Technology & Software
- 5500: Forex Losses

### 2.2 Double-Entry Journal System

**Database Models:**
```prisma
model JournalEntry {
  id          Int      @id @default(autoincrement())
  entryNumber String   @unique
  entryDate   DateTime
  description String
  reference   String?  // Order ID, Invoice ID, etc.
  status      String   @default("draft") // draft, posted, void
  createdBy   Int?
  postedBy    Int?
  postedAt    DateTime?
  notes       String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  lines       JournalEntryLine[]

  @@index([status, entryDate])
  @@map("journal_entries")
}

model JournalEntryLine {
  id              Int     @id @default(autoincrement())
  journalEntryId  Int
  accountId       Int
  debit           Float   @default(0)
  credit          Float   @default(0)
  description     String?
  currency        String? // Original currency if different from base
  originalAmount  Float?  // Amount in original currency
  exchangeRate    Float?
  createdAt       DateTime @default(now())

  journalEntry    JournalEntry @relation(fields: [journalEntryId], references: [id], onDelete: Cascade)
  account         Account      @relation(fields: [accountId], references: [id])

  @@index([journalEntryId])
  @@index([accountId])
  @@map("journal_entry_lines")
}
```

**Automatic Journal Entries for COD Flow:**

**Example: Order Delivered (GHS 100 → NGN 12,800 @ rate 128)**
```
Date: 2025-01-15
Description: Order #12345 delivered - Ghana
Reference: ORD-12345

Debit:  Accounts Receivable (1220) - NGN 12,800 (GHS 100 @ 128)
Credit: Sales Revenue - Ghana (4010)  - NGN 12,800

(Original: GHS 100, Exchange Rate: 128, Base: NGN 12,800)
```

**When Agent Collects COD:**
```
Debit:  Cash - Ghana (1010)         - NGN 12,800
Credit: Accounts Receivable (1220) - NGN 12,800
```

**When Agent Converts & Remits (actual rate 125, forex loss):**
```
Debit:  Cash - Nigeria (1030)      - NGN 12,500 (actual remittance)
Debit:  Forex Losses (5500)        - NGN 300 (loss from conversion)
Credit: Cash - Ghana (1010)         - NGN 12,800
```

### 2.3 Profit & Loss Statement

**Features:**
- Multi-currency revenue breakdown by country
- All amounts converted to base currency (NGN)
- Period selection (This Month, Quarter, Year, Custom)
- Comparison mode (vs. Previous Period, vs. Last Year)
- Drill-down to transaction details
- Export to PDF/Excel

**Structure:**
```
PROFIT & LOSS STATEMENT
For the Period: January 1 - January 31, 2025
Currency: NGN (Base Currency)

REVENUE
  Product Sales
    Ghana (GHS 10,000 @ avg 128)      NGN 1,280,000
    Kenya (KES 50,000 @ avg 3.2)      NGN   160,000
    Nigeria                            NGN   500,000
  Total Product Sales                  NGN 1,940,000

  Shipping Revenue                     NGN    50,000
  Other Income                         NGN    10,000
  Forex Gains                          NGN    15,000
TOTAL REVENUE                          NGN 2,015,000

COST OF GOODS SOLD
  COGS - Ghana                         NGN   640,000
  COGS - Kenya                         NGN    80,000
  COGS - Nigeria                       NGN   250,000
TOTAL COGS                             NGN   970,000

GROSS PROFIT                           NGN 1,045,000
Gross Margin: 51.9%

OPERATING EXPENSES
  Delivery Expenses
    Delivery Fees                      NGN   150,000
    Fuel & Maintenance                 NGN    50,000
  Total Delivery Expenses              NGN   200,000

  Commission Expenses
    Sales Rep Commissions              NGN   100,000
    Agent Commissions                  NGN    50,000
  Total Commission Expenses            NGN   150,000

  Marketing & Advertising              NGN    80,000
  Rent & Utilities                     NGN    60,000
  Technology & Software                NGN    30,000
  Other Operating Expenses             NGN    40,000
  Forex Losses                         NGN    25,000
TOTAL OPERATING EXPENSES               NGN   585,000

NET PROFIT                             NGN   460,000
Net Margin: 22.8%
```

**API Endpoint:**
```
GET /api/financial/statements/profit-loss?startDate=2025-01-01&endDate=2025-01-31&currency=NGN
```

**Response:**
```json
{
  "period": {
    "startDate": "2025-01-01",
    "endDate": "2025-01-31"
  },
  "currency": "NGN",
  "revenue": {
    "productSales": {
      "byCountry": [
        {
          "country": "Ghana",
          "currency": "GHS",
          "amount": 10000,
          "exchangeRate": 128,
          "baseAmount": 1280000
        },
        {
          "country": "Kenya",
          "currency": "KES",
          "amount": 50000,
          "exchangeRate": 3.2,
          "baseAmount": 160000
        }
      ],
      "total": 1940000
    },
    "shippingRevenue": 50000,
    "otherIncome": 10000,
    "forexGains": 15000,
    "total": 2015000
  },
  "cogs": {
    "byCountry": [...],
    "total": 970000
  },
  "grossProfit": 1045000,
  "grossMargin": 51.9,
  "operatingExpenses": {
    "categories": [...],
    "total": 585000
  },
  "netProfit": 460000,
  "netMargin": 22.8
}
```

### 2.4 Balance Sheet

**Structure:**
```
BALANCE SHEET
As of: January 31, 2025
Currency: NGN (Base Currency)

ASSETS
  Current Assets
    Cash & Cash Equivalents
      Cash - Ghana (GHS 5,000 @ 128)   NGN   640,000
      Cash - Kenya (KES 20,000 @ 3.2)  NGN    64,000
      Cash - Nigeria                    NGN   500,000
    Total Cash                          NGN 1,204,000

    Bank Accounts
      Bank - Ghana (GHS 50,000 @ 128)  NGN 6,400,000
      Bank - Kenya (KES 100,000 @ 3.2) NGN   320,000
      Bank - Nigeria                    NGN 3,000,000
    Total Bank                          NGN 9,720,000

    Accounts Receivable                 NGN   800,000
    Inventory                           NGN 2,000,000
  Total Current Assets                  NGN 13,724,000

  Non-Current Assets
    Fixed Assets                        NGN 1,000,000
  Total Non-Current Assets              NGN 1,000,000

TOTAL ASSETS                            NGN 14,724,000

LIABILITIES
  Current Liabilities
    Accounts Payable                    NGN   500,000
    Agent Settlements Payable           NGN   300,000
    Accrued Commissions                 NGN   150,000
  Total Current Liabilities             NGN   950,000

TOTAL LIABILITIES                       NGN   950,000

EQUITY
  Owner's Equity                        NGN 10,000,000
  Retained Earnings                     NGN  3,774,000
TOTAL EQUITY                            NGN 13,774,000

TOTAL LIABILITIES & EQUITY              NGN 14,724,000

Key Ratios:
  Current Ratio: 14.4
  Quick Ratio: 12.3
  Debt-to-Equity: 0.07
```

### 2.5 Cash Flow Statement

**Structure:**
```
CASH FLOW STATEMENT
For the Period: January 1 - January 31, 2025
Currency: NGN (Base Currency)

OPERATING ACTIVITIES
  Net Profit                            NGN   460,000
  Adjustments:
    Inventory Decrease                  NGN   200,000
    AR Increase                         NGN  (150,000)
    AP Increase                         NGN   100,000
    Forex Losses (non-cash)             NGN    25,000
  Cash from Operations                  NGN   635,000

INVESTING ACTIVITIES
  Purchase of Fixed Assets              NGN  (200,000)
  Cash from Investing                   NGN  (200,000)

FINANCING ACTIVITIES
  Owner Contributions                   NGN         0
  Distributions                         NGN  (100,000)
  Cash from Financing                   NGN  (100,000)

NET CHANGE IN CASH                      NGN   335,000
Beginning Cash Balance                  NGN 10,589,000
Ending Cash Balance                     NGN 10,924,000

Breakdown by Currency:
  Ghana (GHS):  Opening 4,000 → Closing 5,000 (↑ 1,000 GHS)
  Kenya (KES):  Opening 15,000 → Closing 20,000 (↑ 5,000 KES)
  Nigeria (NGN): Opening 500,000 → Closing 500,000 (→)
```

---

## PHASE 3: COD MULTI-CURRENCY MANAGEMENT

### 3.1 COD Collection Dashboard by Country

**Dashboard Layout:**

**Top Summary Cards:**
1. **Total COD Pending Collection** (all countries in NGN)
2. **Total COD Collected** (not yet deposited, in NGN)
3. **Total COD Deposited** (in bank, in NGN)
4. **Pending Settlements** (owed to business, in NGN)

**Country Sections:**

**Ghana Section:**
```
┌─────────────────────────────────────────────────┐
│ GHANA (GHS → NGN)                               │
│ Exchange Rate Today: 1 GHS = 128 NGN            │
├─────────────────────────────────────────────────┤
│ COD Pending Collection:    GHS 5,000  (NGN 640,000)  │
│ COD Collected (with agents): GHS 10,000 (NGN 1,280,000) │
│ COD Deposited to Bank:     GHS 8,000  (NGN 1,024,000)  │
│ Pending Settlement:        GHS 2,000  (NGN 256,000)    │
│                                                 │
│ Forex Impact This Week:    ↓ NGN 15,000 (loss) │
└─────────────────────────────────────────────────┘
```

**Kenya Section:**
```
┌─────────────────────────────────────────────────┐
│ KENYA (KES → NGN)                               │
│ Exchange Rate Today: 1 KES = 3.2 NGN           │
├─────────────────────────────────────────────────┤
│ COD Pending Collection:    KES 20,000 (NGN 64,000)    │
│ COD Collected (with agents): KES 50,000 (NGN 160,000) │
│ COD Deposited to Bank:     KES 40,000 (NGN 128,000)   │
│ Pending Settlement:        KES 10,000 (NGN 32,000)    │
│                                                 │
│ Forex Impact This Week:    ↑ NGN 5,000 (gain)  │
└─────────────────────────────────────────────────┘
```

**Consolidated View:**
```
┌─────────────────────────────────────────────────┐
│ CONSOLIDATED (All Countries in NGN)            │
├─────────────────────────────────────────────────┤
│ Total COD Pending:         NGN 1,204,000        │
│ Total COD Collected:       NGN 1,440,000        │
│ Total COD Deposited:       NGN 1,152,000        │
│ Total Pending Settlement:  NGN 288,000          │
│                                                 │
│ Net Forex Impact (Week):   ↓ NGN 10,000 (loss) │
└─────────────────────────────────────────────────┘
```

### 3.2 Agent Settlement Multi-Currency Workflow

**Settlement Process:**

**Step 1: Agent Collects COD in Local Currency**
- Agent delivers orders in Ghana, collects GHS 1,000

**Step 2: Track Collection**
```json
{
  "agentId": 45,
  "orderId": 12345,
  "collectedAmount": 1000,
  "collectedCurrency": "GHS",
  "collectionDate": "2025-01-15",
  "officialExchangeRate": 128, // From system
  "expectedNGN": 128000
}
```

**Step 3: Agent Converts to NGN**
- Agent uses local money changer
- Actual rate obtained: 1 GHS = 125 NGN
- Agent remits: NGN 125,000

**Step 4: Record Settlement**
```json
{
  "agentId": 45,
  "settlementPeriod": "2025-W03", // Week 3 of 2025
  "collectionsLocal": [
    {
      "orderId": 12345,
      "amount": 1000,
      "currency": "GHS"
    }
  ],
  "totalLocalCurrency": 1000,
  "localCurrency": "GHS",
  "officialExchangeRate": 128,
  "expectedNGN": 128000,
  "actualExchangeRate": 125,
  "actualNGNRemitted": 125000,
  "forexVariance": -3000, // Loss
  "variancePercentage": -2.34,
  "remittanceDate": "2025-01-21",
  "remittanceReference": "BANK-REF-123",
  "status": "completed"
}
```

**Step 5: Generate Settlement Report**

```
AGENT SETTLEMENT REPORT
Agent: John Doe (ID: 45)
Country: Ghana
Period: Week 3, 2025 (Jan 15-21)
─────────────────────────────────────────────────

COLLECTIONS SUMMARY:
Total Orders Delivered:        15 orders
Total COD Collected:           GHS 1,000

CONVERSION DETAILS:
Official Exchange Rate (avg):  1 GHS = 128 NGN
Expected NGN:                  NGN 128,000

Actual Exchange Rate Used:     1 GHS = 125 NGN
Actual NGN Remitted:           NGN 125,000

FOREX VARIANCE:
Variance Amount:               NGN -3,000
Variance Percentage:           -2.34%
Status:                        LOSS

REMITTANCE DETAILS:
Remittance Date:               Jan 21, 2025
Bank Reference:                BANK-REF-123
Verified By:                   Admin User

FINANCIAL IMPACT:
- Added to Forex Losses (Expense Account)
- Recorded in Journal Entry #JE-2025-0156

Status: ✓ COMPLETED & RECONCILED
```

**API Endpoints:**
```
GET    /api/financial/cod/by-country                    - COD summary by country
GET    /api/financial/cod/by-country/:country           - Specific country details
GET    /api/financial/agent-settlements                 - List settlements
GET    /api/financial/agent-settlements/:id             - Settlement details
POST   /api/financial/agent-settlements                 - Create settlement
PATCH  /api/financial/agent-settlements/:id/verify      - Verify settlement
GET    /api/financial/agent-settlements/forex-variance  - Forex variance report
```

### 3.3 Forex Gains/Losses Tracking

**Track Forex Impact:**

**Scenario 1: Favorable Rate (Gain)**
- Expected: 1 KES = 3.2 NGN (1,000 KES = 3,200 NGN)
- Actual: 1 KES = 3.3 NGN (1,000 KES = 3,300 NGN)
- Gain: +100 NGN (Credit to "Forex Gains" account)

**Scenario 2: Unfavorable Rate (Loss)**
- Expected: 1 GHS = 128 NGN (1,000 GHS = 128,000 NGN)
- Actual: 1 GHS = 125 NGN (1,000 GHS = 125,000 NGN)
- Loss: -3,000 NGN (Debit to "Forex Losses" account)

**Forex Impact Report:**
```
FOREX IMPACT REPORT
Period: January 2025
Currency: NGN (Base)

BY COUNTRY:
Ghana (GHS → NGN)
  Total Collections:     GHS 10,000
  Expected NGN:          NGN 1,280,000 (@ avg 128)
  Actual NGN Received:   NGN 1,250,000 (@ avg 125)
  Variance:              NGN -30,000 (loss)

Kenya (KES → NGN)
  Total Collections:     KES 50,000
  Expected NGN:          NGN 160,000 (@ avg 3.2)
  Actual NGN Received:   NGN 165,000 (@ avg 3.3)
  Variance:              NGN +5,000 (gain)

TOTAL FOREX IMPACT:
  Gains:                 NGN 5,000
  Losses:                NGN 30,000
  Net Impact:            NGN -25,000 (loss)

Impact on Profit Margin: -1.24%
```

---

## PHASE 4: REVENUE & EXPENSE MANAGEMENT

### 4.1 Revenue Dashboard by Country

**Features:**
- Revenue breakdown by country (Ghana, Kenya, Nigeria)
- View in local currency or base currency (NGN)
- Period comparison
- Revenue trends with currency composition
- Top products by country
- Customer metrics by country

**Dashboard Components:**

**Revenue Cards by Country:**
```
┌────────────────────────────┐  ┌────────────────────────────┐
│ GHANA                      │  │ KENYA                      │
│ 🇬🇭                        │  │ 🇰🇪                        │
│                            │  │                            │
│ GHS 10,000                 │  │ KES 50,000                 │
│ ≈ NGN 1,280,000            │  │ ≈ NGN 160,000              │
│                            │  │                            │
│ 250 Orders | AOV: GHS 40   │  │ 150 Orders | AOV: KES 333  │
│ ↑ 15% vs last month        │  │ ↑ 8% vs last month         │
└────────────────────────────┘  └────────────────────────────┘

┌────────────────────────────┐
│ NIGERIA                    │
│ 🇳🇬                        │
│                            │
│ NGN 500,000                │
│                            │
│ 100 Orders | AOV: NGN 5,000│
│ ↑ 20% vs last month        │
└────────────────────────────┘
```

**Revenue Composition Chart:**
- Stacked bar chart showing revenue by country over time
- Each country in different color
- Tooltip shows local currency + NGN equivalent

**Top Products by Country Table:**
```
┌─────────────┬─────────┬────────┬────────────┬──────────┐
│ Product     │ Country │ Sales  │ Orders     │ Revenue  │
├─────────────┼─────────┼────────┼────────────┼──────────┤
│ Product A   │ Ghana   │ GHS    │ 150        │ 6,000    │
│ Product B   │ Kenya   │ KES    │ 100        │ 30,000   │
│ Product C   │ Nigeria │ NGN    │ 80         │ 400,000  │
└─────────────┴─────────┴────────┴────────────┴──────────┘
```

### 4.2 Multi-Currency Expense Management

**Expense Entry Form:**
```
┌─────────────────────────────────────────────┐
│ RECORD EXPENSE                              │
├─────────────────────────────────────────────┤
│ Category: [Operating Expenses ▼]            │
│ Amount: [_____] Currency: [GHS ▼]           │
│ ≈ NGN 12,800 (at current rate 1:128)       │
│                                             │
│ Description: [____________________________] │
│ Date: [2025-01-15]                          │
│ Receipt: [Upload File]                      │
│ Vendor: [Vendor Name (optional)]            │
│ Payment Method: [Cash/Bank/Mobile Money ▼]  │
│                                             │
│ [Cancel]  [Submit for Approval]             │
└─────────────────────────────────────────────┘
```

**Expense List with Currency:**
```
┌────────┬─────────────┬───────────┬────────────┬──────────┬────────┐
│ Date   │ Category    │ Amount    │ Currency   │ Base     │ Status │
│        │             │           │            │ (NGN)    │        │
├────────┼─────────────┼───────────┼────────────┼──────────┼────────┤
│ Jan 15 │ Fuel        │ 500       │ GHS        │ 64,000   │ Paid   │
│ Jan 16 │ Marketing   │ 5,000     │ KES        │ 16,000   │ Paid   │
│ Jan 17 │ Rent        │ 200,000   │ NGN        │ 200,000  │ Paid   │
└────────┴─────────────┴───────────┴────────────┴──────────┴────────┘
```

**Expense Summary by Currency:**
```
EXPENSE SUMMARY - January 2025
Base Currency: NGN

By Currency:
  Ghana (GHS):       GHS 5,000   → NGN 640,000
  Kenya (KES):       KES 20,000  → NGN 64,000
  Nigeria (NGN):     NGN 500,000 → NGN 500,000
  ─────────────────────────────────────────
  Total (NGN):                     NGN 1,204,000

By Category:
  Delivery Expenses: NGN 400,000 (33.2%)
  Marketing:         NGN 300,000 (24.9%)
  Rent & Utilities:  NGN 200,000 (16.6%)
  Other:             NGN 304,000 (25.3%)
```

---

## PHASE 5: REPORTING & ANALYTICS

### 5.1 Multi-Currency Financial Reports

**Currency Selector Feature:**
- All reports can be viewed in any active currency
- Dropdown: [View in: NGN ▼] (options: GHS, KES, NGN, USD)
- Live conversion using current exchange rates
- Historical reports use historical rates

**Example: P&L in Multiple Currencies**

**View in NGN (Base):**
```
Revenue:  NGN 2,015,000
Expenses: NGN 1,555,000
Profit:   NGN 460,000
```

**View in GHS:**
```
Revenue:  GHS 15,742.19 (converted @ 128)
Expenses: GHS 12,148.44
Profit:   GHS 3,593.75
```

**View in USD:**
```
Revenue:  USD 2,518.75 (converted @ 800 NGN/USD)
Expenses: USD 1,943.75
Profit:   USD 575.00
```

### 5.2 Forex Analysis Reports

**1. Exchange Rate Trends:**
- Line chart showing GHS→NGN and KES→NGN rates over time
- Identify currency volatility
- Forecast future rates (optional)

**2. Forex Variance Analysis:**
```
FOREX VARIANCE ANALYSIS
Period: Q1 2025

Ghana Operations:
  Expected Collections (@ official rate):  NGN 3,840,000
  Actual Collections (@ agent rate):       NGN 3,750,000
  Variance:                                NGN -90,000 (-2.34%)

Kenya Operations:
  Expected Collections (@ official rate):  NGN 480,000
  Actual Collections (@ agent rate):       NGN 495,000
  Variance:                                NGN +15,000 (+3.13%)

Total Forex Impact:                        NGN -75,000 (loss)
```

**3. Currency Exposure Report:**
```
CURRENCY EXPOSURE
As of: January 31, 2025

Pending COD Collections:
  Ghana (GHS 5,000):    NGN 640,000 (exposed to GHS volatility)
  Kenya (KES 20,000):   NGN 64,000 (exposed to KES volatility)

Agent Holdings (collected, not yet remitted):
  Ghana (GHS 10,000):   NGN 1,280,000
  Kenya (KES 50,000):   NGN 160,000

Total Currency Exposure: NGN 2,144,000
Risk: Exchange rate changes before remittance
```

### 5.3 Country Performance Dashboard

**Metrics by Country:**

**Ghana:**
- Revenue: GHS 10,000 (NGN 1,280,000)
- Orders: 250
- AOV: GHS 40
- Gross Profit: GHS 5,000 (50% margin)
- Customer Count: 180
- Repeat Rate: 35%
- Top Products: [list]
- Growth Rate: +15% MoM

**Kenya:**
- Revenue: KES 50,000 (NGN 160,000)
- Orders: 150
- AOV: KES 333
- Gross Profit: KES 25,000 (50% margin)
- Customer Count: 100
- Repeat Rate: 28%
- Top Products: [list]
- Growth Rate: +8% MoM

**Comparison:**
- Most profitable country: Ghana (higher revenue)
- Highest AOV: Nigeria (NGN 5,000)
- Best repeat rate: Ghana (35%)
- Fastest growing: Nigeria (+20%)

---

## PHASE 6: ADVANCED FEATURES (Post-MVP)

### 6.1 Bank Reconciliation

**Features:**
- Upload bank statements (CSV/Excel)
- Auto-match transactions
- Handle multi-currency bank accounts
- Reconciliation reports

### 6.2 Accounts Receivable/Payable

**AR Features:**
- Customer invoices in local currency
- Aging reports by currency
- Payment tracking

**AP Features:**
- Vendor bills in local/base currency
- Payment scheduling
- Vendor management

### 6.3 Budget Management

**Features:**
- Set budgets by country and category
- Budget vs. actual in multiple currencies
- Variance alerts

### 6.4 Commission Automation

**Features:**
- Auto-calculate commissions in local currency
- Pay in local or base currency
- Multi-currency commission reports

### 6.5 Tax Management

**Features:**
- Tax rates by country (VAT, GST)
- Tax calculation in local currency
- Tax reports for compliance

---

## TECHNICAL IMPLEMENTATION DETAILS

### Frontend Components (Shadcn UI)

**New Components:**

1. **CurrencySelector**
```tsx
<CurrencySelector
  value={selectedCurrency}
  onChange={setCurrency}
  currencies={['GHS', 'KES', 'NGN', 'USD']}
/>
```

2. **MultiCurrencyAmount**
```tsx
<MultiCurrencyAmount
  amount={1000}
  currency="GHS"
  baseCurrency="NGN"
  exchangeRate={128}
  showBoth={true}
/>
// Displays: "GHS 1,000 (≈ NGN 128,000)"
```

3. **ExchangeRateIndicator**
```tsx
<ExchangeRateIndicator
  from="GHS"
  to="NGN"
  rate={128}
  lastUpdated="2025-01-15T10:00:00Z"
  trend="up"
/>
// Displays: "1 GHS = 128 NGN ↑ (updated 2 hours ago)"
```

4. **CountryRevenueCard**
```tsx
<CountryRevenueCard
  country="Ghana"
  flag="🇬🇭"
  currency="GHS"
  amount={10000}
  baseCurrency="NGN"
  baseAmount={1280000}
  orders={250}
  aov={40}
  growth={15}
/>
```

5. **ForexImpactChart**
```tsx
<ForexImpactChart
  data={forexData}
  period="monthly"
  showGains={true}
  showLosses={true}
/>
```

6. **AgentSettlementForm**
```tsx
<AgentSettlementForm
  agentId={45}
  country="Ghana"
  collections={collectionsData}
  onSubmit={handleSettlement}
/>
```

7. **PLStatement**
```tsx
<PLStatement
  startDate="2025-01-01"
  endDate="2025-01-31"
  currency={selectedCurrency}
  showMultiCurrency={true}
  showComparison={true}
/>
```

8. **BalanceSheet**
```tsx
<BalanceSheet
  asOfDate="2025-01-31"
  currency={selectedCurrency}
  showCurrencyBreakdown={true}
/>
```

9. **CashFlowStatement**
```tsx
<CashFlowStatement
  startDate="2025-01-01"
  endDate="2025-01-31"
  currency={selectedCurrency}
/>
```

### Backend Services

**1. ExchangeRateService**
```typescript
class ExchangeRateService {
  private apiProvider: string;
  private apiKey: string;

  async fetchLiveRates(baseCurrency: string): Promise<ExchangeRate[]>;
  async getRate(from: string, to: string, date?: Date): Promise<number>;
  async convertAmount(
    amount: number,
    from: string,
    to: string,
    date?: Date
  ): Promise<{
    amount: number;
    rate: number;
    convertedAmount: number;
  }>;
  async setManualRate(from: string, to: string, rate: number): Promise<void>;
  async getHistoricalRates(
    from: string,
    to: string,
    startDate: Date,
    endDate: Date
  ): Promise<ExchangeRate[]>;
}
```

**2. MultiCurrencyFinancialService**
```typescript
class MultiCurrencyFinancialService {
  async getRevenueByCountry(
    startDate: Date,
    endDate: Date,
    currency: string
  ): Promise<CountryRevenue[]>;

  async getCODByCountry(
    country: string,
    currency: string
  ): Promise<CODSummary>;

  async processAgentSettlement(
    agentId: number,
    settlementData: SettlementData
  ): Promise<Settlement>;

  async calculateForexImpact(
    startDate: Date,
    endDate: Date
  ): Promise<ForexImpact>;

  async getProfitLoss(
    startDate: Date,
    endDate: Date,
    currency: string
  ): Promise<PLStatement>;

  async getBalanceSheet(
    asOfDate: Date,
    currency: string
  ): Promise<BalanceSheet>;
}
```

**3. AccountingService**
```typescript
class AccountingService {
  async createJournalEntry(
    entry: JournalEntryData
  ): Promise<JournalEntry>;

  async postJournalEntry(entryId: number): Promise<void>;

  async getGeneralLedger(
    accountId: number,
    startDate: Date,
    endDate: Date
  ): Promise<LedgerEntry[]>;

  async getTrialBalance(asOfDate: Date): Promise<TrialBalance>;

  async getChartOfAccounts(): Promise<Account[]>;

  async recordOrderDelivery(orderId: number): Promise<void>;
  async recordCODCollection(collectionId: number): Promise<void>;
  async recordExpense(expenseId: number): Promise<void>;
}
```

### Zustand Stores

**1. currencyStore**
```typescript
interface CurrencyState {
  currencies: Currency[];
  exchangeRates: ExchangeRate[];
  baseCurrency: string;
  selectedDisplayCurrency: string;

  fetchCurrencies: () => Promise<void>;
  fetchExchangeRates: () => Promise<void>;
  getRate: (from: string, to: string, date?: Date) => number;
  convertAmount: (amount: number, from: string, to: string) => number;
  setBaseCurrency: (currency: string) => Promise<void>;
  setDisplayCurrency: (currency: string) => void;
}
```

**2. accountingStore**
```typescript
interface AccountingState {
  accounts: Account[];
  journalEntries: JournalEntry[];
  generalLedger: LedgerEntry[];

  fetchChartOfAccounts: () => Promise<void>;
  createJournalEntry: (entry: JournalEntryData) => Promise<void>;
  postJournalEntry: (entryId: number) => Promise<void>;
  fetchGeneralLedger: (accountId: number) => Promise<void>;
}
```

**3. statementsStore**
```typescript
interface StatementsState {
  profitLoss: PLStatement | null;
  balanceSheet: BalanceSheet | null;
  cashFlow: CashFlowStatement | null;

  fetchProfitLoss: (startDate: Date, endDate: Date, currency: string) => Promise<void>;
  fetchBalanceSheet: (asOfDate: Date, currency: string) => Promise<void>;
  fetchCashFlow: (startDate: Date, endDate: Date, currency: string) => Promise<void>;
}
```

**4. Updated financialStore**
```typescript
interface FinancialState {
  // Existing fields...

  // New multi-currency fields
  revenueByCountry: CountryRevenue[];
  codByCountry: CODByCountry[];
  forexImpact: ForexImpact | null;

  fetchRevenueByCountry: (startDate: Date, endDate: Date) => Promise<void>;
  fetchCODByCountry: () => Promise<void>;
  fetchForexImpact: (startDate: Date, endDate: Date) => Promise<void>;
  processAgentSettlement: (settlementData: SettlementData) => Promise<void>;
}
```

### Cron Jobs

**1. Daily Exchange Rate Fetch**
```typescript
// Schedule: Every day at 00:00 UTC
cron.schedule('0 0 * * *', async () => {
  try {
    const baseCurrency = await getBaseCurrency();
    await exchangeRateService.fetchLiveRates(baseCurrency);
    logger.info('Exchange rates updated successfully');
  } catch (error) {
    logger.error('Failed to fetch exchange rates', error);
    // Send alert to admin
  }
});
```

**2. Weekly Settlement Reminders**
```typescript
// Schedule: Every Monday at 09:00 local time
cron.schedule('0 9 * * 1', async () => {
  const agents = await getAgentsWithPendingSettlements();
  for (const agent of agents) {
    await sendSettlementReminder(agent);
  }
});
```

---

## MIGRATION & DEPLOYMENT PLAN

### Database Migration Steps

**1. Add Multi-Currency Tables**
```bash
npx prisma migrate dev --name add-multi-currency-support
```

**2. Seed Initial Data**
```typescript
// seeds/currencies.ts
const currencies = [
  { code: 'GHS', name: 'Ghana Cedi', symbol: '₵' },
  { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh' },
  { code: 'NGN', name: 'Nigerian Naira', symbol: '₦' },
  { code: 'USD', name: 'US Dollar', symbol: '$' }
];

// seeds/chart-of-accounts.ts
const accounts = [
  // Asset accounts (1000-1999)
  { code: '1010', name: 'Cash - Ghana', type: 'asset', currency: 'GHS' },
  { code: '1020', name: 'Cash - Kenya', type: 'asset', currency: 'KES' },
  // ... rest of accounts
];
```

**3. Backfill Existing Data**
```typescript
// Migration script to add currency to existing orders
const backfillOrderCurrencies = async () => {
  const orders = await prisma.order.findMany();

  for (const order of orders) {
    const country = await determineCountryFromAddress(order.deliveryState);
    const currency = getCurrencyForCountry(country);

    await prisma.order.update({
      where: { id: order.id },
      data: {
        currency,
        country,
        originalAmount: order.totalAmount,
        baseCurrencyAmount: order.totalAmount,
        exchangeRate: 1 // Assuming historical orders in base currency
      }
    });
  }
};
```

### Deployment Checklist

**Pre-Deployment:**
- [ ] Run all database migrations
- [ ] Seed currencies and exchange rates
- [ ] Seed chart of accounts
- [ ] Backfill existing data with currency info
- [ ] Test exchange rate API integration
- [ ] Run unit tests for multi-currency logic
- [ ] Run integration tests for financial flows

**Deployment:**
- [ ] Deploy backend with new endpoints
- [ ] Deploy frontend with new components
- [ ] Set up cron jobs for exchange rate fetching
- [ ] Configure environment variables (API keys)
- [ ] Enable multi-currency in system settings

**Post-Deployment:**
- [ ] Verify exchange rates are fetching correctly
- [ ] Test order creation in different currencies
- [ ] Test agent settlement workflow
- [ ] Verify financial statements calculations
- [ ] Monitor for errors in logs
- [ ] Collect user feedback

---

## TESTING STRATEGY

### Unit Tests

**1. Currency Conversion Tests**
```typescript
describe('ExchangeRateService', () => {
  it('should convert GHS to NGN correctly', async () => {
    const result = await exchangeRateService.convertAmount(100, 'GHS', 'NGN');
    expect(result.convertedAmount).toBe(12800); // @ rate 128
  });

  it('should handle unavailable rates gracefully', async () => {
    await expect(
      exchangeRateService.getRate('XYZ', 'NGN')
    ).rejects.toThrow('Exchange rate not found');
  });
});
```

**2. Multi-Currency Financial Calculations**
```typescript
describe('MultiCurrencyFinancialService', () => {
  it('should calculate revenue by country correctly', async () => {
    const revenue = await service.getRevenueByCountry(startDate, endDate, 'NGN');
    expect(revenue).toHaveLength(3); // Ghana, Kenya, Nigeria
    expect(revenue[0].country).toBe('Ghana');
    expect(revenue[0].currency).toBe('GHS');
    expect(revenue[0].baseCurrencyAmount).toBeGreaterThan(0);
  });

  it('should calculate forex impact correctly', async () => {
    const impact = await service.calculateForexImpact(startDate, endDate);
    expect(impact).toHaveProperty('gains');
    expect(impact).toHaveProperty('losses');
    expect(impact).toHaveProperty('netImpact');
  });
});
```

### Integration Tests

**1. Order to Revenue Flow (Multi-Currency)**
```typescript
describe('Order to Revenue Flow (Ghana)', () => {
  it('should create order in GHS and track revenue correctly', async () => {
    // Create order in Ghana
    const order = await createOrder({
      customerId: 1,
      country: 'Ghana',
      currency: 'GHS',
      totalAmount: 100,
      // ... other fields
    });

    expect(order.currency).toBe('GHS');
    expect(order.originalAmount).toBe(100);
    expect(order.baseCurrencyAmount).toBe(12800); // @ rate 128

    // Deliver order
    await updateOrderStatus(order.id, 'delivered');

    // Check journal entry created
    const journalEntry = await getJournalEntryForOrder(order.id);
    expect(journalEntry.lines).toHaveLength(2); // Debit AR, Credit Revenue

    // Check revenue tracked
    const revenue = await getRevenueByCountry('Ghana', 'GHS');
    expect(revenue.amount).toBe(100);
  });
});
```

**2. Agent Settlement Flow**
```typescript
describe('Agent Settlement with Forex Variance', () => {
  it('should process settlement and record forex loss', async () => {
    const settlement = await processAgentSettlement({
      agentId: 45,
      country: 'Ghana',
      totalLocalCurrency: 1000,
      localCurrency: 'GHS',
      officialRate: 128,
      actualRate: 125,
      actualNGNRemitted: 125000
    });

    expect(settlement.forexVariance).toBe(-3000); // Loss

    // Check journal entry for forex loss
    const journalEntry = await getJournalEntryForSettlement(settlement.id);
    const forexLossLine = journalEntry.lines.find(l =>
      l.account.name === 'Forex Losses'
    );
    expect(forexLossLine.debit).toBe(3000);
  });
});
```

### E2E Tests

**1. Complete Financial Flow (Ghana)**
```typescript
describe('E2E: Ghana Order to Bank Deposit', () => {
  it('should track order from creation to bank deposit', async () => {
    // 1. Create order in Ghana (GHS)
    const order = await createOrderViaCheckout({
      country: 'Ghana',
      products: [{ id: 1, quantity: 2 }],
      totalGHS: 100
    });

    // 2. Assign to delivery agent
    await assignAgent(order.id, agentId);

    // 3. Agent delivers and collects COD
    await updateOrderStatus(order.id, 'delivered');
    await recordCODCollection({
      orderId: order.id,
      amount: 100,
      currency: 'GHS'
    });

    // 4. Agent converts and remits
    await processAgentSettlement({
      agentId,
      collections: [{ orderId: order.id, amountGHS: 100 }],
      actualRate: 125,
      remittedNGN: 12500
    });

    // 5. Verify financial records
    const plStatement = await getProfitLoss(startDate, endDate, 'NGN');
    expect(plStatement.revenue.productSales.ghana).toBe(12800); // Official rate
    expect(plStatement.expenses.forexLosses).toBe(300); // Variance

    const balanceSheet = await getBalanceSheet(new Date(), 'NGN');
    expect(balanceSheet.assets.bankNigeria).toBeGreaterThanOrEqual(12500);
  });
});
```

---

## PERFORMANCE CONSIDERATIONS

### Optimization Strategies

**1. Exchange Rate Caching**
- Cache exchange rates in Redis with 24-hour TTL
- Reduce API calls to exchange rate provider
- Fallback to database if cache miss

**2. Database Indexes**
```sql
-- Multi-currency order queries
CREATE INDEX idx_orders_country_currency ON orders(country, currency, created_at);
CREATE INDEX idx_orders_status_country ON orders(status, country);

-- Exchange rate lookups
CREATE INDEX idx_exchange_rates_lookup ON exchange_rates(from_currency, to_currency, effective_date DESC);

-- Financial reporting
CREATE INDEX idx_transactions_currency_date ON transactions(currency, created_at);
CREATE INDEX idx_journal_entries_date ON journal_entries(entry_date, status);
```

**3. Query Optimization**
- Use aggregations at database level (SUM, GROUP BY)
- Limit data fetching with pagination
- Use database views for complex financial queries

**4. Async Processing**
- Process agent settlements asynchronously (Bull queue)
- Generate financial statements in background
- Send settlement notifications via queue

---

## SECURITY CONSIDERATIONS

### Access Control

**1. Role-Based Permissions**
```typescript
const financialPermissions = {
  'super_admin': ['view', 'edit', 'approve', 'delete'],
  'admin': ['view', 'edit', 'approve'],
  'accountant': ['view', 'edit', 'approve'],
  'manager': ['view'],
  'sales_rep': ['view_own_commissions'],
  'delivery_agent': ['view_own_settlements']
};
```

**2. Sensitive Data Protection**
- Encrypt exchange rate API keys
- Hash bank account numbers
- Audit trail for all financial modifications
- Require 2FA for financial approvals

**3. Fraud Prevention**
- Flag large forex variances for review
- Alert on unusual exchange rates
- Require approval for manual rate overrides
- Log all currency conversions

---

## USER TRAINING & DOCUMENTATION

### User Guides to Create

**1. Multi-Currency Order Management**
- How to create orders in different currencies
- Understanding currency conversion on orders

**2. Agent Settlement Process**
- How agents should report collections
- Recording exchange rates used
- Verifying settlements

**3. Financial Reporting**
- Reading P&L statements
- Understanding forex impact
- Switching between currencies

**4. System Administration**
- Setting base currency
- Managing exchange rates
- Configuring chart of accounts

---

## SUCCESS METRICS

### Key Performance Indicators

**1. Financial Accuracy**
- [ ] 100% of orders tracked with correct currency
- [ ] Exchange rates updated daily (99.9% uptime)
- [ ] All journal entries balanced (debit = credit)
- [ ] Zero discrepancies in bank reconciliation

**2. Operational Efficiency**
- [ ] Agent settlement time reduced by 50%
- [ ] Financial report generation < 5 seconds
- [ ] Forex variance identification automated
- [ ] 90% reduction in manual data entry

**3. User Adoption**
- [ ] 100% of accountants trained on new system
- [ ] 80% of agents using mobile settlement app
- [ ] Average user rating > 4.5/5

**4. Business Impact**
- [ ] Better visibility into country profitability
- [ ] Forex losses reduced by 20% (through better rates)
- [ ] Faster financial close (monthly to weekly)
- [ ] Improved cash flow forecasting accuracy

---

## MAINTENANCE & SUPPORT

### Ongoing Maintenance Tasks

**1. Daily**
- Monitor exchange rate API status
- Review failed currency conversions
- Check settlement processing queue

**2. Weekly**
- Review forex variances with agents
- Reconcile multi-currency accounts
- Update manual rates if needed

**3. Monthly**
- Generate financial statements
- Review chart of accounts
- Archive old journal entries
- Update currency conversion documentation

**4. Quarterly**
- Review and optimize exchange rate provider
- Audit financial data accuracy
- Update user training materials
- Performance optimization review

---

## FUTURE ENHANCEMENTS (Beyond Scope)

### Phase 7+: Advanced Features

**1. Multi-Currency Pricing Engine**
- Smart pricing by market (Ghana vs Kenya)
- Dynamic pricing based on exchange rates
- A/B testing prices by currency

**2. Hedging & Risk Management**
- Currency exposure dashboard
- Forward contract management
- Hedging recommendations

**3. Blockchain/Crypto Payments**
- Accept crypto for international payments
- Auto-convert crypto to local currency
- Track crypto as asset class

**4. AI-Powered Forecasting**
- Predict exchange rate movements
- Optimize settlement timing
- Revenue forecasting by country

**5. Multi-Entity Support**
- Separate legal entities per country
- Consolidated financial statements
- Inter-company transactions

---

## APPENDIX

### A. Exchange Rate API Options

**1. exchangerate-api.com**
- Free tier: 1,500 requests/month
- Paid: $9.99/month for 100,000 requests
- Supports 161 currencies
- Historical data available

**2. fixer.io**
- Free tier: 100 requests/month
- Paid: $9.99/month for 1,000 requests
- Real-time rates
- Bank-level accuracy

**3. currencyapi.com**
- Free tier: 300 requests/month
- Paid: $14.99/month for 5,000 requests
- Multiple data sources
- High uptime (99.9%)

**Recommendation:** Start with exchangerate-api.com (free tier sufficient for MVP)

### B. Chart of Accounts Full List

See Section 2.1 for complete listing

### C. Sample Journal Entries

See Section 2.2 for detailed examples

### D. Database Schema Diagrams

(To be added with ERD tool)

### E. API Endpoint Reference

Complete list available in OpenAPI/Swagger docs

### F. UI/UX Mockups

(To be created with Figma)

---

## REVISION HISTORY

| Version | Date       | Author      | Changes                              |
|---------|------------|-------------|--------------------------------------|
| 1.0     | 2025-12-24 | Claude Code | Initial comprehensive plan created   |
| 1.1     | TBD        | -           | Updates after user feedback          |

---

## CONTACTS & RESOURCES

**Project Owner:** [Your Name]
**Technical Lead:** [Tech Lead Name]
**Accountant/Finance:** [Accountant Name]

**Resources:**
- Exchange Rate API Docs: https://exchangerate-api.com/docs
- Prisma Multi-Currency Guide: [link]
- Multi-Currency Accounting Best Practices: [link]

---

**END OF DOCUMENT**

*This plan will be implemented in phases after MVP launch to production.*
