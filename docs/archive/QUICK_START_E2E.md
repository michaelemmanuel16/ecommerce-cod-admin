# Quick Start: E2E Testing

## 🚀 Setup (One-Time)

### 1. Install Playwright Browsers
```bash
cd /Users/mac/Downloads/claude/ecommerce-cod-admin
npx playwright install chromium
```

This will download ~130 MB of browser binaries. Wait for completion.

### 2. Verify Backend & Frontend Running

**Terminal 1 - Backend**:
```bash
cd /Users/mac/Downloads/claude/ecommerce-cod-admin/backend
npm run dev
```
Should show: `Server running on port 3000`

**Terminal 2 - Frontend**:
```bash
cd /Users/mac/Downloads/claude/ecommerce-cod-admin/frontend
npm run dev
```
Should show: `Local: http://localhost:5173`

### 3. Verify Database Seeded
```bash
cd /Users/mac/Downloads/claude/ecommerce-cod-admin/backend
npx prisma db seed
```

---

## ▶️ Run Tests

### All Tests (Headless)
```bash
cd /Users/mac/Downloads/claude/ecommerce-cod-admin
npm run test:e2e
```

### All Tests (See Browser)
```bash
npm run test:e2e:headed
```

### Interactive UI Mode
```bash
npm run test:e2e:ui
```

### Specific Test Suite
```bash
npm run test:e2e:auth        # Authentication only
npm run test:e2e:orders      # Orders only
npm run test:e2e:kanban      # Kanban only
npm run test:e2e:customers   # Customers only
npm run test:e2e:realtime    # Real-time only
```

### Debug Mode (Step Through)
```bash
npm run test:e2e:debug
```

---

## 📊 View Results

### HTML Report
```bash
npm run test:e2e:report
```
Opens interactive report in browser.

### Screenshots
Located in: `test-results/screenshots/`

### Videos (on failure)
Located in: `test-results/videos/`

---

## 🧪 Test Credentials

```
Email: admin@example.com
Password: admin123
```

---

## 🔍 Troubleshooting

### "Executable doesn't exist"
```bash
npx playwright install chromium
```

### "Connection refused" / Timeout
Verify backend and frontend are running:
```bash
curl http://localhost:3000/api/orders
curl http://localhost:5173
```

### Tests fail on login
Check database has users:
```bash
cd backend
npx prisma studio
# Open browser, check Users table
```

### Clear test state
```bash
rm -rf test-results/
rm -rf playwright-report/
```

---

## 📁 Test Files Location

```
/Users/mac/Downloads/claude/ecommerce-cod-admin/e2e/
├── 01-authentication.spec.ts    (7 tests)
├── 02-order-management.spec.ts  (9 tests)
├── 03-kanban-board.spec.ts      (8 tests)
├── 04-customer-management.spec.ts (10 tests)
├── 05-real-time-updates.spec.ts (8 tests)
└── helpers/test-helpers.ts      (utilities)
```

---

## ✅ Expected Output

### Successful Run
```
Running 42 tests using 1 worker

  ✓ Authentication Flow › should login successfully (2.5s)
  ✓ Authentication Flow › should show error with invalid credentials (1.8s)
  ✓ Order Management › should display orders list (2.1s)
  ...

42 passed (3.2m)
```

### Failed Test
```
  ✗ Order Management › should create new order (5.0s)

    Error: Timeout 5000ms exceeded
    Screenshot: test-results/screenshots/order-create-form.png
```

---

## 🎯 Quick Commands

| Command | Description |
|---------|-------------|
| `npm run test:e2e` | Run all tests |
| `npm run test:e2e:headed` | Run with browser visible |
| `npm run test:e2e:ui` | Interactive mode |
| `npm run test:e2e:debug` | Debug mode |
| `npm run test:e2e:report` | View HTML report |
| `npm run test:e2e:auth` | Run auth tests only |

---

## 📝 Test Coverage

- ✅ Login/Logout
- ✅ Token Management
- ✅ Protected Routes
- ✅ Order CRUD
- ✅ Kanban Drag & Drop
- ✅ Customer Search
- ✅ Real-time Updates
- ✅ Multi-tab Sync
- ✅ Socket.io Events
- ✅ Form Validation
- ✅ Error Handling

---

## 🔗 More Info

- Full documentation: `e2e/README.md`
- Detailed report: `E2E_TEST_SUITE_REPORT.md`
- Playwright docs: https://playwright.dev

---

**Ready to test!** Run `npm run test:e2e:ui` for the best first experience.
