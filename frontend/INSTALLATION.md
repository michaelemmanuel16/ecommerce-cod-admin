# Installation & Setup Guide

## Quick Start

```bash
# Navigate to frontend directory
cd /Users/mac/Downloads/claude/ecommerce-cod-admin/frontend

# Install all dependencies
npm install

# Start development server (runs on http://localhost:5173)
npm run dev
```

## Installation Steps

### 1. Install Dependencies

The project requires Node.js 18+ and npm 9+.

```bash
npm install
```

This will install all required dependencies including:
- React 18.3.1
- TypeScript 5.2.2
- Vite 5.3.4
- Tailwind CSS 3.4.6
- Zustand 5.0.0-rc.2
- React Router 6.26.0
- @dnd-kit (drag-and-drop)
- React Flow 11.11.4
- Socket.io Client 4.7.5
- Recharts 2.12.7
- And many more...

### 2. Environment Configuration

Create a `.env` file in the frontend root:

```bash
cp .env.example .env
```

Edit `.env` with your backend URLs:

```env
VITE_API_URL=http://localhost:3000
VITE_SOCKET_URL=http://localhost:3000
```

### 3. Start Development Server

```bash
npm run dev
```

The app will open at http://localhost:5173

### 4. Build for Production

```bash
npm run build
```

This creates an optimized production build in the `dist/` folder.

### 5. Preview Production Build

```bash
npm run preview
```

## Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm run preview` - Preview production build locally
- `npm run lint` - Run ESLint

## Project Files Created

### Total: 83+ Files

#### Configuration (9 files)
- package.json
- tsconfig.json
- tsconfig.node.json
- vite.config.ts
- tailwind.config.js
- postcss.config.js
- .eslintrc.cjs
- .env
- .env.example

#### Core (4 files)
- src/main.tsx
- src/App.tsx
- src/index.css
- src/vite-env.d.ts

#### Types & Utils (2 files)
- src/types/index.ts
- src/utils/cn.ts

#### Services (5 files)
- src/services/api.ts
- src/services/auth.service.ts
- src/services/orders.service.ts
- src/services/customers.service.ts
- src/services/socket.ts

#### Stores (6 files)
- src/stores/authStore.ts
- src/stores/ordersStore.ts
- src/stores/customersStore.ts
- src/stores/productsStore.ts
- src/stores/notificationsStore.ts
- src/stores/workflowStore.ts

#### UI Components (15 files)
- Button, Input, Card, Badge, Modal
- Select, Dropdown, Loading, EmptyState
- Table, Pagination, Tabs, Toast, Tooltip, Avatar

#### Layout (4 files)
- Layout, Sidebar, Header, MobileNav

#### Kanban (3 files)
- KanbanBoard, KanbanColumn, OrderCard

#### Workflow (5 files)
- WorkflowBuilder, TriggerNode, ActionNode
- ConditionNode, NodeConfig

#### Charts (4 files)
- SalesTrendChart, OrderFunnelChart
- RevenueChart, PerformanceChart

#### Common (5 files)
- SearchBar, FilterPanel, StatCard
- NotificationBell, UserMenu

#### Pages (17 files)
- Login, Register, Dashboard
- OrdersKanban, OrdersList, OrderDetails
- Products, ProductForm
- Customers, CustomerDetails
- DeliveryAgents, CustomerReps
- Financial, Analytics
- Workflows, WorkflowEditor
- Settings

## Features Verification

### ✅ Authentication System
- Login page with form validation
- Register page with role selection
- JWT token management
- Auto token refresh
- Protected routes

### ✅ Kanban Board (CRITICAL)
- 8 status columns
- Drag-and-drop with @dnd-kit
- Real-time updates via Socket.io
- Color-coded priorities
- Filter integration

### ✅ Workflow Builder
- Visual editor with React Flow
- 4 node types (Trigger, Action, Condition, Delay)
- Drag nodes from palette
- Connect with edges
- Save/load JSON

### ✅ Dashboard
- 4 KPI cards with trends
- 3 charts (Sales, Funnel, Revenue)
- Recent orders widget
- Low stock alerts

### ✅ Real-time Features
- Socket.io integration
- Live order updates
- Notification bell
- Toast notifications

### ✅ State Management
- 6 Zustand stores
- Persistent auth state
- Optimistic updates
- Error handling

### ✅ UI Components
- 15 reusable components
- Consistent styling
- Responsive design
- Accessible

## Troubleshooting

### Port Already in Use
If port 5173 is busy:
```bash
# Kill process on port 5173
lsof -ti:5173 | xargs kill -9

# Or use different port
npm run dev -- --port 3001
```

### Dependencies Installation Issues
```bash
# Clear npm cache
npm cache clean --force

# Delete node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
```

### Build Errors
```bash
# Check TypeScript errors
npx tsc --noEmit

# Clear Vite cache
rm -rf node_modules/.vite
npm run dev
```

## Browser Compatibility

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

## Development Tips

1. Use React DevTools browser extension
2. Install Tailwind CSS IntelliSense VSCode extension
3. Enable TypeScript strict mode
4. Use ESLint for code quality

## Next Steps

1. Connect to backend API (update VITE_API_URL)
2. Test all features
3. Customize branding
4. Add more features
5. Deploy to production

## Support

For issues or questions, check:
- README.md
- PROJECT_SUMMARY.md
- Component documentation in code

---

Happy coding!
