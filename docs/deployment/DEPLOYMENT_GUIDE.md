# Deployment Guide

Complete guide for deploying the E-Commerce COD Admin Dashboard to production.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Pre-Deployment Checklist](#pre-deployment-checklist)
- [Environment Configuration](#environment-configuration)
- [Database Setup](#database-setup)
- [Production Build](#production-build)
- [Docker Deployment](#docker-deployment)
- [Cloud Deployment](#cloud-deployment)
- [Web Server Configuration](#web-server-configuration)
- [SSL/TLS Setup](#ssltls-setup)
- [Monitoring & Logging](#monitoring--logging)
- [Backup Strategy](#backup-strategy)
- [CI/CD Pipeline](#cicd-pipeline)
- [Scaling](#scaling)
- [Troubleshooting](#troubleshooting)

## Prerequisites

Before deploying, ensure you have:

- Node.js 18+ installed on production server
- PostgreSQL 15+ database server
- Domain name configured
- SSL certificate (Let's Encrypt recommended)
- Server with minimum 2GB RAM, 2 CPU cores
- 20GB+ available disk space
- SSH access to production server

**Recommended Server Specifications:**
- **Small**: 2GB RAM, 2 vCPUs, 40GB SSD (up to 1000 orders/day)
- **Medium**: 4GB RAM, 4 vCPUs, 80GB SSD (up to 5000 orders/day)
- **Large**: 8GB RAM, 8 vCPUs, 160GB SSD (10000+ orders/day)

## Pre-Deployment Checklist

### Security Checklist

- Change all default passwords
- Generate strong JWT secret (min 32 characters)
- Configure CORS to allow only your domain
- Enable HTTPS/SSL
- Set secure cookie flags
- Configure rate limiting
- Review and remove debug logs
- Set NODE_ENV to 'production'
- Disable directory listing
- Configure CSP headers

### Code Checklist

- All tests passing
- Code linted and formatted
- No console.log statements (except logger)
- Dependencies updated
- Vulnerability scan completed (npm audit)
- Build succeeds without errors
- Environment variables documented

### Database Checklist

- Database backup created
- Migrations tested
- Database indexes optimized
- Connection pooling configured
- Database credentials secured

### Performance Checklist

- Assets minified
- Images optimized
- Gzip compression enabled
- CDN configured (if applicable)
- Caching strategy implemented

## Environment Configuration

### Backend Environment Variables

Create `.env` file in backend directory. See backend/.env.example for full list.

### Frontend Environment Variables

Create `.env.production` in frontend directory with production API URL.

## Database Setup

### Production Database Configuration

Create production database and configure PostgreSQL for optimal performance.

## Production Build

### Backend Build

```bash
cd backend
npm ci --production
npm run build
```

### Frontend Build

```bash
cd frontend
npm ci
npm run build
```

## Docker Deployment

Use Docker Compose for containerized deployment. See docker-compose.yml in project root.

## Cloud Deployment

### AWS Deployment

Deploy to EC2, RDS, and ElastiCache for scalable infrastructure.

### Google Cloud Platform

Use Google App Engine or GKE for managed deployment.

### Microsoft Azure

Deploy to Azure App Service with managed PostgreSQL.

### Vercel

Deploy frontend to Vercel for instant global CDN.

### Heroku

Simple full-stack deployment with Heroku PostgreSQL addon.

## Web Server Configuration

### Nginx Configuration

Configure Nginx as reverse proxy with SSL termination and static file serving.

## SSL/TLS Setup

### Using Let's Encrypt

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```

## Monitoring & Logging

### Application Monitoring

Use PM2, Winston logger, and Sentry for comprehensive monitoring.

### System Monitoring

Deploy Prometheus and Grafana for system metrics.

## Backup Strategy

### Automated Backups

Implement automated database and file backups with S3 or similar storage.

## CI/CD Pipeline

### GitHub Actions

Automate testing and deployment with GitHub Actions workflows.

## Scaling

### Horizontal Scaling

Use load balancers to distribute traffic across multiple servers.

### Database Scaling

Implement read replicas for improved read performance.

## Troubleshooting

### Common Issues

Check logs, database connections, and server configurations when issues arise.

---

**For more information:**
- [API Documentation](API_DOCUMENTATION.md)
- [Security Guide](SECURITY_GUIDE.md)
- [Developer Guide](DEVELOPER_GUIDE.md)

**Last Updated:** 2025-10-08
