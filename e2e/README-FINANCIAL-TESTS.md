# Financial Management E2E Tests

Comprehensive end-to-end testing suite for the Financial Management module covering all three consolidated tabs.

## Test Coverage

### Overview Tab Tests
- ✅ All KPI cards display with correct data
- ✅ KPI values are properly formatted (GHS amounts, numbers, percentages)
- ✅ Revenue vs Expense trend chart displays
- ✅ Cash Flow Forecasting section displays
- ✅ Cash Position KPIs are present
- ✅ Date range filtering works
- ✅ Export cash forecast data

### Agent Collections Tab Tests
- ✅ Agent Collections KPIs display correctly
- ✅ Unified agent table with all required columns
- ✅ Agent data integrity verification
- ✅ Aging buckets (0-3, 4-7, 8+ days) display
- ✅ Exposure distribution chart (pie chart)
- ✅ Table sorting functionality
- ✅ Filter controls (Overdue, Blocked)
- ✅ Search functionality
- ✅ Agent action buttons (View, Remind, Block)
- ✅ "View Collections" modal/details
- ✅ Export agent data to CSV
- ✅ No data duplication from Dashboard

### Accounting & Analysis Tab Tests
- ✅ All 4 sub-tabs present (GL, Statements, Profitability, Expenses)
- ✅ **General Ledger**: Chart of Accounts, View Ledger, Record Journal Entry
- ✅ **Financial Statements**: P&L, Balance Sheet, proper data format
- ✅ **Profitability**: KPIs, product table, trend chart
- ✅ **Expense Management**: Categories, table, Add Expense, data integrity
- ✅ No redundancy across sub-tabs

### Data Integrity & Cross-Tab Verification
- ✅ Outstanding AR consistency across Overview and Agent Collections
- ✅ Total Expenses consistency across Overview and Expenses tab
- ✅ Net Profit consistency across Dashboard and Financial Statements
- ✅ All displayed numbers are valid (no NaN, undefined, null)
- ✅ All API calls return 200 OK

### Performance & UX Tests
- ✅ Page loads within acceptable time (< 5 seconds)
- ✅ Tab switching is smooth (< 2 seconds)
- ✅ Empty data handled gracefully
- ✅ No console errors

## Running Tests

### Run all Financial Management tests
```bash
npm run test:e2e:financial
```

### Run tests in headed mode (see browser)
```bash
npm run test:e2e:financial -- --headed
```

### Run tests in debug mode (step through)
```bash
npm run test:e2e:financial -- --debug
```

### Run tests in UI mode (interactive)
```bash
npm run test:e2e:financial -- --ui
```

### Run specific test suite
```bash
# Overview tab only
npx playwright test -g "Financial Management - Overview Tab"

# Agent Collections only
npx playwright test -g "Financial Management - Agent Collections Tab"

# Accounting & Analysis only
npx playwright test -g "Financial Management - Accounting & Analysis Tab"

# Data integrity tests only
npx playwright test -g "Data Integrity & Cross-Tab Verification"
```

### Run with multiple workers (parallel)
```bash
npm run test:e2e:financial -- --workers=4
```

### Generate HTML report
```bash
npm run test:e2e:financial
npm run test:e2e:report
```

## Prerequisites

### 1. Backend must be running
```bash
cd backend
npm run dev
```

### 2. Frontend must be running
```bash
cd frontend
npm run dev
```

### 3. Database must have test data
```bash
cd backend
npx prisma db seed
```

**OR** import orders via the UI to generate realistic financial data.

### 4. Test user must exist
The tests use the default admin account:
- Email: `admin@example.com`
- Password: `admin123`

If this account doesn't exist, create it:
```bash
cd backend
ts-node create-admin.ts
```

## Test Data Requirements

For comprehensive testing, ensure the following data exists:

### Orders
- At least 5 orders with status "delivered" (for revenue calculation)
- At least 3 orders with status "confirmed" (for expected revenue)
- Orders assigned to different delivery agents

### Delivery Agents
- At least 3 delivery agents with cash held
- At least 1 agent with overdue collections (> 7 days)
- Mix of agents with collections in different aging buckets

### Expenses
- At least 5 expense records across different categories
- Expenses with dates within the last 30 days

### GL Accounts
- Standard chart of accounts (created by seed script)
- At least 10 GL accounts with balances

### Products
- At least 5 products with COGS data (for profitability analysis)
- Products with different profit margins

## Expected Test Results

### Success Criteria
- **All tests pass**: Green checkmarks in Playwright report
- **No console errors**: Critical errors should be 0
- **API calls succeed**: All API calls return 200 OK
- **Data integrity**: Cross-tab data matches across all tabs
- **Performance**: Page loads < 5s, tab switches < 2s

### Common Failures & Solutions

#### "Element not found" errors
**Cause**: UI elements have different selectors than expected
**Solution**: Update test selectors to match actual component structure

#### "Data mismatch" errors
**Cause**: Outstanding AR or other values don't match across tabs
**Solution**: Check backend calculation logic for consistency

#### "Timeout" errors
**Cause**: API calls taking too long or frontend not loading
**Solution**:
- Increase timeout in test
- Check backend performance
- Verify database has proper indexes

#### "No data" warnings
**Cause**: Database empty or seed script not run
**Solution**: Run `npx prisma db seed` or import test orders

## Test Architecture

### Test Organization
```
e2e/07-financial-management.spec.ts
├── Overview Tab (9 tests)
├── Agent Collections Tab (12 tests)
├── Accounting & Analysis Tab (12 tests)
├── Data Integrity & Cross-Tab (6 tests)
└── Performance & UX (4 tests)
```

### Test Patterns Used
- **Page Object Pattern**: Reusable selectors and actions
- **Before Each Hooks**: Clean state before each test
- **Helper Functions**: Login, clear state, wait for API
- **Assertions**: Expect statements for verification
- **Timeouts**: Reasonable waits for async operations

### Best Practices
- ✅ Clean browser state before each test
- ✅ Login once per test suite
- ✅ Wait for elements before interacting
- ✅ Use descriptive test names
- ✅ Verify data integrity across tabs
- ✅ Check for console errors
- ✅ Test both happy and empty states

## CI/CD Integration

### GitHub Actions Workflow
Add to `.github/workflows/e2e-tests.yml`:

```yaml
name: E2E Tests

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  e2e-financial:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: |
          npm ci
          cd backend && npm ci
          cd ../frontend && npm ci

      - name: Setup database
        run: |
          cd backend
          npx prisma migrate deploy
          npx prisma db seed

      - name: Start backend
        run: cd backend && npm run dev &

      - name: Start frontend
        run: cd frontend && npm run dev &

      - name: Wait for services
        run: sleep 10

      - name: Run Financial E2E tests
        run: npm run test:e2e:financial

      - name: Upload test report
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: playwright-report
          path: playwright-report/
```

## Troubleshooting

### Tests failing locally but passing in CI
- Clear browser cache and storage
- Check Node.js version matches CI
- Verify database state is consistent

### Tests timing out
- Increase global timeout in `playwright.config.ts`
- Check for slow API endpoints
- Verify network is not throttled

### Data inconsistency errors
- Verify seed script ran successfully
- Check for concurrent test runs modifying data
- Ensure proper transaction isolation

### Chart rendering failures
- Wait longer for Recharts to render
- Check if chart data is being fetched
- Verify SVG elements are in DOM

## Maintenance

### Updating Tests
When UI changes:
1. Update selectors in test file
2. Run tests to verify
3. Update README if test coverage changes

### Adding New Tests
1. Follow existing test patterns
2. Add descriptive test name
3. Include in appropriate test suite
4. Update this README

### Performance Benchmarks
- Current benchmarks (on M1 Mac):
  - Full suite: ~45 seconds
  - Overview tab: ~8 seconds
  - Agent Collections: ~12 seconds
  - Accounting & Analysis: ~15 seconds
  - Data Integrity: ~7 seconds
  - Performance: ~3 seconds

## Related Documentation

- [Playwright Documentation](https://playwright.dev)
- [Financial Module Plan](/.claude/plans/financial-consolidation-plan.md)
- [Backend API Documentation](/backend/README.md)
- [Frontend Architecture](/frontend/README.md)

## Support

For issues or questions:
1. Check console logs in test output
2. Run tests in debug mode: `npm run test:e2e:financial -- --debug`
3. Review Playwright trace: `npx playwright show-trace`
4. Check GitHub Issues for known problems
