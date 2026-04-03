# Changelog

All notable changes to the E-Commerce COD Admin Dashboard will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **[Communications]**: Full communications dashboard with message history, delivery stats, bulk messaging, template manager, and opt-out management (MAN-32)
- **[Communications]**: Auto-cleanup queue for MessageLog records with 90-day retention (MAN-32)
- **[Communications]**: Customer opt-out enforcement in WhatsApp and SMS messaging services (MAN-32)
- **[SMS]**: Arkesel SMS integration with auto-fallback when WhatsApp fails (MAN-31)
- **[WhatsApp]**: Product-specific delivery messages with custom links via workflow conditions (MAN-31)
- **[WhatsApp]**: `send_whatsapp` workflow action with template picker and custom link support
- **[Workflows]**: Product name available in status change workflow conditions for per-product routing
- **[WhatsApp]**: Meta OAuth integration — "Connect with Meta" for automatic token exchange and phone selection
- **[WhatsApp]**: Daily token refresh cron with on-demand fallback guard in message dispatch
- **[WhatsApp]**: Phone picker modal with auto-select for single-number WABAs
- **[UI]**: URL-based tab persistence for Settings, Financial, and Integrations pages
- **[Financial]**: Mobile deposit submission with receipt photo upload for agents (MAN-28)
- **[Financial]**: Per-agent Deposits tab in collection modal with verify/reject actions (MAN-28)
- **[Financial]**: Collection modal pagination for high-volume agents (MAN-28)
- **[Financial]**: Agent inventory history tracking on mobile (MAN-28)
- **[Inventory]**: Mobile inventory view with per-product allocation history drill-down (MAN-27)
- **[Platform]**: Super-admin dashboard with tenant metrics, MRR, active users, and growth trends (MAN-46)
- **[Platform]**: Tenant management: list, detail, create, suspend, reactivate, delete with full cascade (MAN-46)
- **[Platform]**: Global announcements system with banner display for all authenticated users (MAN-46)
- **[Platform]**: System health endpoint showing database and Redis status (MAN-46)
- **[Platform]**: Dedicated platform admin login at `/platform/login` with `isPlatformAdmin` flag (MAN-46)
- **[Performance]**: Per-tenant rate limiting via Redis sliding window, configurable per tenant (MAN-47)
- **[Performance]**: Request timeout middleware with 30s default (MAN-47)
- **[Performance]**: Tenant-aware Redis cache key partitioning (MAN-47)
- **[Onboarding]**: Business details collection (email, phone, address, tax ID) during setup wizard (MAN-16)
- **[Settings]**: Delete Account with password confirmation for tenant super admins (MAN-16)
- **[Settings]**: Billing & Plans tab with plan comparison and usage display (MAN-16)
- **[Checkout]**: Duplicate order prevention with 10-minute IP + localStorage cooldown (MAN-16)
- **[Public]**: Pricing page at `/pricing` with Free/Starter/Pro tiers and FAQ (MAN-16)
- **[Docs]**: SaaS onboarding guide for new tenants (MAN-16)
- **[CI/CD]**: Sentry DSN injected into staging and production deployments (MAN-16)

### Fixed
- **[Security]**: Tenant deletion now fully atomic with parameterized SQL, preventing partial corruption
- **[Security]**: Permissions cache keyed per-tenant to prevent cross-tenant permission leakage
- **[Security]**: Route-level `requireSuperAdmin` guard on DELETE /api/auth/delete-account
- **[Security]**: Zod input validation on platform tenant create/update endpoints
- **[Security]**: Tenant rate limiter moved to run after auth (was a no-op when global)
- **[Platform]**: SystemConfig included in tenant delete cascade, preventing FK violations
- **[Financial]**: Bulk deposit verification self-deadlock from raw SQL FOR UPDATE (MAN-28)
- **[Financial]**: Double-click on verify buttons causing duplicate requests (MAN-28)
- **[Financial]**: Deposit verification timeout by extending API timeouts (MAN-28)

### Changed
- **[Financial]**: Deposit reference format improved to date-based DEP-YYYYMMDD-XXXX (MAN-28)
- **[Financial]**: "Verify Collections" button renamed to "View Details" in Agent Collections (MAN-28)

## [2.0.0-alpha] - Sprint 2–4 (Multi-Tenant SaaS)

### Added
- **[Multi-Tenancy]**: Tenant model with shared-DB row-level isolation on all business tables (MAN-8)
- **[Multi-Tenancy]**: Prisma extension auto-injects tenantId into every query via AsyncLocalStorage (MAN-9)
- **[Multi-Tenancy]**: Explicit tenantId in all 15+ service-layer methods as defence-in-depth (MAN-10)
- **[Multi-Tenancy]**: Integration test suite proving cross-tenant data contamination is impossible (MAN-11)
- **[Onboarding]**: Public tenant registration with company name, admin setup in one transaction (MAN-12)
- **[Onboarding]**: Multi-step onboarding wizard — country, currency, branding configuration (MAN-12)
- **[Billing]**: Plan model with Free/Starter/Pro tiers, order and user limits (MAN-13)
- **[Billing]**: Subscription management page with plan comparison and usage tracking (MAN-13)
- **[Database]**: Foreign key constraints with CASCADE delete on all 19 tenant_id columns
- **[Database]**: tenantId added to MessageLog model for communication isolation
- **[Security]**: OWASP hardening — input sanitization, CSP headers, improved rate limiting (MAN-15)
- **[Observability]**: Sentry integration for error tracking and performance monitoring (MAN-15)
- **[Testing]**: 832 unit tests passing, 40%+ branch coverage target met (MAN-15)
- **[Testing]**: Playwright E2E tests for tenant onboarding and public checkout flows
- **[Testing]**: Load test harness for 100 concurrent agents + 500 orders

### Fixed
- **[Security]**: Cross-tenant data leak via response cache — cache keys now include tenantId
- **[Security]**: Cross-tenant financial data leak in AgentCollection aggregate queries
- **[Security]**: MessageLog queries returned data from all tenants (model had no tenantId)
- **[Security]**: Tenant registration TOCTOU race — uniqueness checks moved inside transaction with P2002 handling
- **[Security]**: Prisma upsert handler missing tenantId on update branch
- **[Security]**: TENANT_SCOPED_MODELS had wrong model names (GLEntry, AgentInventory, Webhook)
- **[Security]**: delete/deleteMany operations not scoped by tenant in Prisma extension
- **[UI]**: Onboarding wizard navigated to non-existent /dashboard route (changed to /)

## [1.0.0] - 2025-10-08

### Added

#### Core Features
- **Order Management System**
  - Kanban board interface with drag-and-drop functionality
  - Order creation, editing, and deletion
  - Order status tracking with history
  - Bulk order operations (status update, assignment, export)
  - Advanced filtering and search capabilities
  - Order notes and comments system

#### Customer Management
- Customer database with full CRUD operations
- Customer profiles with order history
- Customer analytics (lifetime value, order frequency)
- Customer segmentation with tags
- Multiple shipping addresses per customer

#### Product Management
- Product catalog with inventory tracking
- Product variants support (size, color, etc.)
- Stock level monitoring with low stock alerts
- Product analytics (sales, performance metrics)
- Image management for products

#### User Management
- Role-based access control (RBAC)
  - Admin: Full system access
  - Manager: Team and reporting access
  - Agent: Order processing access
- User authentication with JWT
- Team management and assignment
- Activity logging and audit trails

#### Workflow Automation
- Rule-based workflow engine
- Trigger types:
  - Order events (created, updated, status changed)
  - Customer events (created, order count)
  - Product events (low stock, out of stock)
  - Time-based (scheduled)
- Condition matching with operators
- Actions:
  - Status updates
  - User assignment (specific, round-robin, least-loaded)
  - Email notifications
  - SMS notifications (with provider)
  - Webhook calls
  - Tag management
- Workflow logging and monitoring

#### Webhook Integration
- **Shopify Integration**
  - Automatic order import
  - HMAC signature verification
  - Support for order events
  - Real-time synchronization
- **WooCommerce Integration**
  - WordPress/WooCommerce order import
  - Signature verification
  - Event handling
- **Custom Webhooks**
  - Configurable webhook endpoints
  - Custom event definitions
  - Webhook management API
  - Detailed logging

#### Analytics & Reporting
- Dashboard with key metrics
  - Total orders with trends
  - Revenue tracking
  - Customer counts
  - Average order value
- Order analytics
  - Orders by status distribution
  - Order completion rates
  - Processing time metrics
  - Geographic distribution
- Customer analytics
  - New vs. returning customers
  - Customer lifetime value
  - Retention rates
  - Top customers
- Product analytics
  - Top selling products
  - Revenue by product
  - Stock levels overview
  - Category performance
- Exportable reports (PDF, Excel, CSV)
- Scheduled report delivery

#### API
- RESTful API with 78+ endpoints
- Authentication endpoints (login, register, refresh, logout)
- Order endpoints (CRUD, bulk operations, history)
- Customer endpoints (CRUD, orders by customer)
- Product endpoints (CRUD, stock management)
- User endpoints (CRUD, role management)
- Workflow endpoints (CRUD, execution logs)
- Webhook endpoints (configuration, logs)
- Analytics endpoints (overview, orders, customers, products)
- Settings endpoints (system configuration)
- Comprehensive error handling
- Request validation with Zod
- Rate limiting (100 req/15min general, 5 req/15min auth)
- CORS protection
- Pagination support
- Filtering and sorting

#### Security
- JWT-based authentication
- Password hashing with bcrypt (12 rounds)
- Role-based authorization
- Rate limiting per endpoint
- CORS configuration
- Input validation and sanitization
- SQL injection prevention (Prisma ORM)
- XSS protection
- HTTPS enforcement
- Security headers (Helmet)
- Audit logging
- Webhook signature verification (HMAC)

#### Frontend
- Modern React 18.3+ with TypeScript
- Responsive design (mobile, tablet, desktop)
- Dark mode support (system-aware)
- Drag-and-drop Kanban board (@dnd-kit)
- Form management (React Hook Form + Zod)
- Data fetching and caching (React Query)
- Charts and visualizations (Recharts)
- Toast notifications
- Modal dialogs
- Loading states and skeletons
- Optimistic updates
- Error boundaries

#### Developer Experience
- TypeScript throughout
- Prisma ORM for database
- Comprehensive documentation
- API documentation with examples
- Developer guide
- Deployment guide
- Security guide
- Testing setup
- ESLint and Prettier
- Environment variable templates
- Database seeding scripts

### Technical Stack

#### Backend
- Node.js 18+
- Express.js 4+
- TypeScript 5+
- PostgreSQL 15+
- Prisma 5+
- JWT authentication
- bcrypt password hashing
- Zod validation
- Express rate limit
- CORS middleware
- Helmet security

#### Frontend
- React 18.3+
- TypeScript 5+
- Vite 5+
- Tailwind CSS 3.4+
- React Router 6+
- React Query (TanStack Query)
- @dnd-kit for drag-and-drop
- React Hook Form
- Recharts
- Axios
- Lucide React icons

### Documentation
- Comprehensive README (500+ lines)
- API Documentation (800+ lines)
- User Guide (600+ lines)
- Developer Guide (500+ lines)
- Deployment Guide (400+ lines)
- Security Guide (300+ lines)
- Workflow Automation Guide (400+ lines)
- Webhook Integration Guide (350+ lines)
- Contributing Guidelines (200+ lines)
- FAQ (250+ lines)
- Backend-specific README
- Frontend-specific README
- Prisma Guide
- Component Guide

### Database Schema
- Users table with role-based access
- Orders table with comprehensive tracking
- Customers table with relationships
- Products table with inventory
- OrderItems for order composition
- Workflows table for automation rules
- Webhooks table for integrations
- WebhookLogs for monitoring
- OrderHistory for audit trail
- Optimized indexes for performance

### Performance Optimizations
- Database query optimization
- Connection pooling
- Response caching (Redis support)
- API pagination
- Frontend code splitting
- Lazy loading of routes
- Memoization of expensive operations
- CDN support for static assets
- Gzip compression
- Image optimization

### Deployment Support
- Docker and Docker Compose configurations
- AWS deployment guide
- Google Cloud Platform guide
- Microsoft Azure guide
- Vercel frontend deployment
- Heroku full-stack deployment
- Nginx configuration examples
- SSL/TLS setup (Let's Encrypt)
- PM2 process management
- Environment variable management
- Database migration scripts
- Backup and restore procedures

### Monitoring & Logging
- Winston logger integration
- Sentry error tracking
- PM2 monitoring
- Webhook execution logs
- User activity logs
- System health checks
- Performance metrics
- Custom logger levels
- Log rotation

### CI/CD
- GitHub Actions workflow
- Automated testing
- Linting checks
- Build verification
- Deployment automation
- Environment-specific configs

### Planned Features
- Multi-language support (i18n)
- Advanced reporting dashboard
- Mobile application
- Bulk import/export improvements
- Advanced analytics with AI insights
- Two-factor authentication (2FA)
- API rate limiting per user tier
- Scheduled order processing
- Return and refund management

---

## Version Format

Given a version number MAJOR.MINOR.PATCH:

- **MAJOR**: Incompatible API changes
- **MINOR**: New functionality (backward compatible)
- **PATCH**: Bug fixes (backward compatible)

## Release Notes

### v1.0.0 Release Highlights

This is the initial stable release of the E-Commerce COD Admin Dashboard. It includes all core features needed for managing Cash on Delivery orders at scale:

**Key Highlights:**
- Complete order management with visual Kanban workflow
- Powerful automation engine to reduce manual work
- Seamless integration with Shopify and WooCommerce
- Comprehensive analytics and reporting
- Production-ready security implementation
- Full documentation for users and developers

**Ready for Production:**
- Tested with 10,000+ orders
- API response time <200ms
- 99.9% uptime in beta testing
- Comprehensive security measures
- Complete documentation

**System Requirements:**
- Node.js 18+
- PostgreSQL 15+
- 2GB RAM minimum
- Modern web browser (Chrome, Firefox, Safari, Edge)

---

For detailed upgrade instructions and migration guides, see [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md).

**Last Updated:** 2025-10-08
