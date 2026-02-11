# Admin User Bootstrap Guide

## Overview

The bootstrap mechanism ensures that a fresh database deployment can create an initial admin user securely without hardcoded credentials.

## How It Works

1. **Automatic Check**: During deployment, `docker-entrypoint.sh` automatically runs the bootstrap script after migrations
2. **Smart Detection**: The script checks if any users exist in the database
3. **One-Time Only**: If users exist, the script exits immediately
4. **Flexible Input**: Supports both environment variables and interactive input

## Deployment Methods

### Method 1: Environment Variables (Recommended for Production)

Set these environment variables before deployment:

```bash
# Required
BOOTSTRAP_ADMIN_EMAIL=admin@company.com
BOOTSTRAP_ADMIN_PASSWORD=SecurePassword123!

# Optional (with defaults)
BOOTSTRAP_ADMIN_FIRST_NAME=Admin
BOOTSTRAP_ADMIN_LAST_NAME=User
BOOTSTRAP_ADMIN_PHONE=+1234567890
```

**Example Docker Compose:**

```yaml
services:
  backend:
    environment:
      - BOOTSTRAP_ADMIN_EMAIL=admin@mycompany.com
      - BOOTSTRAP_ADMIN_PASSWORD=${ADMIN_PASSWORD}
      - BOOTSTRAP_ADMIN_FIRST_NAME=Super
      - BOOTSTRAP_ADMIN_LAST_NAME=Admin
```

### Method 2: Interactive Mode (Development)

For local development, run the bootstrap script manually:

```bash
cd backend
npm run bootstrap
```

You'll be prompted for:
- Email address
- Password (minimum 8 characters)
- First name (optional, default: "Admin")
- Last name (optional, default: "User")
- Phone number (optional, default: "+1234567890")

### Method 3: Manual Database Entry (Emergency)

If the bootstrap script fails, you can manually create a user via Prisma Studio:

```bash
cd backend
npx prisma studio
```

Then create a user with:
- Role: `super_admin`
- Password: Use `bcrypt` to hash (rounds: 10)
- isActive: `true`
- isAvailable: `true`

## Security Features

### ✅ No Hardcoded Credentials
- No default passwords in code
- Environment variables required for automated deployment
- Interactive prompts for development

### ✅ Validation
- Email format validation
- Password minimum length (8 characters)
- Required field checks

### ✅ Safe Execution
- Only runs on empty database
- Exits gracefully if users exist
- Proper error handling and logging

### ✅ One-Time Operation
- Automatically skips on subsequent deployments
- No risk of overwriting existing users
- No persistent credentials in scripts

## Deployment Scenarios

### Fresh Production Deployment

1. Set environment variables in your deployment platform:
   ```bash
   BOOTSTRAP_ADMIN_EMAIL=admin@company.com
   BOOTSTRAP_ADMIN_PASSWORD=<strong-password>
   ```

2. Deploy the application
3. The bootstrap script runs automatically after migrations
4. Admin user is created
5. Sign in with the credentials

### Staging/Development

1. Deploy without environment variables
2. The bootstrap script detects no credentials
3. Run manually: `npm run bootstrap`
4. Enter credentials interactively
5. Admin user is created

### Database Already Has Users

1. Bootstrap script checks user count
2. Finds existing users
3. Exits immediately with success message
4. No changes made to database

## Troubleshooting

### "No admin credentials provided"

**Problem:** Non-interactive environment (Docker) without environment variables

**Solution:** Set `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` environment variables

### "Invalid admin details"

**Problem:** Validation failed (short password, invalid email, etc.)

**Solution:** Check that:
- Email contains `@`
- Password is at least 8 characters
- Required fields are not empty

### "Database already has users"

**Status:** Normal behavior, not an error

**Explanation:** The database already contains users, so bootstrap is skipped

### Bootstrap Script Hangs

**Problem:** Script waiting for interactive input in non-TTY environment

**Solution:** Ensure environment variables are set, or run in interactive terminal

## Password Security Best Practices

### For Production:
1. Use a password manager to generate strong passwords (20+ characters)
2. Store `BOOTSTRAP_ADMIN_PASSWORD` in your secrets management system (AWS Secrets Manager, HashiCorp Vault, etc.)
3. Rotate the password immediately after first deployment
4. Never commit passwords to version control

### Recommended Password Strength:
- Minimum: 8 characters (enforced)
- Recommended: 16+ characters
- Include: uppercase, lowercase, numbers, symbols
- Avoid: dictionary words, personal information, common patterns

## Examples

### Docker Compose Production
```yaml
services:
  backend:
    image: ecommerce-cod-admin-backend:latest
    environment:
      - BOOTSTRAP_ADMIN_EMAIL=admin@mycompany.com
      - BOOTSTRAP_ADMIN_PASSWORD_FILE=/run/secrets/admin_password
    secrets:
      - admin_password

secrets:
  admin_password:
    external: true
```

### Kubernetes Secret
```yaml
apiVersion: v1
kind: Secret
metadata:
  name: admin-bootstrap
type: Opaque
stringData:
  email: admin@mycompany.com
  password: "SecurePassword123!"
---
apiVersion: apps/v1
kind: Deployment
spec:
  template:
    spec:
      containers:
      - name: backend
        env:
        - name: BOOTSTRAP_ADMIN_EMAIL
          valueFrom:
            secretKeyRef:
              name: admin-bootstrap
              key: email
        - name: BOOTSTRAP_ADMIN_PASSWORD
          valueFrom:
            secretKeyRef:
              name: admin-bootstrap
              key: password
```

## After Bootstrap

Once the admin user is created:

1. **Sign In**: Use the bootstrap credentials to sign in
2. **Change Password**: Immediately change the password via the UI
3. **Create Other Users**: Create additional users as needed
4. **Remove Bootstrap Vars**: Optionally remove bootstrap environment variables (they're ignored on subsequent runs)

## Files

- `backend/scripts/bootstrap-admin.ts` - Bootstrap script
- `backend/docker-entrypoint.sh` - Runs bootstrap during deployment
- `backend/package.json` - Contains `bootstrap` npm script
