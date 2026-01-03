# DigitalOcean Deployment Guide

Complete step-by-step guide to deploy the E-commerce COD Admin app on DigitalOcean.

**Your Configuration:**
- Droplet IP: `143.110.197.200`
- Domain: `codadminpro.com`
- Server: 1GB RAM, 25GB Disk, Ubuntu 22.04 LTS

---

## Prerequisites

Before starting, ensure you have:
- [x] DigitalOcean droplet created and running
- [x] Domain registered on Cloudflare
- [x] SSH access to your droplet
- [ ] GitHub repository access (to clone code)

---

## Phase 1: Server Setup

### Step 1: Initial Server Access

```bash
# SSH into your droplet as root
ssh root@143.110.197.200
```

### Step 2: Update System

```bash
# Update package lists and upgrade
apt update && apt upgrade -y

# Install essential tools
apt install -y curl git ufw vim
```

### Step 3: Create Non-Root User

```bash
# Create a new user (replace 'deploy' with your preferred username)
adduser deploy

# Add to sudo group
usermod -aG sudo deploy

# Switch to new user
su - deploy
```

### Step 4: Configure Firewall

```bash
# Allow SSH, HTTP, and HTTPS
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable

# Verify status
sudo ufw status
```

### Step 5: Install Docker

```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add your user to docker group
sudo usermod -aG docker ${USER}

# Install Docker Compose
sudo apt install -y docker-compose-plugin

# Verify installation
docker --version
docker compose version
```

**Important:** Log out and back in for docker group changes to take effect.

### Step 6: Install Nginx

```bash
sudo apt install -y nginx
sudo systemctl enable nginx
sudo systemctl start nginx
```

---

## Phase 2: Domain Configuration

### Step 1: Configure Cloudflare DNS

Go to your Cloudflare dashboard:

1. Navigate to **DNS** section
2. Add the following A records:

| Type | Name | Content | Proxy status |
|------|------|---------|--------------|
| A | @ | 143.110.197.200 | Proxied (🟠) |
| A | www | 143.110.197.200 | Proxied (🟠) |

3. Save changes

### Step 2: Cloudflare SSL Settings

1. Go to **SSL/TLS** → **Overview**
2. Set encryption mode to **Full** (or **Full (strict)** if you'll use Let's Encrypt)
3. Enable **Always Use HTTPS** under **Edge Certificates**

**Verify DNS:** Wait 2-5 minutes, then check:
```bash
ping codadminpro.com
# Should return: 143.110.197.200
```

---

## Phase 3: Application Deployment

### Step 1: Clone Repository

```bash
# Navigate to web root
cd /var/www

# Clone your repository
sudo git clone https://github.com/michaelemmanuel16/ecommerce-cod-admin.git
sudo chown -R deploy:deploy ecommerce-cod-admin
cd ecommerce-cod-admin
```

### Step 2: Create Production Environment Files

#### Backend Environment (.env in backend/)

```bash
cd /var/www/ecommerce-cod-admin/backend
nano .env
```

Add the following (update with your secure values):

```env
# Server Configuration
NODE_ENV=production
PORT=3000
FRONTEND_URL=https://codadminpro.com

# Database
DATABASE_URL=postgresql://ecommerce_user:YOUR_SECURE_DB_PASSWORD@postgres:5432/ecommerce_cod

# Redis
REDIS_HOST=redis
REDIS_PORT=6379

# JWT Secrets (generate with: openssl rand -base64 64)
JWT_SECRET=YOUR_SECURE_JWT_SECRET_HERE
JWT_REFRESH_SECRET=YOUR_SECURE_REFRESH_SECRET_HERE

# Admin Credentials (change these!)
ADMIN_EMAIL=admin@codadminpro.com
ADMIN_PASSWORD=YOUR_SECURE_ADMIN_PASSWORD
```

#### Frontend Environment (.env in frontend/)

```bash
cd /var/www/ecommerce-cod-admin/frontend
nano .env
```

```env
VITE_API_URL=https://codadminpro.com/api
VITE_WS_URL=wss://codadminpro.com
```

### Step 3: Create Production Docker Compose File

```bash
cd /var/www/ecommerce-cod-admin
nano docker-compose.prod.yml
```

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15-alpine
    container_name: ecommerce-postgres
    restart: always
    environment:
      POSTGRES_DB: ecommerce_cod
      POSTGRES_USER: ecommerce_user
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ecommerce_user -d ecommerce_cod"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - app_network

  redis:
    image: redis:7-alpine
    container_name: ecommerce-redis
    restart: always
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - app_network

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: ecommerce-backend
    restart: always
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://ecommerce_user:${POSTGRES_PASSWORD}@postgres:5432/ecommerce_cod
      REDIS_HOST: redis
      REDIS_PORT: 6379
    env_file:
      - ./backend/.env
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - app_network

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
      args:
        VITE_API_URL: https://codadminpro.com/api
        VITE_WS_URL: wss://codadminpro.com
    container_name: ecommerce-frontend
    restart: always
    ports:
      - "5173:80"
    depends_on:
      - backend
    networks:
      - app_network

volumes:
  postgres_data:
  redis_data:

networks:
  app_network:
    driver: bridge
```

### Step 4: Create .env for Docker Compose

```bash
nano .env
```

```env
POSTGRES_PASSWORD=YOUR_SECURE_DB_PASSWORD_HERE
```

### Step 5: Build and Start Services

```bash
# Build images (this may take 5-10 minutes)
docker compose -f docker-compose.prod.yml build

# Start all services
docker compose -f docker-compose.prod.yml up -d

# Check status
docker compose -f docker-compose.prod.yml ps

# View logs
docker compose -f docker-compose.prod.yml logs -f backend
```

---

## Phase 4: Nginx Configuration

### Step 1: Create Nginx Configuration

```bash
sudo nano /etc/nginx/sites-available/codadminpro.com
```

```nginx
# Rate limiting
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;
limit_req_zone $binary_remote_addr zone=general_limit:10m rate=30r/s;

# Upstream backends
upstream backend_api {
    server 127.0.0.1:3000;
    keepalive 32;
}

upstream frontend_web {
    server 127.0.0.1:5173;
    keepalive 32;
}

# HTTP to HTTPS redirect
server {
    listen 80;
    listen [::]:80;
    server_name codadminpro.com www.codadminpro.com;

    # Allow Let's Encrypt challenges
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

# HTTPS Server
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name codadminpro.com www.codadminpro.com;

    # SSL certificates (will be added by Certbot)
    # ssl_certificate /etc/letsencrypt/live/codadminpro.com/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/codadminpro.com/privkey.pem;

    # SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1000;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript;

    # Client body size
    client_max_body_size 10M;

    # API endpoints
    location /api/ {
        limit_req zone=api_limit burst=20 nodelay;
        
        proxy_pass http://backend_api;
        proxy_http_version 1.1;
        
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
        
        proxy_buffering off;
        proxy_request_buffering off;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # WebSocket support
    location /socket.io/ {
        proxy_pass http://backend_api;
        proxy_http_version 1.1;
        
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        proxy_buffering off;
        proxy_cache_bypass $http_upgrade;
    }

    # Frontend
    location / {
        limit_req zone=general_limit burst=50 nodelay;
        
        proxy_pass http://frontend_web;
        proxy_http_version 1.1;
        
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
    }

    # Health check endpoint
    location /health {
        access_log off;
        return 200 "healthy\n";
        add_header Content-Type text/plain;
    }
}
```

### Step 2: Enable Site

```bash
# Create symbolic link
sudo ln -s /etc/nginx/sites-available/codadminpro.com /etc/nginx/sites-enabled/

# Remove default site
sudo rm /etc/nginx/sites-enabled/default

# Test configuration
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx
```

### Step 3: Install SSL Certificate

Since you're using Cloudflare, you have two options:

#### Option A: Cloudflare SSL (Easier, Recommended)

1. In Cloudflare dashboard, go to **SSL/TLS** → **Origin Server**
2. Create Origin Certificate
3. Copy certificate and private key
4. Save on server:

```bash
sudo mkdir -p /etc/ssl/cloudflare
sudo nano /etc/ssl/cloudflare/cert.pem
# Paste certificate, save and exit

sudo nano /etc/ssl/cloudflare/key.pem
# Paste private key, save and exit

sudo chmod 600 /etc/ssl/cloudflare/key.pem
```

5. Update Nginx config SSL paths:
```nginx
ssl_certificate /etc/ssl/cloudflare/cert.pem;
ssl_certificate_key /etc/ssl/cloudflare/key.pem;
```

6. Reload Nginx:
```bash
sudo nginx -t
sudo systemctl reload nginx
```

#### Option B: Let's Encrypt (Alternative)

```bash
# Install Certbot
sudo apt install -y certbot python3-certbot-nginx

# Get certificate
sudo certbot --nginx -d codadminpro.com -d www.codadminpro.com

# Follow prompts
# Certbot will automatically configure Nginx

# Test auto-renewal
sudo certbot renew --dry-run
```

---

## Phase 5: Production Hardening

### Step 1: Set Up Log Rotation

```bash
sudo nano /etc/logrotate.d/docker-containers
```

```
/var/lib/docker/containers/*/*.log {
    rotate 7
    daily
    compress
    missingok
    delaycompress
    copytruncate
}
```

### Step 2: Configure Docker Auto-Restart

Already configured via `restart: always` in docker-compose.prod.yml

### Step 3: Set Up Database Backups

```bash
# Create backup directory
sudo mkdir -p /backups/postgres
sudo chown deploy:deploy /backups/postgres

# Create backup script
nano ~/backup-db.sh
```

```bash
#!/bin/bash
BACKUP_DIR="/backups/postgres"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/backup_$TIMESTAMP.sql.gz"

# Run backup
docker exec ecommerce-postgres pg_dump -U ecommerce_user ecommerce_cod | gzip > $BACKUP_FILE

# Keep only last 7 days
find $BACKUP_DIR -name "backup_*.sql.gz" -mtime +7 -delete

echo "Backup completed: $BACKUP_FILE"
```

```bash
chmod +x ~/backup-db.sh

# Add to crontab (daily at 2 AM)
crontab -e
```

Add line:
```
0 2 * * * /home/deploy/backup-db.sh >> /var/log/db-backup.log 2>&1
```

### Step 4: Monitor Services

```bash
# Check all containers
docker compose -f docker-compose.prod.yml ps

# View logs
docker compose -f docker-compose.prod.yml logs -f

# Check specific service
docker compose -f docker-compose.prod.yml logs backend

# Check Nginx
sudo systemctl status nginx

# Check Nginx error logs
sudo tail -f /var/log/nginx/error.log
```

---

## Verification Checklist

Run through these checks to ensure everything is working:

### DNS & SSL
- [ ] `ping codadminpro.com` returns `143.110.197.200`
- [ ] Visit `http://codadminpro.com` → redirects to HTTPS
- [ ] SSL certificate is valid (green padlock in browser)
- [ ] No mixed content warnings

### Application
- [ ] Frontend loads at `https://codadminpro.com`
- [ ] Can log in with admin credentials
- [ ] API requests work (check browser Network tab)
- [ ] WebSocket connection establishes
- [ ] All features functional

### Services
```bash
# All containers running
docker compose -f docker-compose.prod.yml ps

# Check database
docker exec -it ecommerce-postgres psql -U ecommerce_user -d ecommerce_cod -c "SELECT COUNT(*) FROM users;"

# Check Redis
docker exec -it ecommerce-redis redis-cli ping
# Should return: PONG
```

### Performance
- [ ] Page load time < 3 seconds
- [ ] API response time < 500ms
- [ ] No console errors in browser

---

## Troubleshooting

### Container won't start
```bash
# View logs
docker compose -f docker-compose.prod.yml logs service_name

# Rebuild specific service
docker compose -f docker-compose.prod.yml up -d --build service_name
```

### Database connection errors
```bash
# Check if PostgreSQL is running
docker exec -it ecommerce-postgres pg_isready -U ecommerce_user

# Verify DATABASE_URL in backend .env matches postgres service
```

### Nginx 502 Bad Gateway
```bash
# Check if backend is running
curl -I http://localhost:3000/health

# Check Nginx error log
sudo tail -f /var/log/nginx/error.log

# Verify upstream is correct
sudo nginx -t
```

### SSL certificate issues
```bash
# Check certificate validity
openssl s_client -connect codadminpro.com:443 -servername codadminpro.com

# If using Cloudflare, ensure SSL mode is "Full" not "Flexible"
```

---

## Maintenance Commands

```bash
# Update application
cd /var/www/ecommerce-cod-admin
git pull
docker compose -f docker-compose.prod.yml up -d --build

# Restart all services
docker compose -f docker-compose.prod.yml restart

# View resource usage
docker stats

# Clean up old images
docker system prune -a

# Backup database manually
./backup-db.sh

# Restore from backup
gunzip < /backups/postgres/backup_TIMESTAMP.sql.gz | \
  docker exec -i ecommerce-postgres psql -U ecommerce_user ecommerce_cod
```

---

## Security Best Practices

1. **Change default passwords** in all `.env` files
2. **Use strong JWT secrets** (64+ characters)
3. **Enable Cloudflare WAF** for DDoS protection
4. **Keep system updated**: `sudo apt update && sudo apt upgrade`
5. **Monitor logs** regularly for suspicious activity
6. **Backup database** daily (automated via cron)
7. **Use SSH keys** instead of password authentication
8. **Enable 2FA** on Cloudflare and DigitalOcean accounts

---

## Next Steps

Once deployed:
1. Test all features thoroughly
2. Set up monitoring (Uptime Robot, Pingdom, etc.)
3. Configure Cloudflare Page Rules for caching
4. Set up email notifications for server issues
5. Document any custom configurations
6. Share access credentials securely with your team

---

## Support

If you encounter issues:
1. Check logs: `docker compose logs -f`
2. Review [deployment troubleshooting](./DEPLOYMENT_GUIDE.md#troubleshooting)
3. Verify all environment variables are set correctly
4. Ensure firewall allows required ports (80, 443, 22)

**Server Requirements Met:** ✅
- Minimum 1GB RAM ✅ (your droplet: 1GB)
- Ubuntu 22.04 LTS ✅
- Docker support ✅
