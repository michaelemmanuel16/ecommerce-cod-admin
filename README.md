# E-Commerce COD Admin Dashboard

> A comprehensive order management system with Kanban workflow automation, webhook integration, and multi-user support for Cash on Delivery (COD) e-commerce operations.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue)](https://www.typescriptlang.org/)

## Overview

The E-Commerce COD Admin Dashboard is a modern, full-stack TypeScript application designed to streamline the management of Cash on Delivery orders. It provides a visual Kanban board interface, automated order processing, webhook integrations with popular e-commerce platforms, and comprehensive analytics.

**Key Capabilities:**
- 🤖 Automated order processing with custom workflows
- 🔗 Webhook integration
- 👥 Multi-user with role-based access control
- 📱 Real-time updates via Socket.io
- 📈 Comprehensive analytics and reporting
- 📝 Public checkout form builder
- 🚚 Delivery tracking and agent management

## Quick Start

### Prerequisites
- Docker & Docker Compose

### Installation

```bash
git clone https://github.com/yourusername/ecommerce-cod-admin.git
cd ecommerce-cod-admin
./scripts/start-dev.sh
```

Access at http://localhost:5173

For manual setup without Docker, see [Getting Started Guide](docs/guides/GETTING_STARTED.md).

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

## Features

Order management • Workflow automation • Customer & product management • Multi-user roles • Analytics & reporting • Public checkout forms

See [User Guide](docs/guides/USER_GUIDE.md) for detailed feature documentation.

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

**Backend:**
```bash
cd backend
npm run dev              # Start server (port 3000)
npm test                 # Run tests
```

**Frontend:**
```bash
cd frontend
npm run dev              # Start dev server (port 5173)
npm test                 # Run tests
```

See [Developer Guide](docs/development/DEVELOPER_GUIDE.md) for complete development documentation.


## Deployment

**Docker:**
```bash
docker-compose -f docker-compose.prod.yml up -d
```

See [Deployment Guide](docs/deployment/DEPLOYMENT_GUIDE.md) for production setup, SSL, monitoring, and backups.



## Contributing

See [CONTRIBUTING.md](docs/development/CONTRIBUTING.md) for guidelines.

Quick: Fork → Branch → Commit → Push → PR

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
