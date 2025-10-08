# Backend - E-Commerce COD Admin

Backend API server for the E-Commerce COD Admin Dashboard.

## Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [Environment Variables](#environment-variables)
- [Database](#database)
- [API Endpoints](#api-endpoints)
- [Authentication](#authentication)
- [Scripts](#scripts)
- [Testing](#testing)
- [Development](#development)
- [Deployment](#deployment)

## Overview

The backend is a RESTful API built with Node.js, Express, and TypeScript. It uses PostgreSQL with Prisma ORM for data persistence and JWT for authentication.

### Key Features

- RESTful API with 78+ endpoints
- JWT authentication and authorization
- PostgreSQL database with Prisma ORM
- Request validation with Zod
- Rate limiting and security headers
- Webhook support (Shopify, WooCommerce)
- Comprehensive error handling
- Request logging
- TypeScript for type safety

## Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js 4+
- **Language**: TypeScript 5+
- **Database**: PostgreSQL 15+
- **ORM**: Prisma 5+
- **Authentication**: jsonwebtoken
- **Validation**: Zod
- **Password**: bcrypt
- **Security**: helmet, cors, express-rate-limit
- **Testing**: Jest

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL 15+
- npm or pnpm

### Installation

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Edit .env with your configuration
nano .env

# Setup database
npx prisma migrate dev
npx prisma db seed

# Start development server
npm run dev
```

Server will start at `http://localhost:5000`

## Project Structure

```
backend/
├── prisma/
│   ├── schema.prisma      # Database schema
│   ├── migrations/        # Migration files
│   └── seed.ts           # Seed data script
├── src/
│   ├── config/
│   │   └── database.ts   # Database configuration
│   ├── middleware/
│   │   ├── auth.ts       # Authentication middleware
│   │   ├── validation.ts # Request validation
│   │   └── errorHandler.ts
│   ├── routes/
│   │   ├── auth.routes.ts
│   │   ├── order.routes.ts
│   │   ├── customer.routes.ts
│   │   ├── product.routes.ts
│   │   ├── user.routes.ts
│   │   ├── workflow.routes.ts
│   │   └── webhook.routes.ts
│   ├── services/
│   │   ├── auth.service.ts
│   │   ├── order.service.ts
│   │   └── ...
│   ├── utils/
│   │   ├── jwt.ts
│   │   ├── password.ts
│   │   └── logger.ts
│   ├── types/
│   │   └── index.ts
│   ├── app.ts           # Express app setup
│   └── index.ts         # Entry point
├── tests/
│   ├── unit/
│   └── integration/
├── .env.example
├── package.json
└── tsconfig.json
```

## Environment Variables

### Required Variables

```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/ecommerce_cod

# JWT
JWT_SECRET=your-super-secret-jwt-key-min-32-characters
JWT_EXPIRES_IN=7d

# Server
PORT=5000
NODE_ENV=development

# CORS
FRONTEND_URL=http://localhost:5173
```

### Optional Variables

```env
# Redis (caching)
REDIS_URL=redis://localhost:6379

# Email
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# Webhook Secrets
SHOPIFY_WEBHOOK_SECRET=your-shopify-secret
WOOCOMMERCE_WEBHOOK_SECRET=your-woocommerce-secret

# Rate Limiting
RATE_LIMIT_WINDOW=15
RATE_LIMIT_MAX=100
```

## Database

### Prisma Commands

```bash
# Generate Prisma Client
npx prisma generate

# Create migration
npx prisma migrate dev --name migration_name

# Apply migrations
npx prisma migrate deploy

# Reset database (DEV ONLY!)
npx prisma migrate reset

# Open Prisma Studio (Database GUI)
npx prisma studio

# Seed database
npx prisma db seed
```

### Database Schema

See `prisma/schema.prisma` for complete schema.

**Main Models:**
- User - System users
- Order - Customer orders
- Customer - Customer information
- Product - Product catalog
- OrderItem - Order line items
- Workflow - Automation rules
- Webhook - Webhook configurations

## API Endpoints

### Authentication

```
POST   /api/auth/login       # Login
POST   /api/auth/register    # Register
POST   /api/auth/refresh     # Refresh token
GET    /api/auth/me          # Get current user
POST   /api/auth/logout      # Logout
```

### Orders

```
GET    /api/orders           # List orders
GET    /api/orders/:id       # Get order
POST   /api/orders           # Create order
PUT    /api/orders/:id       # Update order
PATCH  /api/orders/:id/status # Update status
DELETE /api/orders/:id       # Delete order
GET    /api/orders/:id/history # Order history
PATCH  /api/orders/bulk/status # Bulk status update
```

### Customers

```
GET    /api/customers        # List customers
GET    /api/customers/:id    # Get customer
POST   /api/customers        # Create customer
PUT    /api/customers/:id    # Update customer
DELETE /api/customers/:id    # Delete customer
GET    /api/customers/:id/orders # Customer orders
```

### Products

```
GET    /api/products         # List products
GET    /api/products/:id     # Get product
POST   /api/products         # Create product
PUT    /api/products/:id     # Update product
DELETE /api/products/:id     # Delete product
```

See [API_DOCUMENTATION.md](../API_DOCUMENTATION.md) for complete API reference.

## Authentication

### JWT Flow

1. User logs in with email/password
2. Server verifies credentials
3. Server generates JWT token
4. Client includes token in subsequent requests
5. Server verifies token on protected routes

### Protecting Routes

```typescript
import { authenticate } from './middleware/auth';

// Require authentication
router.get('/orders', authenticate, getOrders);

// Require specific role
router.delete('/orders/:id', authenticate, authorize('ADMIN'), deleteOrder);
```

## Scripts

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

## Testing

```bash
# Run all tests
npm test

# Run in watch mode
npm run test:watch

# Run specific test file
npm test -- order.service.test.ts

# Generate coverage report
npm test -- --coverage
```

### Writing Tests

```typescript
// tests/unit/services/order.service.test.ts
import { OrderService } from '../../../src/services/order.service';

describe('OrderService', () => {
  it('should create order', async () => {
    const service = new OrderService();
    const order = await service.create(mockData);
    expect(order).toBeDefined();
    expect(order.status).toBe('PENDING');
  });
});
```

## Development

### Adding a New Endpoint

1. **Create Route Handler**
   ```typescript
   // src/routes/example.routes.ts
   import { Router } from 'express';
   
   const router = Router();
   
   router.get('/', authenticate, async (req, res) => {
     // Handle request
   });
   
   export default router;
   ```

2. **Create Service**
   ```typescript
   // src/services/example.service.ts
   export class ExampleService {
     async getAll() {
       return await prisma.example.findMany();
     }
   }
   ```

3. **Register Route**
   ```typescript
   // src/app.ts
   import exampleRoutes from './routes/example.routes';
   app.use('/api/examples', exampleRoutes);
   ```

### Code Style

- Use TypeScript for all code
- Follow ESLint rules
- Format with Prettier
- Write JSDoc comments
- Use async/await (not callbacks)
- Handle errors properly

## Deployment

### Production Build

```bash
# Build
npm run build

# Start production server
npm start
```

### Using PM2

```bash
# Install PM2
npm install -g pm2

# Start with PM2
pm2 start dist/index.js --name ecommerce-backend

# Save configuration
pm2 save

# Setup startup script
pm2 startup
```

### Docker

```bash
# Build image
docker build -t ecommerce-backend .

# Run container
docker run -p 5000:5000 ecommerce-backend
```

See [DEPLOYMENT_GUIDE.md](../DEPLOYMENT_GUIDE.md) for complete deployment instructions.

---

**For more information:**
- [API Documentation](../API_DOCUMENTATION.md)
- [Developer Guide](../DEVELOPER_GUIDE.md)
- [Prisma Guide](PRISMA_GUIDE.md)

**Last Updated:** 2025-10-08
