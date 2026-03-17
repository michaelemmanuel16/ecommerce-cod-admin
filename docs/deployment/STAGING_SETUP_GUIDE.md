# Staging Environment Setup Guide

Complete guide to set up **staging.codadminpro.com** for testing changes before deploying to production.

## Overview

```
feature/xyz → develop (staging) → main (production)
     ↓             ↓                    ↓
Local tests   Auto-deploy         Auto-deploy
            staging.codadminpro.com   codadminpro.com
```

---

## Step 1: Configure Cloudflare DNS

### 1.1 Login to Cloudflare

Go to [Cloudflare Dashboard](https://dash.cloudflare.com) and select your domain `codadminpro.com`.

### 1.2 Add DNS Record

Navigate to **DNS** → **Records** → **Add record**

Configure the A record:
- **Type:** `A`
- **Name:** `staging` (will create staging.codadminpro.com)
- **IPv4 address:** `143.110.197.200` (your production server IP)
- **Proxy status:** ✅ **Proxied** (orange cloud icon)
- **TTL:** Auto

Click **Save**.

### 1.3 Verify DNS Propagation

Wait 2-5 minutes, then verify:

```bash
nslookup staging.codadminpro.com
```

Should show Cloudflare IPs (104.21.x.x or 172.67.x.x).

---

## Step 2: Configure Server

### 2.1 SSH into Your Server

```bash
ssh root@143.110.197.200
```

### 2.2 Configure Nginx for Staging Subdomain

Create nginx configuration for staging:

```bash
cat > /etc/nginx/sites-available/staging.codadminpro.com << 'EOF'
# HTTP - Redirect to HTTPS
server {
    listen 80;
    server_name staging.codadminpro.com;
    return 301 https://$server_name$request_uri;
}

# HTTPS - Staging Application
server {
    listen 443 ssl http2;
    server_name staging.codadminpro.com;

    # SSL certificates (Cloudflare handles SSL, but these are for origin)
    ssl_certificate /etc/ssl/certs/ssl-cert-snakeoil.pem;
    ssl_certificate_key /etc/ssl/private/ssl-cert-snakeoil.key;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Frontend (React app)
    location / {
        proxy_pass http://localhost:5174;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Backend API
    location /api {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket (Socket.io)
    location /socket.io {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # Health check endpoint
    location /health {
        proxy_pass http://localhost:5174/health;
        access_log off;
    }
}
EOF
```

### 2.3 Enable Site and Test Nginx

```bash
# Create symbolic link to enable the site
ln -s /etc/nginx/sites-available/staging.codadminpro.com /etc/nginx/sites-enabled/

# Test nginx configuration
nginx -t

# If test passes, reload nginx
systemctl reload nginx

# Verify nginx is running
systemctl status nginx
```

### 2.4 Update Port Mappings in docker-compose.staging.yml

The staging containers will run on different ports:
- **Backend:** Internal 3000, exposed as 3001 (vs production 3000)
- **Frontend:** Internal 8080, exposed as 5174 (vs production 80)

This is already configured in `docker-compose.staging.yml`.

---

## Step 3: Configure GitHub Secrets

### 3.1 Go to GitHub Repository Settings

Navigate to: **Your Repo** → **Settings** → **Secrets and variables** → **Actions**

### 3.2 Add New Secrets

Click **New repository secret** for each:

| Secret Name | Value | Description |
|------------|-------|-------------|
| `STAGING_HOST` | `143.110.197.200` | Staging server IP address |
| `STAGING_PATH` | `/root/ecommerce-cod-admin` | Deployment directory on server |

**Note:** These secrets should already exist (verify they're set):
- `DEPLOY_USER` - SSH username (usually `root`)
- `DEPLOY_SSH_KEY` - SSH private key for server access
- `DEPLOY_HOST` - Production server (143.110.197.200)
- `DEPLOY_PATH` - Production path (/root/ecommerce-cod-admin)

---

## Step 4: Create and Push Develop Branch

### 4.1 Create Local Develop Branch

```bash
# From main branch
git checkout main
git pull origin main

# Create develop branch
git checkout -b develop

# Push to GitHub
git push -u origin develop
```

### 4.2 Set Develop as Default Branch for PRs (Optional)

On GitHub: **Settings** → **Branches** → **Default branch** → Change to `develop`

This makes `develop` the default target for new PRs.

---

## Step 5: Configure Branch Protection Rules

### 5.1 Protect Main Branch

Go to: **Settings** → **Branches** → **Add branch protection rule**

**For `main` branch:**
- Branch name pattern: `main`
- ✅ Require a pull request before merging
  - ✅ Require approvals: 1
- ✅ Require status checks to pass before merging
  - ✅ Require branches to be up to date before merging
  - Add status checks: `lint`, `test`, `build`
- ✅ Require conversation resolution before merging
- ❌ Allow force pushes: **Disabled**
- ❌ Allow deletions: **Disabled**

### 5.2 Protect Develop Branch

**For `develop` branch:**
- Branch name pattern: `develop`
- ✅ Require status checks to pass before merging
  - Add status checks: `lint`, `test`
- ✅ Allow force pushes: **Enable** (for emergency hotfixes)

---

## Step 6: Test the Workflow

### 6.1 Create a Test Feature

```bash
# Ensure you're on develop
git checkout develop
git pull origin develop

# Create feature branch
git checkout -b feature/test-staging-deployment

# Make a small change (example: add a comment)
echo "// Testing staging deployment" >> backend/src/server.ts

# Commit and push
git add .
git commit -m "test: Verify staging deployment workflow"
git push -u origin feature/test-staging-deployment
```

### 6.2 Create Pull Request

1. Go to GitHub → **Pull requests** → **New pull request**
2. Set:
   - **Base:** `develop`
   - **Compare:** `feature/test-staging-deployment`
3. Create and merge the PR

### 6.3 Watch Auto-Deployment

1. Go to **Actions** tab in GitHub
2. Watch the workflow run:
   - ✅ Lint tests
   - ✅ Unit tests
   - ✅ Build Docker images
   - ✅ Deploy to staging

### 6.4 Verify Staging Deployment

```bash
# Check if staging is accessible
curl https://staging.codadminpro.com

# Or visit in browser:
# https://staging.codadminpro.com
```

---

## Step 7: Daily Development Workflow

### 7.1 Feature Development

```bash
# Always branch from develop
git checkout develop
git pull origin develop
git checkout -b feature/your-feature-name

# Make changes, test locally
npm run dev  # Test in local environment

# Commit and push
git add .
git commit -m "feat: Your feature description"
git push -u origin feature/your-feature-name
```

### 7.2 Create PR to Develop

1. Create PR: `feature/your-feature-name` → `develop`
2. CI runs automatically (lint, test, build)
3. Request code review
4. Merge PR

### 7.3 Auto-Deploy to Staging

- ✅ PR merge to `develop` triggers automatic deployment to staging
- ✅ Access staging at: https://staging.codadminpro.com
- ✅ Test your changes thoroughly

### 7.4 Promote to Production

```bash
# After testing in staging, create PR: develop → main
```

1. Create PR: `develop` → `main`
2. Review all changes since last production deployment
3. Merge PR
4. Automatically deploys to production: https://codadminpro.com

---

## Step 8: Monitoring and Logs

### View Staging Logs

```bash
# SSH to server
ssh root@143.110.197.200

# View all staging containers
docker-compose -f docker-compose.staging.yml ps

# View backend logs
docker-compose -f docker-compose.staging.yml logs -f backend-staging

# View frontend logs
docker-compose -f docker-compose.staging.yml logs -f frontend-staging

# View nginx logs
docker-compose -f docker-compose.staging.yml logs -f nginx-staging

# View all logs
docker-compose -f docker-compose.staging.yml logs -f
```

### Manual Staging Deployment

```bash
# SSH to server
ssh root@143.110.197.200
cd /root/ecommerce-cod-admin

# Pull latest develop branch
git fetch origin
git checkout develop
git pull origin develop

# Run deployment script
./scripts/deploy-staging.sh
```

### Restart Staging

```bash
# SSH to server
ssh root@143.110.197.200
cd /root/ecommerce-cod-admin

# Restart staging containers
docker-compose -f docker-compose.staging.yml restart

# Or completely rebuild
docker-compose -f docker-compose.staging.yml down
docker-compose -f docker-compose.staging.yml up -d
```

---

## Troubleshooting

### Issue: DNS not resolving

```bash
# Check DNS propagation
nslookup staging.codadminpro.com

# Clear DNS cache (Mac)
sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder

# Clear DNS cache (Linux)
sudo systemd-resolve --flush-caches
```

### Issue: 502 Bad Gateway

```bash
# Check if staging containers are running
docker-compose -f docker-compose.staging.yml ps

# Check nginx logs
tail -f /var/log/nginx/error.log

# Restart nginx
systemctl restart nginx
```

### Issue: Port conflicts

```bash
# Check what's using port 8080
lsof -i :8080

# Check what's using port 3001
lsof -i :3001

# Kill process if needed
kill -9 <PID>
```

### Issue: Database connection errors

```bash
# Check postgres container
docker logs ecommerce-cod-postgres-staging

# Connect to postgres
docker exec -it ecommerce-cod-postgres-staging psql -U ecommerce_user -d ecommerce_cod_staging

# Run migrations manually
docker-compose -f docker-compose.staging.yml exec backend-staging npx prisma migrate deploy
```

---

## File Summary

Files created/modified for staging setup:

```
✅ .env.staging                           # Staging environment variables
✅ docker-compose.staging.yml             # Staging Docker configuration
✅ scripts/deploy-staging.sh              # Staging deployment script
✅ .github/workflows/backend-ci.yml       # Updated with staging deployment
✅ .github/workflows/frontend-ci.yml      # Updated with staging deployment
✅ STAGING_SETUP_GUIDE.md                 # This guide
```

---

## Quick Reference

### Environments

| Environment | Branch | URL | Auto-Deploy |
|------------|--------|-----|-------------|
| **Local** | any | http://localhost:5173 | No |
| **Staging** | develop | https://staging.codadminpro.com | Yes |
| **Production** | main | https://codadminpro.com | Yes |

### Ports

| Service | Production | Staging |
|---------|-----------|---------|
| Frontend/Nginx | 80, 443 | 8080, 8443 |
| Backend API | 3000 | 3001 |
| PostgreSQL | 5432 (internal) | 5432 (internal) |
| Redis | 6379 (internal) | 6379 (internal) |

### Key Commands

```bash
# Local development
npm run dev

# Deploy staging (manual)
ssh root@143.110.197.200
cd /root/ecommerce-cod-admin
./scripts/deploy-staging.sh

# View staging logs
docker-compose -f docker-compose.staging.yml logs -f

# Restart staging
docker-compose -f docker-compose.staging.yml restart
```

---

## Next Steps

1. ✅ Complete Cloudflare DNS setup (Step 1)
2. ✅ Configure server nginx (Step 2)
3. ✅ Add GitHub secrets (Step 3)
4. ✅ Create develop branch (Step 4)
5. ✅ Set up branch protection (Step 5)
6. ✅ Test the workflow (Step 6)
7. 🚀 Start using develop → staging → production workflow!

---

**Need Help?** Check the Troubleshooting section or review GitHub Actions logs.
