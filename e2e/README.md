# E2E Testing Suite

End-to-End tests for E-Commerce COD Admin Dashboard using Playwright.

## Test Suites

### 1. Authentication Flow (`01-authentication.spec.ts`)
- Login with valid/invalid credentials
- Token persistence across reloads
- Protected route access
- Logout functionality
- Session maintenance
- Auth token in API requests

### 2. Order Management (`02-order-management.spec.ts`)
- Display orders list
- Switch between kanban and list views
- View order details
- Create new orders
- Update order status
- Filter and search orders
- Assign delivery agents
- Pagination

### 3. Kanban Board Interaction (`03-kanban-board.spec.ts`)
- Display kanban columns
- Show order cards
- Drag and drop between columns
- Filter orders in kanban view
- Search in kanban view
- Column card counts
- Empty state handling

### 4. Customer Management (`04-customer-management.spec.ts`)
- Display customers list
- Search by name, email, phone
- View customer details
- Customer order history
- Filter and sort customers
- Pagination
- Add customer form

### 5. Real-Time Updates (`05-real-time-updates.spec.ts`)
- Socket.io connection establishment
- Real-time order updates
- Multi-tab synchronization
- Real-time notifications
- Socket persistence during navigation
- Reconnection after disconnect
- Error handling

## Prerequisites

Before running tests, ensure:

1. **Backend is running** on http://localhost:3000
   ```bash
   cd backend && npm run dev
   ```

2. **Frontend is running** on http://localhost:5173
   ```bash
   cd frontend && npm run dev
   ```

3. **Database is seeded** with test data
   ```bash
   cd backend && npx prisma db seed
   ```

## Running Tests

### Run all tests
```bash
npm run test:e2e
```

### Run tests in headed mode (see browser)
```bash
npm run test:e2e:headed
```

### Run tests in debug mode
```bash
npm run test:e2e:debug
```

### Run tests in UI mode (interactive)
```bash
npm run test:e2e:ui
```

### Run specific test suite
```bash
npm run test:e2e:auth        # Authentication tests
npm run test:e2e:orders      # Order management tests
npm run test:e2e:kanban      # Kanban board tests
npm run test:e2e:customers   # Customer tests
npm run test:e2e:realtime    # Real-time tests
```

### View test report
```bash
npm run test:e2e:report
```

## Test Credentials

Default test credentials (from helpers/test-helpers.ts):

```typescript
{
  admin: {
    email: 'admin@example.com',
    password: 'admin123',
  }
}
```

## Test Results

- **Screenshots**: `test-results/screenshots/`
- **Videos**: `test-results/videos/` (on failure)
- **HTML Report**: `playwright-report/`
- **JSON Results**: `test-results/results.json`

## Configuration

Test configuration is in `playwright.config.ts`:

- **Test Directory**: `./e2e`
- **Timeout**: 60 seconds per test
- **Retries**: 1 retry on failure
- **Workers**: 1 (sequential execution)
- **Base URL**: http://localhost:5173
- **Screenshots**: On failure only
- **Videos**: Retained on failure
- **Traces**: On first retry

## Writing New Tests

### Test Structure

```typescript
import { test, expect } from '@playwright/test';
import { login, TEST_URLS } from './helpers/test-helpers';

test.describe('Feature Name', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('should do something', async ({ page }) => {
    // Arrange
    await page.goto(TEST_URLS.somePage);

    // Act
    await page.click('button');

    // Assert
    await expect(page).toHaveURL('/expected-url');
  });
});
```

### Helper Functions

Located in `helpers/test-helpers.ts`:

- `login(page, email?, password?)` - Login helper
- `logout(page)` - Logout helper
- `clearBrowserState(page)` - Clear localStorage/cookies
- `waitForAPICall(page, urlPattern, method)` - Wait for API response
- `waitForToast(page, expectedText?)` - Wait for toast notification
- `waitForSocketConnection(page)` - Wait for Socket.io connection
- `getConsoleErrors(page)` - Capture console errors
- `takeTimestampedScreenshot(page, name)` - Take screenshot with timestamp
- `isElementVisible(page, selector)` - Check element visibility
- `fillForm(page, formData)` - Fill form fields
- `captureNetworkRequests(page)` - Capture all network requests
- `getPerformanceMetrics(page)` - Get page performance data

### Test URLs

Predefined URLs in `helpers/test-helpers.ts`:

```typescript
TEST_URLS = {
  login: '/login',
  dashboard: '/',
  orders: '/orders',
  customers: '/customers',
  products: '/products',
  deliveryAgents: '/delivery-agents',
  customerReps: '/customer-reps',
  financial: '/financial',
  analytics: '/analytics',
  workflows: '/workflows',
  settings: '/settings',
}
```

## Best Practices

1. **Use data-testid attributes** in components for reliable selectors
2. **Clear state** between tests using `beforeEach`
3. **Take screenshots** at key points for debugging
4. **Check console errors** to catch JavaScript issues
5. **Wait for network idle** before assertions
6. **Use semantic selectors** (text, role) over CSS classes
7. **Test user workflows** not implementation details
8. **Keep tests independent** - don't rely on test order
9. **Mock external services** if they're unreliable
10. **Run tests in CI/CD** pipeline

## Troubleshooting

### Tests fail with timeout
- Increase timeout in `playwright.config.ts`
- Check if backend/frontend are running
- Check network connectivity

### Tests fail with "element not found"
- Use `page.waitForSelector()` before interactions
- Check if selectors match actual HTML
- Take screenshot to see page state

### Authentication tests fail
- Verify test credentials exist in database
- Check backend logs for auth errors
- Clear browser state before test

### Socket tests fail
- Verify Socket.io server is running
- Check CORS configuration
- Look for WebSocket connection errors in console

### Flaky tests
- Add explicit waits: `page.waitForTimeout()`
- Use `page.waitForLoadState('networkidle')`
- Increase retry count in config
- Check for race conditions

## CI/CD Integration

### GitHub Actions Example

```yaml
name: E2E Tests

on: [push, pull_request]

jobs:
  e2e:
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

      - name: Install Playwright browsers
        run: npx playwright install --with-deps

      - name: Start backend
        run: |
          cd backend
          npm run build
          npm start &

      - name: Start frontend
        run: |
          cd frontend
          npm run build
          npm run preview &

      - name: Wait for services
        run: |
          npx wait-on http://localhost:3000
          npx wait-on http://localhost:5173

      - name: Run E2E tests
        run: npm run test:e2e

      - uses: actions/upload-artifact@v3
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 30
```

## Performance Testing

Tests include performance metrics:

```typescript
const metrics = await getPerformanceMetrics(page);
console.log('Page load time:', metrics.loadComplete, 'ms');
```

Expected performance thresholds:
- Page load: < 2 seconds
- API calls: < 500ms
- Socket connection: < 1 second

## Coverage

The E2E tests cover:

- ✅ Authentication flows
- ✅ Order management (CRUD)
- ✅ Kanban drag-and-drop
- ✅ Customer management
- ✅ Real-time updates
- ✅ Search and filtering
- ✅ Navigation
- ✅ Error handling
- ✅ Token management
- ✅ Multi-tab synchronization

## Future Enhancements

- [ ] Add performance benchmarking
- [ ] Add accessibility tests (axe-core)
- [ ] Add visual regression testing
- [ ] Add API contract testing
- [ ] Add load testing scenarios
- [ ] Add mobile viewport tests
- [ ] Add cross-browser testing
- [ ] Add PDF export testing
- [ ] Add file upload testing
- [ ] Add webhook testing
