# Automated Deployment Setup Guide

Complete guide to set up automated deployment to production whenever you push to the `main` branch.

## Overview

This setup enables:
- ✅ **Automatic deployment** on push to main branch
- ✅ **Fast deployment** (~30-60 seconds using pre-built images)
- ✅ **Database backups** before each deployment
- ✅ **Health checks** to prevent bad deployments
- ✅ **Auto-rollback** if health checks fail
- ✅ **Slack notifications** for deployment status
- ✅ **Zero downtime** rolling updates

---

## Prerequisites

Before starting, ensure you have:
- Access to your DigitalOcean server (root@143.110.197.200)
- GitHub repository admin access
- Slack workspace for notifications (optional)

---

## Step 1: Generate SSH Key for GitHub Actions

On your **local machine**, run:

```bash
# Generate SSH key pair
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/github_deploy_key -N ""

# Copy public key to server
ssh-copy-id -i ~/.ssh/github_deploy_key.pub root@143.110.197.200

# Test SSH connection
ssh -i ~/.ssh/github_deploy_key root@143.110.197.200 "echo 'SSH connection successful!'"
```

**Expected output:** "SSH connection successful!"

**Save the private key** (you'll need it in Step 2):
```bash
cat ~/.ssh/github_deploy_key
```

Copy the entire output (including `-----BEGIN OPENSSH PRIVATE KEY-----` and `-----END OPENSSH PRIVATE KEY-----`)

---

## Step 2: Add GitHub Secrets

1. Go to your GitHub repository: https://github.com/michaelemmanuel16/ecommerce-cod-admin

2. Navigate to **Settings** → **Secrets and variables** → **Actions**

3. Click **New repository secret** and add the following secrets:

| Secret Name | Value | Description |
|-------------|-------|-------------|
| `DEPLOY_SSH_KEY` | Private key from Step 1 | Full SSH private key content |
| `DEPLOY_HOST` | `143.110.197.200` | Server IP address |
| `DEPLOY_USER` | `root` | SSH username |
| `DEPLOY_PATH` | `/root/ecommerce-cod-admin` | App directory on server |
| `SLACK_WEBHOOK_URL` | Your Slack webhook URL | For deployment notifications |

### Getting Slack Webhook URL

1. Go to https://api.slack.com/messaging/webhooks
2. Click **Create your Slack app**
3. Choose **From scratch**
4. Name: "Deployment Notifications", Workspace: Your workspace
5. Click **Incoming Webhooks** → **Activate Incoming Webhooks**
6. Click **Add New Webhook to Workspace**
7. Choose channel (e.g., #deployments)
8. Copy the webhook URL (starts with `https://hooks.slack.com/services/...`)

---

## Step 3: Configure Server to Pull from GHCR

SSH to your production server and configure Docker to pull images from GitHub Container Registry:

```bash
# SSH to server
ssh root@143.110.197.200

# Create GitHub Personal Access Token (PAT)
# 1. Go to https://github.com/settings/tokens/new
# 2. Token name: "GHCR Pull Token"
# 3. Expiration: No expiration (or 1 year)
# 4. Select scope: read:packages
# 5. Click "Generate token"
# 6. COPY THE TOKEN (you won't see it again!)

# Login to GitHub Container Registry
# When prompted for password, paste your PAT
docker login ghcr.io -u michaelemmanuel16

# Test image pull
docker pull ghcr.io/michaelemmanuel16/ecommerce-cod-admin/backend:main
```

**Expected output:** Image should download successfully

---

## Step 4: Update Production Files

Still on the **production server**, update the deployment files:

```bash
# Navigate to app directory
cd /root/ecommerce-cod-admin

# Pull latest changes (includes new deployment script and updated docker-compose.prod.yml)
git pull origin main

# Make deployment script executable
chmod +x scripts/deploy-github-actions.sh

# Verify files are updated
ls -la scripts/deploy-github-actions.sh
cat docker-compose.prod.yml | grep "ghcr.io"
```

**Expected:**
- deploy-github-actions.sh should exist and be executable
- docker-compose.prod.yml should reference GHCR images

---

## Step 5: Test Deployment Script

Before enabling automation, test the deployment script manually:

```bash
# Still on production server
cd /root/ecommerce-cod-admin

# Run deployment script
bash scripts/deploy-github-actions.sh
```

**Expected output:**
```
╔═══════════════════════════════════════════════════════════════╗
║   E-Commerce COD Admin - Automated Deployment                ║
╚═══════════════════════════════════════════════════════════════╝

Deployment started at: ...

[1/7] Running pre-deployment checks...
✓ Pre-deployment checks passed

[2/7] Creating database backup...
✓ Database backup completed

[3/7] Storing current state for rollback...
✓ Current state saved

[4/7] Pulling new Docker images from GHCR...
✓ Images pulled successfully

[5/7] Updating containers (rolling restart)...
Updating backend service...
✓ Backend container updated
Updating frontend service...
✓ Frontend container updated

[6/7] Running health checks...
✓ Backend is healthy
✓ Frontend is healthy

[7/7] Cleaning up old images...
✓ Old images cleaned up

╔═══════════════════════════════════════════════════════════════╗
║   Deployment completed successfully!                          ║
╚═══════════════════════════════════════════════════════════════╝

Container Status:
...
```

If successful, exit the server:
```bash
exit
```

---

## Step 6: Test End-to-End Automated Deployment

Now test the full automated workflow:

1. **Make a small change** to trigger deployment:
   ```bash
   # On your local machine
   cd /Users/mac/Downloads/claude/ecommerce-cod-admin

   # Make a small change
   echo "# Automated deployment enabled" >> README.md

   # Commit and push
   git add .
   git commit -m "test: Enable automated deployment"
   git push origin main
   ```

2. **Watch GitHub Actions**:
   - Go to https://github.com/michaelemmanuel16/ecommerce-cod-admin/actions
   - You should see two workflows running:
     - "Backend CI/CD"
     - "Frontend CI/CD"
   - Click on them to see progress

3. **Wait for deployment**:
   - Backend: Lint → Test → Build → Deploy
   - Frontend: Lint → Test → Build → Deploy
   - Total time: ~3-5 minutes

4. **Check Slack**:
   - You should receive notifications in your Slack channel
   - One for backend deployment
   - One for frontend deployment

5. **Verify production**:
   ```bash
   # Check if site is still working
   curl https://codadminpro.com/health
   ```

---

## Troubleshooting

### Deployment fails with "Permission denied (publickey)"

**Cause:** GitHub Actions can't SSH to server

**Solution:**
1. Verify `DEPLOY_SSH_KEY` secret contains the full private key
2. Test SSH manually:
   ```bash
   ssh -i ~/.ssh/github_deploy_key root@143.110.197.200
   ```
3. Ensure public key is in `/root/.ssh/authorized_keys` on server

---

### Deployment fails at "Pulling new Docker images"

**Cause:** Server can't authenticate with GHCR

**Solution:**
1. SSH to server: `ssh root@143.110.197.200`
2. Check Docker login: `docker login ghcr.io -u michaelemmanuel16`
3. Test pull: `docker pull ghcr.io/michaelemmanuel16/ecommerce-cod-admin/backend:main`
4. Verify PAT has `read:packages` scope

---

### Health checks fail after deployment

**Cause:** Service didn't start correctly

**Solution:**
1. SSH to server
2. Check container logs:
   ```bash
   cd /root/ecommerce-cod-admin
   docker-compose -f docker-compose.prod.yml logs backend
   docker-compose -f docker-compose.prod.yml logs frontend
   ```
3. Check container status:
   ```bash
   docker-compose -f docker-compose.prod.yml ps
   ```
4. Manual rollback if needed:
   ```bash
   # Restart with previous images
   docker-compose -f docker-compose.prod.yml down
   docker-compose -f docker-compose.prod.yml up -d
   ```

---

### Slack notifications not working

**Cause:** Invalid webhook URL or permissions

**Solution:**
1. Verify `SLACK_WEBHOOK_URL` secret is correct
2. Test webhook manually:
   ```bash
   curl -X POST -H 'Content-type: application/json' \
     --data '{"text":"Test notification"}' \
     YOUR_WEBHOOK_URL
   ```
3. Check Slack app permissions
4. Try recreating the webhook

---

## Manual Rollback

If you need to rollback a deployment:

### Option 1: Rollback to Previous Commit

```bash
# On your local machine
cd /Users/mac/Downloads/claude/ecommerce-cod-admin

# Find previous commit
git log --oneline -5

# Revert to previous commit
git revert HEAD --no-edit

# Push (this will trigger deployment of reverted state)
git push origin main
```

### Option 2: Rollback on Server (Quick)

```bash
# SSH to server
ssh root@143.110.197.200
cd /root/ecommerce-cod-admin

# View available image tags
docker images | grep ghcr.io/michaelemmanuel16/ecommerce-cod-admin

# Edit docker-compose.prod.yml to use specific SHA tag
# Example: Change from :main to :main-abc123def
nano docker-compose.prod.yml

# Restart containers
docker-compose -f docker-compose.prod.yml up -d
```

---

## Monitoring Deployments

### View Deployment History

**GitHub:**
- https://github.com/michaelemmanuel16/ecommerce-cod-admin/actions
- Shows all workflow runs with status

**Slack:**
- Check your #deployments channel for notifications

**Server:**
```bash
# SSH to server
ssh root@143.110.197.200

# View deployment logs
cat /var/log/deployment.log  # If you set up logging

# View container uptime
docker-compose -f /root/ecommerce-cod-admin/docker-compose.prod.yml ps

# View recent database backups
ls -lth /root/ecommerce-cod-admin/backups/
```

---

## Deployment Workflow Summary

```
┌─────────────────────────────────────────────────────────┐
│  1. Developer pushes to main branch                     │
└─────────────────┬───────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────┐
│  2. GitHub Actions: Lint & Test                         │
│     - Backend tests                                     │
│     - Frontend tests                                    │
└─────────────────┬───────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────┐
│  3. Build Docker Images                                 │
│     - Backend image                                     │
│     - Frontend image                                    │
└─────────────────┬───────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────┐
│  4. Push to GHCR                                        │
│     - Tag: main (latest)                                │
│     - Tag: main-<SHA> (specific commit)                 │
└─────────────────┬───────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────┐
│  5. Deploy to Production (via SSH)                      │
│     - Backup database                                   │
│     - Pull new images                                   │
│     - Update containers (rolling restart)               │
│     - Run health checks                                 │
│     - Rollback if failed                                │
└─────────────────┬───────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────┐
│  6. Send Slack Notification                             │
│     - Deployment status (success/failure)               │
│     - Commit details                                    │
│     - Author information                                │
└─────────────────────────────────────────────────────────┘
```

**Total Time:** 3-5 minutes from push to deployed

---

## Next Steps

After setup is complete:

1. ✅ **Test thoroughly** - Make several test commits to ensure automation works
2. ✅ **Monitor first few deployments** - Watch logs and Slack notifications
3. ✅ **Set up monitoring** - Consider adding Uptime Robot or similar for health monitoring
4. ✅ **Document your process** - Update team documentation with this workflow
5. ✅ **Train team members** - Ensure everyone knows how automated deployment works

---

## Security Best Practices

✅ **SSH key authentication** - No passwords exposed
✅ **Least-privilege access** - Deploy key only has necessary permissions
✅ **Secrets in GitHub Secrets** - Encrypted at rest
✅ **Database backups** - Before every deployment
✅ **Health checks** - Prevent bad deployments
✅ **GHCR authentication** - Private images protected

---

## Support

If you encounter issues:

1. **Check logs:**
   - GitHub Actions: https://github.com/michaelemmanuel16/ecommerce-cod-admin/actions
   - Server: `ssh root@143.110.197.200 "docker-compose -f /root/ecommerce-cod-admin/docker-compose.prod.yml logs"`

2. **Review plan:**
   - Deployment plan: `/Users/mac/.claude/plans/hashed-coalescing-eich.md`

3. **Common fixes:**
   - Regenerate SSH key
   - Recreate GitHub secrets
   - Re-login to GHCR on server
   - Check network connectivity

---

## Success Checklist

- [ ] SSH key generated and added to server
- [ ] All 5 GitHub Secrets configured
- [ ] Server can pull from GHCR (tested manually)
- [ ] docker-compose.prod.yml updated to use GHCR images
- [ ] Deployment script tested manually on server
- [ ] End-to-end automated deployment tested
- [ ] Slack notifications working
- [ ] Production site still accessible and working

**Once all checked:** Your automated deployment is ready! 🎉

---

**Last Updated:** 2026-01-03
