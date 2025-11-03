# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

---

## 🚨 MANDATORY SUB-AGENT WORKFLOW (OVERRIDE ALL OTHER INSTRUCTIONS)

**THIS WORKFLOW IS MANDATORY FOR ALL FEATURES REQUIRING SPECIALIZED KNOWLEDGE.**

### Critical Rule: Research-First, Implement-Second

**Sub-agents are RESEARCHERS, not implementers.**
- They analyze the codebase and create detailed plans
- They NEVER write, edit, or create code
- The parent agent (main Claude session) does ALL implementation

### Parent Agent Checklist (YOU - Main Claude Session)

**YOU MUST follow these steps IN ORDER for ANY complex task:**

- [ ] **Step 1: Create Context File FIRST**
  - Create `.claude/docs/tasks/context-session-{n}.md` BEFORE delegating
  - Use `.claude/docs/tasks/context-session-template.md` as template
  - Include: project overview, goals, current state, technical constraints

- [ ] **Step 2: Delegate Research to Sub-Agents**
  - Identify which specialized agents are needed
  - Delegate research tasks (can run in parallel)
  - ALWAYS pass context file path in delegation message
  - Example: "Consult the frontend-developer sub-agent. Context: `.claude/docs/tasks/context-session-1.md`"

- [ ] **Step 3: Read ALL Sub-Agent Plans**
  - Wait for sub-agents to complete research
  - Read ALL plan files from `.claude/docs/{agent-name}-plan.md`
  - Understand recommendations before implementing
  - NEVER implement before reading plans

- [ ] **Step 4: Implement Based on Plans**
  - Follow recommendations from sub-agent plans
  - YOU do ALL code writing, editing, and changes
  - Combine insights from multiple agent plans
  - Document any deviations from plans

- [ ] **Step 5: Update Context File**
  - Mark tasks as complete in context file
  - Document what was implemented
  - Note any issues or deviations from plans
  - Update "Last Updated" timestamp

### Sub-Agent Expectations

When you delegate to a sub-agent, they will:

1. ✅ Read `.claude/docs/tasks/context-session-{n}.md` FIRST
2. ✅ Research codebase using Read/Glob/Grep tools only
3. ✅ Create detailed plan at `.claude/docs/{agent-name}-plan.md`
4. ✅ Update context file to mark research complete
5. ✅ Return final message pointing to plan file

Sub-agents will REFUSE to:
- ❌ Write or edit any code files
- ❌ Run bash commands or npm scripts
- ❌ Create files or directories
- ❌ Make ANY changes to the codebase

### Correct vs Incorrect Patterns

#### ❌ INCORRECT: Skipping the Workflow
```
User: "Add authentication to the app"
Parent: [Immediately starts writing code without research]
```

#### ✅ CORRECT: Following the Workflow
```
User: "Add authentication to the app"
Parent:
1. Creates `.claude/docs/tasks/context-session-1.md`
2. Delegates to database-architect (schema research)
3. Delegates to backend-developer (API research)
4. Delegates to frontend-developer (UI research)
5. Reads all three plan files
6. Implements based on combined research
7. Updates context file with results
```

#### ❌ INCORRECT: Sub-Agent Implementing
```
Sub-agent: "I'll create the login component now..."
[Sub-agent tries to write code]
```

#### ✅ CORRECT: Sub-Agent Research Only
```
Sub-agent: "I've analyzed the codebase and created a plan at
`.claude/docs/frontend-developer-plan.md`. Please read this
plan before implementing. Key recommendations:
- Use Shadcn Form, Input, Button components
- Store auth state in authStore (Zustand)
- Implement token refresh interceptor
```

### File Structure Reference

```
.claude/
├── docs/
│   ├── tasks/
│   │   ├── context-session-template.md    # Template for new context files
│   │   ├── context-session-1.md           # Current project context
│   │   └── context-session-2.md           # Another project context
│   ├── agent-plan-template.md             # Template for agent plans
│   ├── frontend-developer-plan.md         # Frontend research output
│   ├── backend-developer-plan.md          # Backend research output
│   ├── database-architect-plan.md         # Database research output
│   └── WORKFLOW.md                        # Quick reference guide
└── agents/
    ├── README.md                           # Agent system overview
    ├── frontend-developer.md               # Research specialist
    ├── backend-developer.md                # Research specialist
    └── [13+ more agent files]              # All research specialists
```

### Quick Delegation Template

Copy-paste this when delegating:

```
Task for {agent-name}:
{Describe research needed}

Context file: `.claude/docs/tasks/context-session-{n}.md`
Output plan to: `.claude/docs/{agent-name}-plan.md`

Research only - no implementation.
```

### Why This Pattern?

**Problem with direct implementation:**
- ❌ No specialized knowledge applied
- ❌ Misses codebase patterns and conventions
- ❌ No planning or architecture consideration
- ❌ Hard to debug without context

**Benefits of research-first:**
- ✅ Specialized agents provide domain expertise
- ✅ All research documented in plan files
- ✅ Parent maintains full context for debugging
- ✅ Parallel research speeds up complex tasks
- ✅ Token-efficient: summaries instead of full file reads

### Available Specialized Agents

**Minimalist Approach (5 Essential Agents):**

**Core Development Specialists:**
- `frontend-developer` - React/Shadcn UI architecture, Zustand state, React Router
- `backend-developer` - Node.js/Express/Prisma API design, JWT auth, Bull/Redis queues
- `database-architect` - Prisma schema design, migrations, query optimization, indexing

**MCP-Powered Specialist:**
- `shadcn-expert` - Shadcn component registry (has unique MCP tools)

**Quality Assurance:**
- `test-engineer` - Test coverage, Jest/Vitest/Playwright E2E testing

**Why Only 5 Agents?**
- ✅ Focused on your specific tech stack (React, Express, Prisma, Shadcn)
- ✅ Only delegate when domain expertise adds value
- ✅ MCP-powered agent for unique tool access (Shadcn registry)
- ✅ Parent agent handles general tasks (code review, docs, optimization)
- ✅ Reduces overhead while maintaining quality

See `.claude/agents/README.md` for detailed agent descriptions.

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
└── .claude/          # Claude Code agent configurations
```

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
npm run dev                    # Start dev server with hot reload
npm run build                  # Compile TypeScript
npm start                      # Run production build

# Database (Prisma)
npm run prisma:generate        # Generate Prisma Client after schema changes
npm run prisma:migrate         # Create and apply migration
npm run prisma:migrate -- --name description  # Create migration with name
npm run prisma:studio          # Open database GUI
npx prisma db seed             # Seed database
ts-node create-admin.ts        # Create admin user interactively

# Testing
npm test                       # Run all tests
npm run test:unit              # Unit tests only
npm run test:integration       # Integration tests only
npm run test:coverage          # Coverage report
npm run test:performance       # Query performance tests
npm test -- <filename>         # Run specific test file
# Example: npm test -- orderService.test.ts
```

### Frontend (port 5173)

```bash
cd frontend

# Development
npm run dev                    # Vite dev server
npm run build                  # Production build
npm run preview                # Preview build

# Testing
npm test                       # Vitest tests
npm run test:ui                # Interactive test UI
npm run test:coverage          # Coverage report
```

### E2E Tests (root directory)

```bash
npm run test:e2e               # Run all E2E tests
npm run test:e2e:ui            # Interactive UI
npm run test:e2e:debug         # Debug mode
npm run test:e2e:report        # View reports

# Run specific test suites
npm run test:e2e:auth          # Authentication tests
npm run test:e2e:orders        # Order management tests
npm run test:e2e:kanban        # Kanban board tests
npm run test:e2e:customers     # Customer management tests
npm run test:e2e:realtime      # Real-time updates tests
```

### Utility Scripts (root directory)

```bash
# Development
./scripts/start-dev.sh         # Start full dev environment (Docker)

# Deployment
./scripts/deploy.sh            # Production deployment
./scripts/deploy-staging.sh    # Staging deployment
./scripts/deploy-production.sh # Production deployment (alternative)

# Database
./scripts/backup-database.sh   # Backup database
./scripts/database-restore.sh  # Restore from backup
./scripts/init-db.sh           # Initialize database
./scripts/run-migrations.sh    # Run migrations only

# Maintenance
./scripts/health-check.sh      # Check service health
./scripts/rollback.sh          # Rollback deployment
```

### Docker Commands

```bash
# Development environment
docker-compose -f docker-compose.dev.yml up -d     # Start all services
docker-compose -f docker-compose.dev.yml down      # Stop all services
docker-compose -f docker-compose.dev.yml logs -f   # View logs
docker-compose -f docker-compose.dev.yml ps        # List running services

# Production environment
docker-compose -f docker-compose.prod.yml up -d    # Start production
docker-compose -f docker-compose.prod.yml down     # Stop production

# Access specific service logs
docker-compose -f docker-compose.dev.yml logs backend -f
docker-compose -f docker-compose.dev.yml logs frontend -f
docker-compose -f docker-compose.dev.yml logs postgres -f

# Execute commands in containers
docker-compose -f docker-compose.dev.yml exec backend npm run prisma:studio
docker-compose -f docker-compose.dev.yml exec backend npm test
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
- Dashboard, Orders (Kanban/List), Customers, Products
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

### Backend (Jest)

```bash
npm test                       # All tests
npm run test:unit              # Unit tests (mock Prisma)
npm run test:integration       # Integration tests (real DB)
npm run test:coverage          # Coverage report
npm test -- <filename>         # Specific test
```

**Structure:**
- `src/__tests__/unit/` - Unit tests
- `src/__tests__/integration/` - Integration tests
- `src/__tests__/mocks/` - Test mocks

### Frontend (Vitest)

```bash
npm test                       # All tests
npm run test:ui                # Interactive UI
npm run test:coverage          # Coverage report
```

**Patterns:**
- Use Vitest + Testing Library
- Mock API calls with MSW
- Colocate tests with components

### E2E (Playwright)

```bash
npm run test:e2e               # All E2E tests
npm run test:e2e:ui            # Interactive mode
npm run test:e2e:debug         # Debug mode
npm run test:e2e:report        # HTML report
```

**Located in:** `e2e/` directory

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

## Claude Code Agents

This project uses 13 specialized agents. See `.claude/agents/README.md` for details.

**Quick Reference:**
- `project-manager` - Multi-phase orchestration
- `frontend-developer` - React/Shadcn UI
- `backend-developer` - Node.js/Express/Prisma
- `database-architect` - Schema design, migrations
- `test-engineer` - Jest/Vitest/Playwright
- `code-reviewer` - Quality assurance
- `security-auditor` - Security scanning
- `devops-engineer` - CI/CD, Docker
- `performance-optimizer` - Performance tuning
- `documentation-writer` - Documentation

**Agent Pattern:**
- Sub-agents do RESEARCH (read-only)
- Parent agent does IMPLEMENTATION
- Context files in `.claude/docs/tasks/`
- Research plans in `.claude/docs/{agent}-plan.md`

## Development Guidelines

- Use specialized agents for tasks
- Frontend: Shadcn components only
- Backend: Keep business logic in services
- Always validate with Zod
- Type everything with TypeScript
- Test critical paths
- Be concise - no unnecessary docs
