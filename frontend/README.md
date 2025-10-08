# E-Commerce COD Admin Dashboard - Frontend

A modern, feature-rich React + TypeScript admin dashboard for managing Cash-on-Delivery (COD) e-commerce operations.

## Features

### Core Features
- **Authentication**: Login/Register with JWT token management and auto-refresh
- **Real-time Updates**: Socket.io integration for live order notifications
- **Kanban Board**: Drag-and-drop order management with 8 status columns
- **Dashboard**: KPI cards, charts, and analytics
- **Order Management**: Comprehensive order tracking and status updates
- **Customer Management**: Customer database and order history
- **Product Management**: Product catalog with CRUD operations
- **Workflow Builder**: Visual workflow automation with React Flow
- **Analytics**: Multiple chart types (Line, Bar, Area, Radar)
- **Notifications**: Real-time toast notifications and notification center

### Technical Stack
- **React 18** with TypeScript
- **Vite** for fast development
- **Tailwind CSS** for styling
- **React Router** for navigation
- **Zustand** for state management
- **React Hook Form + Zod** for forms and validation
- **@dnd-kit** for drag-and-drop Kanban
- **React Flow** for workflow builder
- **Recharts** for data visualization
- **Socket.io Client** for real-time features
- **Axios** for API calls with interceptors
- **Lucide React** for icons

## Project Structure

```
frontend/src/
├── components/
│   ├── ui/              # Reusable UI components (15 files)
│   │   ├── Button.tsx
│   │   ├── Input.tsx
│   │   ├── Card.tsx
│   │   ├── Badge.tsx
│   │   ├── Modal.tsx
│   │   ├── Select.tsx
│   │   ├── Dropdown.tsx
│   │   ├── Loading.tsx
│   │   ├── EmptyState.tsx
│   │   ├── Table.tsx
│   │   ├── Pagination.tsx
│   │   ├── Tabs.tsx
│   │   ├── Toast.tsx
│   │   ├── Tooltip.tsx
│   │   └── Avatar.tsx
│   ├── layout/          # Layout components (4 files)
│   │   ├── Layout.tsx
│   │   ├── Sidebar.tsx
│   │   ├── Header.tsx
│   │   └── MobileNav.tsx
│   ├── kanban/          # Kanban board (3 files)
│   │   ├── KanbanBoard.tsx
│   │   ├── KanbanColumn.tsx
│   │   └── OrderCard.tsx
│   ├── workflow/        # Workflow builder (5 files)
│   │   ├── WorkflowBuilder.tsx
│   │   ├── TriggerNode.tsx
│   │   ├── ActionNode.tsx
│   │   ├── ConditionNode.tsx
│   │   └── NodeConfig.tsx
│   ├── charts/          # Chart components (4 files)
│   │   ├── SalesTrendChart.tsx
│   │   ├── OrderFunnelChart.tsx
│   │   ├── RevenueChart.tsx
│   │   └── PerformanceChart.tsx
│   └── common/          # Common components (5 files)
│       ├── SearchBar.tsx
│       ├── FilterPanel.tsx
│       ├── StatCard.tsx
│       ├── NotificationBell.tsx
│       └── UserMenu.tsx
├── pages/               # Page components (17 files)
│   ├── Login.tsx
│   ├── Register.tsx
│   ├── Dashboard.tsx
│   ├── OrdersKanban.tsx
│   ├── OrdersList.tsx
│   ├── OrderDetails.tsx
│   ├── Products.tsx
│   ├── ProductForm.tsx
│   ├── Customers.tsx
│   ├── CustomerDetails.tsx
│   ├── DeliveryAgents.tsx
│   ├── CustomerReps.tsx
│   ├── Financial.tsx
│   ├── Analytics.tsx
│   ├── Workflows.tsx
│   ├── WorkflowEditor.tsx
│   └── Settings.tsx
├── stores/              # Zustand stores (6 files)
│   ├── authStore.ts
│   ├── ordersStore.ts
│   ├── customersStore.ts
│   ├── productsStore.ts
│   ├── notificationsStore.ts
│   └── workflowStore.ts
├── services/            # API services (5 files)
│   ├── api.ts
│   ├── auth.service.ts
│   ├── orders.service.ts
│   ├── customers.service.ts
│   └── socket.ts
├── types/               # TypeScript types (1 file)
│   └── index.ts
├── utils/               # Utility functions (2 files)
│   ├── cn.ts
│   └── api.ts
├── App.tsx              # Main app with routing
├── main.tsx             # React entry point
└── vite-env.d.ts        # Vite TypeScript types

Total: 80+ files created
```

## Setup Instructions

### Prerequisites
- Node.js 18+ and npm/yarn
- Backend API running on http://localhost:3000

### Installation

1. Install dependencies:
```bash
cd frontend
npm install
```

2. Configure environment variables:
```bash
cp .env.example .env
```

Edit `.env` if needed:
```env
VITE_API_URL=http://localhost:3000
VITE_WS_URL=http://localhost:3000
```

3. Start development server:
```bash
npm run dev
```

The app will be available at http://localhost:5173

### Build for Production

```bash
npm run build
```

The production build will be in the `dist/` directory.

### Preview Production Build

```bash
npm run preview
```

## Key Features Implementation

### 1. Kanban Board
- **Location**: `/Users/mac/Downloads/claude/ecommerce-cod-admin/frontend/src/components/kanban/KanbanBoard.tsx`
- **Features**:
  - 8 status columns (new_orders → delivered/returned)
  - Drag-and-drop with @dnd-kit
  - Optimistic updates
  - Real-time sync via Socket.io
  - Search and filters

### 2. Authentication
- **Location**: `/Users/mac/Downloads/claude/ecommerce-cod-admin/frontend/src/stores/authStore.ts`
- **Features**:
  - JWT token management
  - Auto token refresh on 401
  - Persistent login (localStorage)
  - Protected routes
  - Socket.io connection on login

### 3. Real-time Notifications
- **Location**: `/Users/mac/Downloads/claude/ecommerce-cod-admin/frontend/src/services/socket.ts`
- **Features**:
  - Socket.io integration
  - Order created/updated events
  - Toast notifications
  - Notification center with unread count

### 4. Workflow Builder
- **Location**: `/Users/mac/Downloads/claude/ecommerce-cod-admin/frontend/src/components/workflow/WorkflowBuilder.tsx`
- **Features**:
  - Visual workflow editor with React Flow
  - Trigger, Action, Condition nodes
  - Drag-and-drop node placement
  - Node configuration panel

### 5. Charts & Analytics
- **Location**: `/Users/mac/Downloads/claude/ecommerce-cod-admin/frontend/src/components/charts/`
- **Types**:
  - Line charts (Sales trends)
  - Bar charts (Order funnel)
  - Area charts (Revenue)
  - Radar charts (Performance)

## API Integration

All API calls go through Axios interceptors that:
1. Add JWT token to headers
2. Handle 401 errors by refreshing token
3. Show error toasts automatically
4. Retry failed requests after token refresh

**Base URL**: `http://localhost:3000`

**Endpoints Used**:
- `POST /api/auth/login`
- `POST /api/auth/register`
- `POST /api/auth/logout`
- `POST /api/auth/refresh`
- `GET /api/orders`
- `PUT /api/orders/:id/status`
- `GET /api/customers`
- `GET /api/workflows`

## State Management

Using Zustand for global state:

```typescript
// Example: Orders Store
const { orders, fetchOrders, updateOrderStatus } = useOrdersStore();
```

**Stores**:
- `authStore` - User, tokens, login/logout
- `ordersStore` - Orders, filters, CRUD
- `customersStore` - Customer data
- `productsStore` - Product catalog
- `notificationsStore` - Notifications
- `workflowStore` - Workflow builder state

## Form Validation

Using React Hook Form + Zod:

```typescript
const schema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

const { register, handleSubmit, formState: { errors } } = useForm({
  resolver: zodResolver(schema),
});
```

## Styling

- **Tailwind CSS** for utility-first styling
- **Custom components** with consistent design system
- **Responsive** design with mobile support
- **Dark mode** ready (can be enabled)

## Next Steps

1. **Start the backend**:
   - Ensure backend API is running on port 3000
   - Database migrations are complete
   - Socket.io server is configured

2. **Run the frontend**:
   ```bash
   npm run dev
   ```

3. **Test the features**:
   - Register a new admin user
   - Login and explore the dashboard
   - Create orders and drag them on Kanban
   - Check real-time notifications
   - Build workflows

4. **Production deployment**:
   ```bash
   npm run build
   serve -s dist
   ```

## Troubleshooting

**Issue**: Socket.io not connecting
- Check VITE_WS_URL in .env
- Ensure backend Socket.io server is running
- Check browser console for errors

**Issue**: API calls failing
- Verify VITE_API_URL in .env
- Check if backend is running
- Inspect Network tab for CORS issues

**Issue**: Drag-and-drop not working
- Clear browser cache
- Check for console errors
- Ensure @dnd-kit dependencies are installed

## License

MIT

## Support

For issues or questions, please contact the development team.
