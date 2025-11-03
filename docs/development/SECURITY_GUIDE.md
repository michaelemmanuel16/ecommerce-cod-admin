# Security Guide

Comprehensive security best practices for the E-Commerce COD Admin Dashboard.

## Table of Contents

- [Overview](#overview)
- [Authentication & Authorization](#authentication--authorization)
- [Data Protection](#data-protection)
- [API Security](#api-security)
- [Database Security](#database-security)
- [Frontend Security](#frontend-security)
- [Network Security](#network-security)
- [Secrets Management](#secrets-management)
- [Security Headers](#security-headers)
- [Rate Limiting](#rate-limiting)
- [Input Validation](#input-validation)
- [Session Management](#session-management)
- [Logging & Monitoring](#logging--monitoring)
- [Compliance](#compliance)
- [Security Checklist](#security-checklist)

## Overview

Security is a critical aspect of any e-commerce application handling customer data and financial information. This guide outlines best practices implemented in the system and recommendations for maintaining security.

### Security Principles

1. **Defense in Depth**: Multiple layers of security
2. **Least Privilege**: Minimal necessary permissions
3. **Fail Secure**: Secure defaults and failure modes
4. **Complete Mediation**: Check every access
5. **Zero Trust**: Never trust, always verify

## Authentication & Authorization

### JWT Authentication

**Token Generation:**

```typescript
import jwt from 'jsonwebtoken';
import { User } from '@prisma/client';

export function generateToken(user: User) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role
    },
    process.env.JWT_SECRET!,
    {
      expiresIn: '7d',
      issuer: 'ecommerce-cod-admin',
      audience: 'api'
    }
  );
}
```

**Token Verification:**

```typescript
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: { message: 'Authentication required' }
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      error: { message: 'Invalid token' }
    });
  }
}
```

### Role-Based Access Control (RBAC)

```typescript
type Role = 'ADMIN' | 'MANAGER' | 'AGENT';

export function authorize(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: { message: 'Authentication required' }
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: { message: 'Insufficient permissions' }
      });
    }

    next();
  };
}

// Usage
router.delete('/orders/:id', authenticate, authorize('ADMIN'), deleteOrder);
```

### Password Security

**Password Hashing:**

```typescript
import bcrypt from 'bcrypt';

export async function hashPassword(password: string): Promise<string> {
  const saltRounds = 12;
  return await bcrypt.hash(password, saltRounds);
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return await bcrypt.compare(password, hash);
}
```

**Password Requirements:**
- Minimum 8 characters
- At least one uppercase letter
- At least one lowercase letter
- At least one number
- At least one special character

```typescript
export function validatePassword(password: string): boolean {
  const regex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
  return regex.test(password);
}
```

## Data Protection

### Encryption at Rest

**Database Encryption:**
- Enable PostgreSQL encryption
- Use encrypted file systems
- Encrypt database backups

### Encryption in Transit

**HTTPS/TLS:**
- Use TLS 1.2 or higher
- Strong cipher suites only
- Regular certificate rotation

**Example Nginx SSL Configuration:**

```nginx
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256';
ssl_prefer_server_ciphers on;
ssl_session_cache shared:SSL:10m;
ssl_session_timeout 10m;
```

### Sensitive Data Handling

**PII (Personally Identifiable Information):**
- Encrypt credit card numbers (if stored)
- Hash/mask sensitive data in logs
- Implement data retention policies
- Secure data disposal

```typescript
// Example: Mask sensitive data in logs
export function maskEmail(email: string): string {
  const [name, domain] = email.split('@');
  return `${name.substring(0, 2)}***@${domain}`;
}

export function maskPhone(phone: string): string {
  return phone.replace(/\d(?=\d{4})/g, '*');
}
```

## API Security

### Rate Limiting

```typescript
import rateLimit from 'express-rate-limit';

// General API rate limit
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per window
  message: 'Too many requests from this IP',
  standardHeaders: true,
  legacyHeaders: false
});

// Strict limit for auth endpoints
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5, // 5 attempts per 15 minutes
  skipSuccessfulRequests: true
});

// Usage
app.use('/api/', apiLimiter);
app.use('/api/auth/login', authLimiter);
```

### CORS Configuration

```typescript
import cors from 'cors';

const corsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [];
    
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
```

### Request Validation

```typescript
import { z } from 'zod';

// Schema validation
const createOrderSchema = z.object({
  customerId: z.string().uuid(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().positive().int()
  })),
  shippingAddress: z.object({
    street: z.string().min(1),
    city: z.string().min(1),
    zipCode: z.string().regex(/^\d{5}$/)
  })
});

// Validation middleware
export function validate(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            details: error.errors
          }
        });
      }
      next(error);
    }
  };
}
```

## Database Security

### SQL Injection Prevention

**Use Prisma ORM:**
```typescript
// Prisma automatically protects against SQL injection
const user = await prisma.user.findUnique({
  where: { email: userInput } // Safe - parameterized
});

// NEVER do this:
// const user = await prisma.$queryRaw`SELECT * FROM users WHERE email = '${userInput}'`;
```

### Database Access Control

- Use separate database users with limited privileges
- Never use root/admin for application
- Grant only necessary permissions
- Use connection pooling

```sql
-- Create limited user
CREATE USER app_user WITH PASSWORD 'secure_password';

-- Grant specific permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON orders TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON customers TO app_user;

-- Revoke dangerous permissions
REVOKE CREATE ON DATABASE ecommerce_cod FROM app_user;
```

### Database Backups

- Encrypt backups
- Store in secure location
- Test restore procedures
- Implement retention policies

## Frontend Security

### XSS Prevention

**Content Security Policy:**

```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self';
  script-src 'self' 'unsafe-inline' 'unsafe-eval';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: https:;
  font-src 'self' data:;
  connect-src 'self' https://api.yourdomain.com;
">
```

**Sanitize User Input:**

```typescript
import DOMPurify from 'dompurify';

function SafeHTML({ html }: { html: string }) {
  const sanitized = DOMPurify.sanitize(html);
  return <div dangerouslySetInnerHTML={{ __html: sanitized }} />;
}
```

### CSRF Protection

```typescript
// Backend: Generate CSRF token
import crypto from 'crypto';

export function generateCSRFToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

// Frontend: Include in requests
axios.post('/api/orders', data, {
  headers: {
    'X-CSRF-Token': csrfToken
  }
});
```

### Local Storage Security

```typescript
// Never store sensitive data in localStorage
// Use httpOnly cookies for tokens (if possible)

// If using localStorage, encrypt sensitive data
import CryptoJS from 'crypto-js';

function setSecureItem(key: string, value: any) {
  const encrypted = CryptoJS.AES.encrypt(
    JSON.stringify(value),
    'encryption-key'
  ).toString();
  localStorage.setItem(key, encrypted);
}

function getSecureItem(key: string) {
  const encrypted = localStorage.getItem(key);
  if (!encrypted) return null;
  
  const decrypted = CryptoJS.AES.decrypt(encrypted, 'encryption-key');
  return JSON.parse(decrypted.toString(CryptoJS.enc.Utf8));
}
```

## Network Security

### Firewall Configuration

```bash
# UFW (Ubuntu)
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable
```

### DDoS Protection

- Use CDN (CloudFlare, AWS CloudFront)
- Implement rate limiting
- Monitor traffic patterns
- Use reverse proxy

## Secrets Management

### Environment Variables

```bash
# Never commit .env files
# Use strong, unique secrets

# Generate strong JWT secret
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# Example .env
JWT_SECRET=your_64_character_random_string_here
DATABASE_URL=postgresql://user:password@localhost:5432/db
```

### Secrets in Production

**AWS Secrets Manager:**

```typescript
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

async function getSecret(secretName: string) {
  const client = new SecretsManagerClient({ region: 'us-east-1' });
  const command = new GetSecretValueCommand({ SecretId: secretName });
  const data = await client.send(command);
  return JSON.parse(data.SecretString!);
}
```

## Security Headers

```typescript
import helmet from 'helmet';

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:']
    }
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  frameguard: { action: 'deny' },
  noSniff: true,
  xssFilter: true
}));
```

## Rate Limiting

Implement multiple levels of rate limiting:

**IP-based:**
```typescript
const ipLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  keyGenerator: (req) => req.ip
});
```

**User-based:**
```typescript
const userLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  keyGenerator: (req) => req.user?.id || req.ip
});
```

**Endpoint-specific:**
```typescript
app.post('/api/auth/login', authLimiter);
app.post('/api/orders', createOrderLimiter);
```

## Input Validation

### Server-Side Validation

**Always validate on server:**

```typescript
// Validate UUID
function isValidUUID(id: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}

// Validate email
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Sanitize strings
function sanitizeString(input: string): string {
  return input
    .trim()
    .replace(/[<>]/g, '') // Remove potential HTML tags
    .substring(0, 1000); // Limit length
}
```

## Session Management

### Token Refresh Strategy

```typescript
export function generateRefreshToken(userId: string): string {
  return jwt.sign(
    { userId, type: 'refresh' },
    process.env.JWT_REFRESH_SECRET!,
    { expiresIn: '30d' }
  );
}

// Refresh endpoint
app.post('/api/auth/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  
  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET!);
    const user = await prisma.user.findUnique({ 
      where: { id: decoded.userId } 
    });
    
    const newToken = generateToken(user);
    const newRefreshToken = generateRefreshToken(user.id);
    
    res.json({ token: newToken, refreshToken: newRefreshToken });
  } catch (error) {
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});
```

## Logging & Monitoring

### Security Event Logging

```typescript
import winston from 'winston';

const securityLogger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ 
      filename: 'logs/security.log',
      level: 'warn'
    })
  ]
});

// Log security events
function logSecurityEvent(event: string, details: any) {
  securityLogger.warn(event, {
    timestamp: new Date().toISOString(),
    ...details
  });
}

// Usage
logSecurityEvent('FAILED_LOGIN_ATTEMPT', {
  email: email,
  ip: req.ip,
  userAgent: req.headers['user-agent']
});
```

### Monitoring

- Failed login attempts
- Unusual API usage patterns
- Privilege escalation attempts
- Data access violations
- Error rates and types

## Compliance

### GDPR Compliance

- User data export functionality
- Right to deletion
- Consent management
- Data processing agreements
- Privacy policy

### PCI DSS (if handling cards)

- Never store full credit card numbers
- Use payment gateway (Stripe, PayPal)
- Maintain secure network
- Regular security testing

## Security Checklist

### Development

- [ ] All dependencies up to date
- [ ] No known vulnerabilities (npm audit)
- [ ] Secrets in environment variables
- [ ] Input validation on all endpoints
- [ ] Output encoding to prevent XSS
- [ ] CSRF protection enabled
- [ ] SQL injection prevention (ORM)
- [ ] Authentication on protected routes
- [ ] Authorization checks implemented
- [ ] Secure password hashing
- [ ] Error messages don't leak info

### Deployment

- [ ] HTTPS/TLS enabled
- [ ] Strong SSL configuration
- [ ] Security headers configured
- [ ] Rate limiting enabled
- [ ] CORS properly configured
- [ ] Firewall rules set
- [ ] Database access restricted
- [ ] Backups encrypted
- [ ] Monitoring and alerting
- [ ] Incident response plan

### Maintenance

- [ ] Regular security updates
- [ ] Log review and analysis
- [ ] Access control audits
- [ ] Penetration testing
- [ ] Security training for team
- [ ] Backup testing
- [ ] Disaster recovery drills

---

**For more information:**
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [API Security Best Practices](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html)
- [Node.js Security Checklist](https://blog.risingstack.com/node-js-security-checklist/)

**Last Updated:** 2025-10-08
