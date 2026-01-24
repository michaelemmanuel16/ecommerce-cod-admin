# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

---

## Project Overview

E-Commerce Cash-on-Delivery (COD) Admin Dashboard - A full-stack TypeScript application for managing COD orders, deliveries, customer relationships, and financial reconciliation.

**Project Structure:**
```
ecommerce-cod-admin/
├── backend/          # Node.js/Express REST API with PostgreSQL/Prisma
├── frontend/         # React/Vite SPA with TypeScript
├── e2e/              # Playwright E2E tests
├── docs/             # Project documentation
├── scripts/          # Utility scripts (deploy, backup, etc.)
├── k8s/              # Kubernetes deployment configs
├── nginx/            # Nginx reverse proxy configs
├── monitoring/       # Monitoring and observability configs
└── .claude/          # Claude Code configurations
```

## Planning Guidelines

- Save plans in `.claude/plans/` or `.claude/docs/` (not `~/.claude/plans/`)
- Keep plans focused on this project only

## Git Worktree Configuration

**Worktree Directory:** `.worktrees/` (project-local, hidden)

When using git worktrees for isolated development:
- Create worktrees in `.worktrees/` directory (already in `.gitignore`)
- Copy `.env` files from main workspace to worktree after creation
- Install dependencies in both backend and frontend
- Verify tests pass before beginning work

## Git Workflow & Deployment

**IMPORTANT: Always follow this workflow when making changes.**

### Branch Strategy
```
feature/* → develop (staging) → main (production)
```

**Branches:**
- `main` - Production (https://codadminpro.com) - **Never push directly**
- `develop` - Staging (http://143.110.197.200:5174 & :3001) - **Use PRs only**
- `feature/*` - Feature branches (create from develop)

### Standard Workflow

**1. Start new work:**
```bash
git checkout develop && git pull
git checkout -b feature/descriptive-name
```

**2. Make changes and commit:**
```bash
git add .
git commit -m "feat: Description of changes"
git push -u origin feature/descriptive-name
```

**3. Deploy to staging (test first):**
- Create PR on GitHub: `feature/descriptive-name` → `develop`
- Merge PR → Auto-deploys to staging
- Test at: https://staging.codadminpro.com

**4. Deploy to production (after testing):**
- Create PR on GitHub: `develop` → `main`
- Merge PR → Auto-deploys to production
- Verify at: https://codadminpro.com

### Commit Conventions
- `feat:` New feature
- `fix:` Bug fix
- `refactor:` Code refactoring
- `test:` Add/update tests
- `docs:` Documentation
- `chore:` Maintenance

### Deployment URLs
- Production: https://codadminpro.com (main branch)
- Staging Frontend: https://staging.codadminpro.com (develop branch)
- Staging Backend: https://staging.codadminpro.com/api (develop branch)

### Rules
✅ Always create feature branches from `develop`
✅ Always test in staging before production
✅ Always use PRs (never push directly to main/develop)
❌ Never skip staging deployment
❌ Never commit secrets or .env files
❌ Never force push to main/develop

## Quick Start

### Manual Setup

```bash
# Backend setup
cd backend
npm install
cp .env.example .env           # Edit with your database credentials
npm run prisma:migrate
npx prisma db seed
npm run dev                    # Runs on port 3000

# Frontend setup (new terminal)
cd frontend
npm install
# Create .env with: VITE_API_URL=http://localhost:3000
npm run dev                    # Runs on port 5173
```

### Docker Setup (Recommended)

```bash
# Start development environment (PostgreSQL + Redis + Backend + Frontend)
./scripts/start-dev.sh

# Or use docker-compose directly
docker-compose -f docker-compose.dev.yml up -d

# Production deployment
./scripts/deploy.sh

# Access: http://localhost:5173
```

## Development Commands

### Backend (port 3000)

```bash
cd backend

# Development
npm run dev
npm run build
npm start

# Database (Prisma)
npm run prisma:generate
npm run prisma:migrate
npm run prisma:migrate -- --name description
npm run prisma:studio
npx prisma db seed
ts-node create-admin.ts

# Testing
npm test
npm run test:unit
npm run test:integration
npm run test:coverage
npm run test:performance
npm test -- <filename>
```

### Frontend (port 5173)

```bash
cd frontend

# Development
npm run dev
npm run build
npm run preview

# Testing
npm test
npm run test:ui
npm run test:coverage
```

### E2E Tests (root directory)

```bash
npm run test:e2e
npm run test:e2e:ui
npm run test:e2e:debug
npm run test:e2e:report
npm run test:e2e:auth
npm run test:e2e:orders
npm run test:e2e:kanban
npm run test:e2e:customers
npm run test:e2e:realtime
```

### Utility Scripts (root directory)

```bash
# Development
./scripts/start-dev.sh

# Deployment
./scripts/deploy.sh
./scripts/deploy-staging.sh
./scripts/deploy-production.sh

# Database
./scripts/backup-database.sh
./scripts/database-restore.sh
./scripts/init-db.sh
./scripts/run-migrations.sh

# Maintenance
./scripts/health-check.sh
./scripts/rollback.sh
```

### Docker Commands

```bash
# Development
docker-compose -f docker-compose.dev.yml up -d
docker-compose -f docker-compose.dev.yml down
docker-compose -f docker-compose.dev.yml logs -f
docker-compose -f docker-compose.dev.yml ps

# Production
docker-compose -f docker-compose.prod.yml up -d
docker-compose -f docker-compose.prod.yml down
```

## Architecture

### Backend

**Layered Structure:**
- **Routes** (`src/routes/*.ts`) - Express route definitions
- **Controllers** (`src/controllers/*.ts`) - Request/response handling, validation
- **Services** (`src/services/*.ts`) - Business logic, database operations
- **Middleware** (`src/middleware/*.ts`) - Auth, rate limiting, error handling
- **Utils** (`src/utils/*.ts`) - JWT, crypto, logging, validators
- **Queues** (`src/queues/*.ts`) - Bull/Redis background jobs

**Key Technologies:**
- PostgreSQL + Prisma ORM
- JWT authentication with refresh tokens
- Socket.io for real-time updates
- Bull + Redis for job queues (workflow automation)
- Express rate limiting (10k dev / 100 prod per 15min)

**Database Models:**
- User (7 roles: super_admin, admin, manager, sales_rep, inventory_manager, delivery_agent, accountant)
- Order, Customer, Product, OrderItem
- Delivery, DeliveryProof
- Workflow, WorkflowExecution
- Webhook, Notification, CheckoutForm

**Order Status Flow:**
```
pending_confirmation → confirmed → preparing → ready_for_pickup
  → out_for_delivery → delivered

Can branch to: cancelled, returned, failed_delivery
```

**API Endpoints:**
- `/api/auth` - Authentication (login, register, refresh)
- `/api/admin` - Admin panel (user management, settings)
- `/api/users` - User CRUD
- `/api/customers` - Customer management
- `/api/products` - Product catalog
- `/api/orders` - Order management
- `/api/deliveries` - Delivery tracking
- `/api/financial` - Financial reconciliation
- `/api/workflows` - Automation workflows
- `/api/webhooks` - External integrations
- `/api/analytics` - Analytics and reports
- `/api/checkout-forms` - Public checkout form builder
- `/api/public` - Public endpoints (no auth required)

### Frontend

**State Management (Zustand):**
- `authStore` - User session, JWT tokens (localStorage)
- `ordersStore` - Orders, filters, CRUD
- `customersStore` - Customer management
- `customerRepsStore` - Rep performance tracking
- `deliveryAgentsStore` - Delivery agent management
- `financialStore` - Financial reconciliation
- `analyticsStore` - Analytics data
- `workflowStore` - Workflow automation
- `notificationsStore` - Real-time notifications
- `productsStore` - Product catalog

**API Layer:**
- `services/api.ts` - Axios client with auth/refresh/error interceptors
- `services/*.service.ts` - Type-safe API methods per resource
- Auto-handles token refresh on 401

**UI Stack:**
- React Router v6 - Protected routes
- Shadcn UI - Component library
- React Flow - Workflow builder
- @dnd-kit - Drag-and-drop Kanban
- Socket.io - Real-time updates
- React Hook Form + Zod - Form validation
- Recharts - Analytics charts

**Pages:**
- Dashboard, Orders (List), Customers, Products
- Delivery Agents, Customer Reps, Financial, Analytics
- Workflows, Checkout Forms, Settings
- Public Checkout (unauthenticated, embeddable)

**Special Features:**
- **Public Checkout Forms**: Create embeddable checkout forms for COD orders
  - No authentication required for customers
  - Configurable packages and upsells
  - Ghana regions and cities support
  - Embeddable via iframe or direct link
  - See `frontend/PUBLIC_CHECKOUT_FILES.md` for implementation details

## Important Conventions

### Environment Variables

**Backend** (`.env`):
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection (default: redis://localhost:6379)
- `JWT_SECRET` - Access token secret
- `JWT_REFRESH_SECRET` - Refresh token secret
- `NODE_ENV` - development | production (affects rate limits)
- `FRONTEND_URL` - CORS origin (default: http://localhost:5173)

**Frontend** (`.env`):
- `VITE_API_URL` - Backend URL (default: http://localhost:3000)

### Database Migrations

**Always:**
1. Modify `prisma/schema.prisma`
2. Run `npm run prisma:generate`
3. Run `npm run prisma:migrate -- --name descriptive_name`
4. Never edit migration files manually

**Performance:**
- Database has optimized indexes for common queries
- See `backend/DATABASE_OPTIMIZATION_SUMMARY.md` for index strategy
- Run `npm run test:performance` to verify query performance
- Target: <100ms for simple queries, <500ms for complex queries

### Authentication in Routes

```typescript
// Require login
router.get('/protected', authenticate, handler);

// Require specific role
router.delete('/admin-only', authenticate, authorize(['admin', 'super_admin']), handler);
```

### Adding New API Endpoints

1. Define route in `backend/src/routes/*.routes.ts`
2. Create controller in `backend/src/controllers/*.ts`
3. Add service method in `backend/src/services/*.ts`
4. Create frontend service in `frontend/src/services/*.service.ts`
5. Add store method if needed in `frontend/src/stores/*.ts`

### Frontend API Calls

**Always:**
- Use service methods, never raw `fetch` or `axios`
- Services auto-include auth token
- Errors auto-show toast (except 401 → refresh/redirect)

```typescript
// Good
await ordersService.getOrders(filters);

// Bad
await axios.get('/api/orders');
```

### Real-Time Updates

- Socket.io auto-connects in stores
- Backend emits events after mutations
- Frontend listeners update state automatically
- Events: `order:created`, `order:updated`, `order:status_changed`, `delivery:updated`

### Workflow Automation

**Implementation:**
- Bull + Redis for job queues
- Visual workflow builder using React Flow
- Trigger types: order_created, status_change, payment_received, time_based, manual, webhook
- Action types: send_sms, send_email, update_order, assign_agent, add_tag, wait, http_request

**Files:**
- `backend/src/services/workflowService.ts` - Workflow execution logic
- `backend/src/queues/workflowQueue.ts` - Background job processing
- `frontend/src/pages/WorkflowEditor.tsx` - Visual workflow builder
- See `backend/WORKFLOW_IMPLEMENTATION_SUMMARY.md` for detailed implementation

**Creating workflows:**
1. Define trigger conditions (e.g., order status changes to "confirmed")
2. Add actions to execute (e.g., send email, assign to agent)
3. Configure action parameters (templates, conditions)
4. Test and activate workflow

## Testing

See Development Commands section for test commands.

**Backend (Jest):**
- `src/__tests__/unit/` - Unit tests (mock Prisma)
- `src/__tests__/integration/` - Integration tests (real DB)
- `src/__tests__/mocks/` - Test mocks

**Frontend (Vitest):**
- Vitest + Testing Library
- Mock API calls with MSW
- Colocate tests with components

## Common Issues

### "Invalid token" errors
- Tokens expire - frontend auto-refreshes
- Clear localStorage: `localStorage.clear()`

### 429 Rate Limit Errors
- Check `NODE_ENV=development` in backend `.env`
- Dev: 10k/15min, Prod: 100/15min

### Prisma Client not found
- Run `npm run prisma:generate`
- Restart backend dev server

### Socket.io connection failures
- Check backend is running on port 3000
- Verify `VITE_API_URL` matches backend URL
- Check CORS settings in `backend/src/server.ts`

## Key Files Reference

**Backend:**
- `prisma/schema.prisma` - Database schema
- `src/server.ts` - Express app setup
- `src/middleware/auth.ts` - Authentication
- `src/sockets/index.ts` - Socket.io setup
- `src/queues/workflowQueue.ts` - Background jobs

**Frontend:**
- `src/services/api.ts` - Axios interceptor
- `src/stores/authStore.ts` - Session management
- `src/App.tsx` - Route definitions
- `src/types/index.ts` - TypeScript types


## Development Guidelines

- Frontend: Shadcn components only
- Backend: Keep business logic in services
- Always validate with Zod
- Type everything with TypeScript
- Test critical paths
- Be concise - no unnecessary docs
- **Before committing/pushing**: Always run `./scripts/validate-workflows.sh` to ensure all GitHub Actions workflows are valid and will pass CI/CD
