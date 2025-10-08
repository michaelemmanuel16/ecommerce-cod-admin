# E-Commerce COD Admin Dashboard

> A comprehensive order management system with Kanban workflow automation, webhook integration, and multi-user support for Cash on Delivery (COD) e-commerce operations.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue)](https://www.typescriptlang.org/)

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Tech Stack](#tech-stack)
- [Quick Start (5 Minutes)](#quick-start-5-minutes)
- [Screenshots](#screenshots)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Development Setup](#development-setup)
- [Scripts Reference](#scripts-reference)
- [Environment Variables](#environment-variables)
- [Database Schema](#database-schema)
- [API Endpoints](#api-endpoints)
- [Workflow Automation](#workflow-automation)
- [Webhook Integration](#webhook-integration)
- [Security](#security)
- [Testing](#testing)
- [Deployment](#deployment)
- [Performance](#performance)
- [Monitoring](#monitoring)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)
- [Support](#support)

## Overview

The E-Commerce COD Admin Dashboard is a modern, full-stack application designed to streamline the management of Cash on Delivery orders. It provides a visual Kanban board interface for order workflow management, automated order processing, webhook integration with popular e-commerce platforms, and comprehensive analytics.

### Why This Project?

- **Streamlined Workflow**: Visual Kanban board for order status management
- **Automation**: Reduce manual work with automated order processing and status updates
- **Integration**: Connect seamlessly with Shopify, WooCommerce, and custom platforms
- **Multi-User**: Role-based access control for teams
- **Real-Time**: Live updates and notifications for order changes
- **Analytics**: Comprehensive dashboards and reporting

## Key Features

### Order Management
- ✅ **Kanban Board Interface**: Drag-and-drop order management across statuses
- ✅ **Bulk Operations**: Update multiple orders simultaneously
- ✅ **Advanced Filtering**: Search and filter by status, date, customer, product
- ✅ **Order Details**: Complete order information with customer and product details
- ✅ **Order History**: Track all changes and status transitions
- ✅ **Notes & Comments**: Add internal notes to orders

### Workflow Automation
- ✅ **Rule-Based Automation**: Create custom workflows based on conditions
- ✅ **Status Auto-Transitions**: Automatic order status updates
- ✅ **Notification System**: Email/SMS notifications on status changes
- ✅ **Time-Based Actions**: Schedule actions based on time triggers
- ✅ **Custom Webhooks**: Trigger external systems on events
- ✅ **Assignment Rules**: Auto-assign orders to team members

### Customer Management
- ✅ **Customer Profiles**: Complete customer information and history
- ✅ **Order History**: View all orders by customer
- ✅ **Customer Analytics**: Purchase patterns and insights
- ✅ **Customer Notes**: Add notes and tags to customers
- ✅ **Address Management**: Multiple shipping addresses per customer

### Product Management
- ✅ **Product Catalog**: Manage product inventory
- ✅ **Stock Tracking**: Real-time inventory updates
- ✅ **Product Variants**: Support for size, color, and custom variants
- ✅ **Product Analytics**: Sales and performance metrics
- ✅ **Image Management**: Multiple product images

### User Management
- ✅ **Role-Based Access Control (RBAC)**: Admin, Manager, Agent roles
- ✅ **Team Management**: Organize users into teams
- ✅ **Permission System**: Granular permissions per role
- ✅ **Activity Logging**: Track user actions and changes
- ✅ **User Profiles**: Customizable user profiles

### Analytics & Reporting
- ✅ **Order Analytics**: Sales, conversion, and performance metrics
- ✅ **Customer Analytics**: Customer lifetime value, retention
- ✅ **Product Analytics**: Best sellers, inventory turnover
- ✅ **Workflow Analytics**: Bottleneck identification
- ✅ **Custom Reports**: Generate custom reports
- ✅ **Export Functionality**: Export data to CSV/Excel

### Integration & Webhooks
- ✅ **Shopify Integration**: Automatic order import from Shopify
- ✅ **WooCommerce Integration**: WordPress/WooCommerce support
- ✅ **Custom Webhooks**: Create custom webhook endpoints
- ✅ **HMAC Security**: Secure webhook verification
- ✅ **Webhook Logs**: Track all webhook events
- ✅ **API Access**: RESTful API for custom integrations

### Security
- ✅ **JWT Authentication**: Secure token-based auth
- ✅ **Password Hashing**: bcrypt password encryption
- ✅ **Rate Limiting**: Prevent abuse and attacks
- ✅ **CORS Protection**: Configurable CORS policies
- ✅ **Input Validation**: Comprehensive request validation
- ✅ **Audit Logging**: Track all security-relevant events

### UI/UX
- ✅ **Responsive Design**: Works on desktop, tablet, mobile
- ✅ **Dark Mode**: System-aware dark mode support
- ✅ **Drag & Drop**: Intuitive Kanban board interface
- ✅ **Real-Time Updates**: Live data synchronization
- ✅ **Loading States**: Optimistic updates and skeletons
- ✅ **Error Handling**: User-friendly error messages

## Tech Stack

### Frontend
- **Framework**: React 18.3+ with TypeScript
- **Styling**: Tailwind CSS 3.4+
- **State Management**: React Query (TanStack Query)
- **Routing**: React Router 6+
- **Drag & Drop**: @dnd-kit/core
- **Forms**: React Hook Form + Zod validation
- **Charts**: Recharts
- **HTTP Client**: Axios
- **Build Tool**: Vite 5+

### Backend
- **Runtime**: Node.js 18+
- **Framework**: Express.js 4+
- **Language**: TypeScript 5+
- **Database**: PostgreSQL 15+
- **ORM**: Prisma 5+
- **Authentication**: JWT (jsonwebtoken)
- **Validation**: Zod
- **Password**: bcrypt
- **Rate Limiting**: express-rate-limit
- **Logging**: Custom logger

### DevOps & Tools
- **Package Manager**: npm/pnpm
- **Version Control**: Git
- **Code Quality**: ESLint, Prettier
- **API Testing**: Postman/Insomnia
- **Database UI**: Prisma Studio
- **Environment**: dotenv

## Quick Start (5 Minutes)

### Prerequisites
- Node.js 18+ installed
- PostgreSQL 15+ installed and running
- Git installed

### 1. Clone the Repository
```bash
git clone https://github.com/yourusername/ecommerce-cod-admin.git
cd ecommerce-cod-admin
```

### 2. Backend Setup
```bash
cd backend
npm install
```

Create `.env` file:
```bash
cp .env.example .env
```

Edit `.env` with your database credentials:
```env
DATABASE_URL="postgresql://user:password@localhost:5432/ecommerce_cod"
JWT_SECRET="your-super-secret-jwt-key-change-this"
PORT=5000
```

Run database migrations:
```bash
npx prisma migrate dev
npx prisma db seed  # Optional: Add demo data
```

Start backend server:
```bash
npm run dev
```

Backend should now be running on `http://localhost:5000`

### 3. Frontend Setup
Open a new terminal:
```bash
cd frontend
npm install
```

Create `.env` file:
```bash
cp .env.example .env
```

Edit `.env`:
```env
VITE_API_URL=http://localhost:5000/api
```

Start frontend:
```bash
npm run dev
```

Frontend should now be running on `http://localhost:5173`

### 4. Access the Application

Open your browser and navigate to `http://localhost:5173`

**Default Credentials:**
- Email: `admin@example.com`
- Password: `admin123`

**🎉 You're ready to go!**

## Screenshots

### Dashboard Overview
```
[Screenshot: Main dashboard with analytics cards]
```

### Kanban Board
```
[Screenshot: Order management Kanban board with drag-and-drop]
```

### Order Details
```
[Screenshot: Detailed order view with customer information]
```

### Customer Management
```
[Screenshot: Customer list and profile view]
```

### Workflow Automation
```
[Screenshot: Workflow automation rules configuration]
```

### Analytics Dashboard
```
[Screenshot: Charts and graphs showing order analytics]
```

## Architecture

### System Architecture

```mermaid
graph TB
    Client[React Frontend]
    API[Express API Server]
    DB[(PostgreSQL Database)]
    Cache[Redis Cache - Optional]
    Webhook[Webhook Receivers]
    External[External Platforms]
    
    Client -->|HTTP/REST| API
    API -->|Prisma ORM| DB
    API -->|Cache| Cache
    Webhook -->|Events| API
    External -->|Webhooks| Webhook
    API -->|Notifications| External
```

### Application Layers

```mermaid
graph LR
    A[Presentation Layer<br/>React Components] --> B[API Layer<br/>REST Endpoints]
    B --> C[Business Logic<br/>Services]
    C --> D[Data Access<br/>Prisma ORM]
    D --> E[Database<br/>PostgreSQL]
```

### Request Flow

```mermaid
sequenceDiagram
    participant C as Client
    participant M as Middleware
    participant R as Routes
    participant S as Services
    participant D as Database
    
    C->>M: HTTP Request
    M->>M: Auth Check
    M->>M: Validation
    M->>R: Validated Request
    R->>S: Business Logic
    S->>D: Data Query
    D->>S: Result
    S->>R: Processed Data
    R->>C: JSON Response
```

## Project Structure

```
ecommerce-cod-admin/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma          # Database schema
│   │   ├── migrations/            # Database migrations
│   │   └── seed.ts                # Seed data script
│   ├── src/
│   │   ├── config/
│   │   │   └── database.ts        # Database configuration
│   │   ├── middleware/
│   │   │   ├── auth.ts            # Authentication middleware
│   │   │   ├── validation.ts      # Request validation
│   │   │   └── errorHandler.ts    # Error handling
│   │   ├── routes/
│   │   │   ├── auth.ts            # Authentication routes
│   │   │   ├── orders.ts          # Order management
│   │   │   ├── customers.ts       # Customer management
│   │   │   ├── products.ts        # Product management
│   │   │   ├── users.ts           # User management
│   │   │   ├── workflows.ts       # Workflow automation
│   │   │   └── webhooks.ts        # Webhook endpoints
│   │   ├── services/
│   │   │   ├── orderService.ts
│   │   │   ├── customerService.ts
│   │   │   ├── productService.ts
│   │   │   └── workflowService.ts
│   │   ├── utils/
│   │   │   ├── jwt.ts
│   │   │   ├── validation.ts
│   │   │   └── logger.ts
│   │   ├── types/
│   │   │   └── index.ts           # TypeScript types
│   │   └── index.ts               # Application entry
│   ├── .env.example
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── layout/
│   │   │   │   ├── Header.tsx
│   │   │   │   ├── Sidebar.tsx
│   │   │   │   └── Layout.tsx
│   │   │   ├── orders/
│   │   │   │   ├── KanbanBoard.tsx
│   │   │   │   ├── OrderCard.tsx
│   │   │   │   └── OrderDetails.tsx
│   │   │   ├── customers/
│   │   │   ├── products/
│   │   │   ├── workflows/
│   │   │   └── common/
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx
│   │   │   ├── Orders.tsx
│   │   │   ├── Customers.tsx
│   │   │   ├── Products.tsx
│   │   │   └── Settings.tsx
│   │   ├── hooks/
│   │   │   ├── useAuth.ts
│   │   │   ├── useOrders.ts
│   │   │   └── useCustomers.ts
│   │   ├── services/
│   │   │   └── api.ts             # API client
│   │   ├── utils/
│   │   │   └── helpers.ts
│   │   ├── types/
│   │   │   └── index.ts
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── public/
│   ├── .env.example
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
├── docs/
│   ├── API_DOCUMENTATION.md
│   ├── USER_GUIDE.md
│   ├── DEVELOPER_GUIDE.md
│   └── DEPLOYMENT_GUIDE.md
├── .gitignore
├── README.md
├── CONTRIBUTING.md
└── LICENSE
```

## Development Setup

### Detailed Backend Setup

1. **Install Dependencies**
```bash
cd backend
npm install
```

2. **Database Setup**

Ensure PostgreSQL is running:
```bash
# macOS
brew services start postgresql

# Linux
sudo systemctl start postgresql

# Windows
# Start from Services panel
```

Create database:
```bash
createdb ecommerce_cod
```

3. **Environment Configuration**

Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Configure environment variables:
```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/ecommerce_cod"

# JWT
JWT_SECRET="your-super-secret-jwt-key-min-32-characters"
JWT_EXPIRES_IN="7d"

# Server
PORT=5000
NODE_ENV=development

# CORS
FRONTEND_URL="http://localhost:5173"

# Optional: Redis for caching
REDIS_URL="redis://localhost:6379"

# Optional: Email service
SMTP_HOST="smtp.gmail.com"
SMTP_PORT=587
SMTP_USER="your-email@gmail.com"
SMTP_PASS="your-app-password"
```

4. **Run Migrations**
```bash
npx prisma migrate dev --name init
```

5. **Seed Database (Optional)**
```bash
npx prisma db seed
```

6. **Start Development Server**
```bash
npm run dev
```

### Detailed Frontend Setup

1. **Install Dependencies**
```bash
cd frontend
npm install
```

2. **Environment Configuration**

Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Configure:
```env
VITE_API_URL=http://localhost:5000/api
VITE_APP_NAME="E-Commerce COD Admin"
```

3. **Start Development Server**
```bash
npm run dev
```

## Scripts Reference

### Backend Scripts

```json
{
  "dev": "tsx watch src/index.ts",
  "build": "tsc",
  "start": "node dist/index.js",
  "prisma:generate": "prisma generate",
  "prisma:migrate": "prisma migrate dev",
  "prisma:studio": "prisma studio",
  "prisma:seed": "tsx prisma/seed.ts",
  "test": "jest",
  "test:watch": "jest --watch",
  "lint": "eslint src --ext .ts",
  "format": "prettier --write \"src/**/*.ts\""
}
```

### Frontend Scripts

```json
{
  "dev": "vite",
  "build": "tsc && vite build",
  "preview": "vite preview",
  "lint": "eslint src --ext .ts,.tsx",
  "format": "prettier --write \"src/**/*.{ts,tsx}\"",
  "type-check": "tsc --noEmit"
}
```

## Environment Variables

### Backend Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | - | PostgreSQL connection string |
| `JWT_SECRET` | Yes | - | Secret key for JWT signing |
| `JWT_EXPIRES_IN` | No | `7d` | JWT token expiration |
| `PORT` | No | `5000` | Server port |
| `NODE_ENV` | No | `development` | Environment mode |
| `FRONTEND_URL` | No | `http://localhost:5173` | Frontend URL for CORS |
| `REDIS_URL` | No | - | Redis connection string |
| `SMTP_HOST` | No | - | Email server host |
| `SMTP_PORT` | No | `587` | Email server port |
| `SMTP_USER` | No | - | Email username |
| `SMTP_PASS` | No | - | Email password |
| `RATE_LIMIT_WINDOW` | No | `15` | Rate limit window (minutes) |
| `RATE_LIMIT_MAX` | No | `100` | Max requests per window |

### Frontend Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_API_URL` | Yes | - | Backend API URL |
| `VITE_APP_NAME` | No | `E-Commerce COD Admin` | Application name |

## Database Schema

### Core Tables

**Users**
```prisma
model User {
  id        String   @id @default(uuid())
  email     String   @unique
  password  String
  name      String
  role      Role     @default(AGENT)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

**Orders**
```prisma
model Order {
  id            String      @id @default(uuid())
  orderNumber   String      @unique
  customerId    String
  status        OrderStatus @default(PENDING)
  totalAmount   Float
  paymentMethod String      @default("COD")
  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt
  customer      Customer    @relation(fields: [customerId], references: [id])
  items         OrderItem[]
}
```

**Customers**
```prisma
model Customer {
  id          String   @id @default(uuid())
  name        String
  email       String   @unique
  phone       String
  address     String
  city        String
  country     String
  createdAt   DateTime @default(now())
  orders      Order[]
}
```

**Products**
```prisma
model Product {
  id          String   @id @default(uuid())
  name        String
  sku         String   @unique
  price       Float
  stock       Int
  description String?
  imageUrl    String?
  createdAt   DateTime @default(now())
}
```

See [PRISMA_GUIDE.md](backend/PRISMA_GUIDE.md) for complete schema documentation.

## API Endpoints

### Authentication
- `POST /api/auth/login` - User login
- `POST /api/auth/register` - User registration
- `POST /api/auth/refresh` - Refresh token
- `GET /api/auth/me` - Get current user

### Orders
- `GET /api/orders` - List orders (with filters)
- `GET /api/orders/:id` - Get order details
- `POST /api/orders` - Create order
- `PUT /api/orders/:id` - Update order
- `PATCH /api/orders/:id/status` - Update order status
- `DELETE /api/orders/:id` - Delete order

### Customers
- `GET /api/customers` - List customers
- `GET /api/customers/:id` - Get customer details
- `POST /api/customers` - Create customer
- `PUT /api/customers/:id` - Update customer

### Products
- `GET /api/products` - List products
- `GET /api/products/:id` - Get product details
- `POST /api/products` - Create product
- `PUT /api/products/:id` - Update product

See [API_DOCUMENTATION.md](docs/API_DOCUMENTATION.md) for complete API reference.

## Workflow Automation

The system supports powerful workflow automation:

- **Rule-Based**: Create rules based on order conditions
- **Actions**: Auto-update status, send notifications, assign users
- **Triggers**: Time-based, event-based, condition-based
- **Custom Webhooks**: Integrate with external systems

Example workflow:
```javascript
{
  "name": "Auto-confirm high-value orders",
  "trigger": "order.created",
  "conditions": {
    "totalAmount": { "gte": 1000 }
  },
  "actions": [
    { "type": "updateStatus", "status": "CONFIRMED" },
    { "type": "sendEmail", "template": "high-value-order" }
  ]
}
```

See [WORKFLOW_AUTOMATION_GUIDE.md](docs/WORKFLOW_AUTOMATION_GUIDE.md) for details.

## Webhook Integration

Supports webhooks from:
- Shopify
- WooCommerce
- Custom platforms

Features:
- HMAC signature verification
- Retry logic
- Webhook logging
- Event filtering

See [WEBHOOK_INTEGRATION_GUIDE.md](docs/WEBHOOK_INTEGRATION_GUIDE.md) for setup.

## Security

### Implemented Security Features

- ✅ JWT-based authentication
- ✅ Password hashing with bcrypt
- ✅ Rate limiting (100 requests/15 minutes)
- ✅ CORS protection
- ✅ Input validation with Zod
- ✅ SQL injection prevention (Prisma ORM)
- ✅ XSS protection
- ✅ HTTPS in production
- ✅ Environment variable protection
- ✅ Audit logging

See [SECURITY_GUIDE.md](docs/SECURITY_GUIDE.md) for best practices.

## Testing

### Backend Testing
```bash
cd backend
npm test                # Run all tests
npm run test:watch      # Watch mode
npm run test:coverage   # Coverage report
```

### Frontend Testing
```bash
cd frontend
npm test                # Run all tests
npm run test:watch      # Watch mode
```

## Deployment

### Production Build

**Backend:**
```bash
cd backend
npm run build
npm start
```

**Frontend:**
```bash
cd frontend
npm run build
# Serve the dist/ folder with nginx or similar
```

### Docker Deployment

```bash
docker-compose up -d
```

### Cloud Platforms

- **AWS**: EC2, RDS, S3, CloudFront
- **Google Cloud**: App Engine, Cloud SQL, Cloud Storage
- **Azure**: App Service, PostgreSQL, Blob Storage
- **Vercel**: Frontend hosting
- **Heroku**: Full-stack deployment

See [DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md) for detailed instructions.

## Performance

### Optimization Techniques

- **Database**: Indexed queries, connection pooling
- **API**: Response caching, pagination
- **Frontend**: Code splitting, lazy loading, memoization
- **CDN**: Static asset delivery
- **Compression**: Gzip/Brotli compression

### Performance Metrics

- API response time: <200ms (average)
- Frontend load time: <2s (first paint)
- Database queries: <50ms (indexed)

## Monitoring

### Recommended Tools

- **Application**: New Relic, Datadog, Sentry
- **Database**: PostgreSQL logs, pg_stat_statements
- **Server**: Prometheus, Grafana
- **Uptime**: UptimeRobot, Pingdom

### Health Checks

- `GET /health` - Application health
- `GET /api/health` - API health
- Database connection check

## Troubleshooting

### Common Issues

**Database connection failed**
```bash
# Check PostgreSQL is running
psql -U postgres -c "SELECT 1"

# Verify DATABASE_URL in .env
echo $DATABASE_URL
```

**Port already in use**
```bash
# Find and kill process
lsof -ti:5000 | xargs kill -9
```

**Prisma migration errors**
```bash
# Reset database (DEV ONLY!)
npx prisma migrate reset

# Or manually fix
npx prisma migrate resolve --rolled-back "migration-name"
```

**Frontend can't connect to backend**
- Check `VITE_API_URL` in frontend `.env`
- Verify backend is running on correct port
- Check CORS settings in backend

See [FAQ.md](docs/FAQ.md) for more troubleshooting.

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for:

- Code of Conduct
- Development workflow
- Coding standards
- Pull request process
- Issue reporting

### Quick Contribution Guide

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

### Documentation

- [API Documentation](docs/API_DOCUMENTATION.md)
- [User Guide](docs/USER_GUIDE.md)
- [Developer Guide](docs/DEVELOPER_GUIDE.md)
- [Deployment Guide](docs/DEPLOYMENT_GUIDE.md)

### Community

- **Issues**: [GitHub Issues](https://github.com/yourusername/ecommerce-cod-admin/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/ecommerce-cod-admin/discussions)
- **Email**: support@example.com

### Professional Support

For enterprise support, custom development, or consulting:
- Email: enterprise@example.com
- Website: https://example.com/support

---

**Made with ❤️ by the E-Commerce COD Team**

**Star ⭐ this repo if you find it useful!**
