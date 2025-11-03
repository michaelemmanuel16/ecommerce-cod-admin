# Quick Start Guide - E-Commerce COD Admin Dashboard

## 🚀 Get Started in 3 Minutes

### Step 1: Install Dependencies
```bash
cd /Users/mac/Downloads/claude/ecommerce-cod-admin/frontend
npm install
```

### Step 2: Configure Environment
```bash
# Copy environment file
cp .env.example .env

# Default values (edit if needed):
# VITE_API_URL=http://localhost:3000
# VITE_WS_URL=http://localhost:3000
```

### Step 3: Start Development Server
```bash
npm run dev
```

### Step 4: Open in Browser
Navigate to: **http://localhost:5173**

---

## 📋 First Login

1. **Register a new account**:
   - Click "Sign up" on login page
   - Fill in: Name, Email, Password
   - Select Role: Admin
   - Click "Sign Up"

2. **You'll be automatically logged in** and redirected to Dashboard

3. **Explore the features**:
   - Dashboard: View KPIs and charts
   - Orders Kanban: Drag orders between columns
   - Customers: Manage customer database
   - Analytics: View detailed charts

---

## 🎯 Main Features to Test

### 1. Kanban Board (⭐ Primary Feature)
**Route**: `/orders`

- View orders in 8 status columns
- Drag orders to change status
- Search and filter orders
- Real-time updates (when backend is running)

### 2. Dashboard
**Route**: `/`

- Total Orders KPI
- Total Revenue KPI
- Active Orders KPI
- Delivered Today KPI
- Sales Trend Chart
- Order Funnel Chart

### 3. Authentication
**Routes**: `/login`, `/register`

- JWT token management
- Auto token refresh
- Persistent login
- Protected routes

### 4. Real-time Notifications
**Feature**: Notification Bell (top right)

- Order created events
- Order updated events
- Status change notifications
- Unread count badge

---

## 🛠️ Development Commands

```bash
# Start dev server (hot reload)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Type check
npm run type-check

# Lint code
npm run lint
```

---

## 📁 Project Structure Quick Reference

```
frontend/src/
├── components/
│   ├── ui/          # Buttons, Inputs, Cards, etc.
│   ├── layout/      # Sidebar, Header, Layout
│   ├── kanban/      # Kanban Board (main feature)
│   ├── workflow/    # Workflow Builder
│   ├── charts/      # Charts (Recharts)
│   └── common/      # SearchBar, Filters, etc.
├── pages/           # All page components
├── stores/          # Zustand state management
├── services/        # API calls & Socket.io
├── types/           # TypeScript interfaces
└── utils/           # Utility functions
```

---

## 🔗 API Endpoints Expected

Make sure your backend provides these endpoints:

```
POST   /api/auth/login
POST   /api/auth/register
POST   /api/auth/refresh
GET    /api/orders
PUT    /api/orders/:id/status
GET    /api/customers
GET    /api/products
```

---

## 🐛 Troubleshooting

### Issue: Port 5173 already in use
```bash
# Kill process on port 5173
lsof -ti:5173 | xargs kill -9

# Or use different port
npm run dev -- --port 3001
```

### Issue: Module not found errors
```bash
# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
```

### Issue: Vite not starting
```bash
# Clear Vite cache
rm -rf node_modules/.vite
npm run dev
```

---

## 📦 Dependencies Already Configured

All required dependencies are in `package.json`:

**Core**:
- react, react-dom, react-router-dom
- typescript, vite

**State & Forms**:
- zustand, react-hook-form, zod

**UI & Styling**:
- tailwindcss, lucide-react, react-hot-toast

**Drag & Drop**:
- @dnd-kit/core, @dnd-kit/sortable

**Charts**:
- recharts

**Workflow**:
- reactflow

**API & Real-time**:
- axios, socket.io-client

---

## 🎨 UI Components Available

Use these in your pages:

```tsx
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
// ... and 10 more
```

---

## 📊 State Management

Access global state with Zustand:

```tsx
import { useAuthStore } from '@/stores/authStore';
import { useOrdersStore } from '@/stores/ordersStore';

// In component:
const { user, login, logout } = useAuthStore();
const { orders, fetchOrders } = useOrdersStore();
```

---

## 🔔 Real-time Updates

Socket.io automatically connects on login:

```tsx
// Events listened to:
- order_created
- order_updated
- order_status_changed
```

---

## ✅ Ready to Deploy?

### Production Build:
```bash
npm run build
```

### Serve Production:
```bash
npx serve -s dist
```

### Or Deploy to:
- Vercel: `vercel deploy`
- Netlify: `netlify deploy`
- AWS S3 + CloudFront
- Docker: Use provided Dockerfile

---

## 📚 Additional Resources

- **Full Documentation**: See `README.md`
- **Complete Summary**: See `FRONTEND_SUMMARY.md`
- **Tech Stack**: React 18 + TypeScript + Vite + Tailwind
- **UI Library**: Custom components with Tailwind CSS

---

## 🆘 Need Help?

1. Check browser console for errors
2. Check Network tab for API issues
3. Verify backend is running on port 3000
4. Clear browser cache and localStorage
5. Restart dev server

---

## 🎉 That's it!

You now have a fully functional e-commerce COD admin dashboard with:
- ✅ Kanban board with drag-and-drop
- ✅ Real-time notifications
- ✅ Authentication & authorization
- ✅ Charts & analytics
- ✅ Workflow builder
- ✅ And much more!

**Happy coding!** 🚀
