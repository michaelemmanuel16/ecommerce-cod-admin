# E-Commerce COD Admin Dashboard

> A comprehensive order management system with Kanban workflow automation, webhook integration, and multi-user support for Cash on Delivery (COD) e-commerce operations.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue)](https://www.typescriptlang.org/)

## Overview

The E-Commerce COD Admin Dashboard is a modern, full-stack TypeScript application designed to streamline the management of Cash on Delivery orders. It provides a visual Kanban board interface, automated order processing, webhook integrations with popular e-commerce platforms, and comprehensive analytics.

**Key Capabilities:**
- 📊 Visual Kanban board for order workflow management
- 🤖 Automated order processing with custom workflows
- 🔗 Webhook integration (Shopify, WooCommerce, custom platforms)
- 👥 Multi-user with role-based access control
- 📱 Real-time updates via Socket.io
- 📈 Comprehensive analytics and reporting
- 📝 Public checkout form builder
- 🚚 Delivery tracking and agent management

## Quick Start

### Prerequisites
- Node.js >= 18.0.0
- PostgreSQL >= 13
- Redis (optional, for queues)

### Installation

1. **Clone the repository**
```bash
git clone https://github.com/yourusername/ecommerce-cod-admin.git
cd ecommerce-cod-admin
```

2. **Setup Backend**
```bash
cd backend
npm install
cp .env.example .env          # Edit with your database credentials
npm run prisma:migrate
npx prisma db seed           # Optional: seed with sample data
npm run dev                  # Runs on port 3000
```

3. **Setup Frontend** (new terminal)
```bash
cd frontend
npm install
# Create .env with: VITE_API_URL=http://localhost:3000
npm run dev                  # Runs on port 5173
```

4. **Access the application**

Open `http://localhost:5173` in your browser.

**Default credentials:**
- Email: `admin@example.com`
- Password: `admin123`

## Documentation

📚 **Comprehensive documentation is available in the [`docs/`](docs/) directory:**

### For Users
- **[Getting Started](docs/guides/GETTING_STARTED.md)** - Complete onboarding guide
- **[User Guide](docs/guides/USER_GUIDE.md)** - Feature walkthroughs and usage
- **[Workflow Automation](docs/guides/WORKFLOW_AUTOMATION_GUIDE.md)** - Automation setup
- **[Webhook Integration](docs/guides/WEBHOOK_INTEGRATION_GUIDE.md)** - External integrations

### For Developers
- **[API Documentation](docs/development/API_DOCUMENTATION.md)** - REST API reference
- **[Developer Guide](docs/development/DEVELOPER_GUIDE.md)** - Architecture and patterns
- **[Testing Guide](docs/development/TESTING_SETUP_SUMMARY.md)** - Test infrastructure
- **[Security Guide](docs/development/SECURITY_GUIDE.md)** - Security best practices
- **[FAQ](docs/development/FAQ.md)** - Common questions

### For DevOps
- **[Deployment Guide](docs/deployment/DEPLOYMENT_GUIDE.md)** - Production deployment
- **[Docker Setup](docs/deployment/DOCKER_SETUP.md)** - Docker configuration
- **[Production Checklist](docs/deployment/PRODUCTION_CHECKLIST.md)** - Pre-launch checklist

📖 See **[docs/README.md](docs/README.md)** for the complete documentation index.

## Key Features

### Order Management
- ✅ Kanban board interface with drag-and-drop
- ✅ Bulk operations and advanced filtering
- ✅ Complete order history tracking
- ✅ Internal notes and comments

### Workflow Automation
- ✅ Rule-based automation
- ✅ Auto-assign orders to team members
- ✅ Email/SMS notifications
- ✅ Time-based and webhook triggers
- ✅ Custom action sequences

### Customer Management
- ✅ Customer profiles with order history
- ✅ Purchase analytics and insights
- ✅ Multiple shipping addresses
- ✅ Customer tagging system

### Product Management
- ✅ Product catalog with variants
- ✅ Real-time stock tracking
- ✅ Product analytics
- ✅ Image management

### User Management
- ✅ 7 role types (super_admin, admin, manager, sales_rep, inventory_manager, delivery_agent, accountant)
- ✅ Granular permission system
- ✅ Activity logging
- ✅ Team organization

### Analytics & Reporting
- ✅ Sales and conversion metrics
- ✅ Customer lifetime value analysis
- ✅ Product performance tracking
- ✅ Workflow bottleneck identification
- ✅ CSV/Excel export

### Public Checkout Forms
- ✅ Customizable checkout forms
- ✅ Package and upsell configuration
- ✅ No authentication required
- ✅ Ghana regions support

## Tech Stack

**Backend:**
- Node.js + Express + TypeScript
- PostgreSQL with Prisma ORM
- JWT authentication with refresh tokens
- Socket.io for real-time updates
- Bull + Redis for background jobs
- Jest for testing

**Frontend:**
- React 18 + TypeScript + Vite
- Zustand for state management
- Shadcn UI components
- React Flow (workflow builder)
- @dnd-kit (drag-and-drop)
- Socket.io client
- React Hook Form + Zod
- Vitest + Playwright for testing

## Development

### Quick Commands

**Backend:**
```bash
cd backend
npm run dev                    # Start dev server
npm run prisma:studio          # Database GUI
npm test                       # Run tests
npm run test:performance       # Query performance tests
```

**Frontend:**
```bash
cd frontend
npm run dev                    # Start dev server
npm test                       # Run tests
npm run build                  # Production build
```

**E2E Tests:**
```bash
npm run test:e2e               # Run all E2E tests
npm run test:e2e:ui            # Interactive mode
```

### Project Structure

```
ecommerce-cod-admin/
├── backend/                   # Node.js/Express API
│   ├── prisma/               # Database schema & migrations
│   ├── src/
│   │   ├── routes/           # API routes
│   │   ├── controllers/      # Request handlers
│   │   ├── services/         # Business logic
│   │   ├── middleware/       # Auth, validation, etc.
│   │   ├── queues/           # Bull job queues
│   │   ├── sockets/          # Socket.io setup
│   │   └── __tests__/        # Tests
│   └── package.json
├── frontend/                  # React SPA
│   ├── src/
│   │   ├── pages/            # Page components
│   │   ├── components/       # Reusable components
│   │   ├── stores/           # Zustand stores
│   │   ├── services/         # API clients
│   │   └── __tests__/        # Tests
│   └── package.json
├── e2e/                       # Playwright E2E tests
├── docs/                      # Documentation
│   ├── guides/               # User guides
│   ├── development/          # Developer docs
│   ├── deployment/           # Deployment docs
│   └── archive/              # Historical docs
├── CLAUDE.md                  # AI assistant guidance
├── CHANGELOG.md               # Version history
└── README.md                  # This file
```

## Deployment

### Docker (Recommended)

```bash
# Development
docker-compose -f docker-compose.dev.yml up -d

# Production
docker-compose -f docker-compose.prod.yml up -d
```

### Manual Deployment

See [Deployment Guide](docs/deployment/DEPLOYMENT_GUIDE.md) for detailed instructions on:
- Environment setup
- Database migrations
- SSL configuration
- Monitoring setup
- Backup strategies

## Environment Variables

### Backend (.env)
```env
DATABASE_URL=postgresql://user:pass@localhost:5432/dbname
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-secret-key
JWT_REFRESH_SECRET=your-refresh-secret
NODE_ENV=development|production
FRONTEND_URL=http://localhost:5173
```

### Frontend (.env)
```env
VITE_API_URL=http://localhost:3000
```

See [Developer Guide](docs/development/DEVELOPER_GUIDE.md) for complete environment variable reference.

## Testing

```bash
# Backend tests
cd backend
npm test                       # Unit + integration tests
npm run test:coverage          # Coverage report

# Frontend tests
cd frontend
npm test                       # Component tests
npm run test:coverage          # Coverage report

# E2E tests
npm run test:e2e               # Full E2E suite
npm run test:e2e:ui            # Interactive mode
```

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](docs/development/CONTRIBUTING.md) for:
- Code of Conduct
- Development workflow
- Coding standards
- Pull request process

**Quick steps:**
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

### Documentation
- [Complete Documentation Index](docs/README.md)
- [API Reference](docs/development/API_DOCUMENTATION.md)
- [FAQ](docs/development/FAQ.md)

### Community
- **Issues**: [GitHub Issues](https://github.com/yourusername/ecommerce-cod-admin/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/ecommerce-cod-admin/discussions)

---

**Made with ❤️ by the E-Commerce COD Team**

**Star ⭐ this repo if you find it useful!**
