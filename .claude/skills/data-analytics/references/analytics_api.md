# Analytics API Reference

Backend analytics endpoints and data structures for the E-Commerce COD Admin Dashboard.

## Existing Analytics Service

Location: `backend/src/services/analyticsService.ts`

### Available Methods

#### 1. Get Dashboard Metrics
```typescript
async getDashboardMetrics()
```

**Returns:**
```typescript
{
  totalOrders: number;
  todayOrders: number;
  pendingOrders: number;
  deliveredOrders: number;
  totalRevenue: number;
  todayRevenue: number;
  activeAgents: number;
  avgDeliveryTime: number; // in minutes
}
```

#### 2. Get Sales Trends
```typescript
async getSalesTrends(period: 'daily' | 'weekly' | 'monthly', limit?: number)
```

**Returns:** Array of time series data
```typescript
[
  {
    date: string;  // ISO date
    sales: number;
    orders: number;
  }
]
```

#### 3. Get Customer Rep Performance
```typescript
async getRepPerformance(startDate?: Date, endDate?: Date)
```

**Returns:**
```typescript
[
  {
    repId: number;
    repName: string;
    totalOrders: number;
    deliveredOrders: number;
    conversionRate: number;  // percentage
    totalRevenue: number;
    commission: number;
  }
]
```

#### 4. Get Delivery Agent Performance
```typescript
async getAgentPerformance(startDate?: Date, endDate?: Date)
```

**Returns:**
```typescript
[
  {
    agentId: number;
    agentName: string;
    totalDeliveries: number;
    successfulDeliveries: number;
    successRate: number;  // percentage
    avgDeliveryTime: number;  // minutes
    earnings: number;
  }
]
```

## API Endpoints

### Analytics Routes
Base path: `/api/analytics`

#### GET /api/analytics/dashboard
Get dashboard metrics
- **Auth:** Required
- **Response:** Dashboard metrics object

#### GET /api/analytics/trends
Get sales trends
- **Auth:** Required
- **Query params:**
  - `period`: 'daily' | 'weekly' | 'monthly'
  - `limit`: number (optional, default: 30)
- **Response:** Array of trend data

#### GET /api/analytics/reps
Get sales rep performance
- **Auth:** Required (admin, manager)
- **Query params:**
  - `startDate`: ISO date string (optional)
  - `endDate`: ISO date string (optional)
- **Response:** Array of rep performance

#### GET /api/analytics/agents
Get delivery agent performance
- **Auth:** Required (admin, manager)
- **Query params:**
  - `startDate`: ISO date string (optional)
  - `endDate`: ISO date string (optional)
- **Response:** Array of agent performance

## Database Schema (Relevant Models)

### Order
```prisma
model Order {
  id              Int          @id @default(autoincrement())
  orderNumber     String       @unique
  status          OrderStatus
  totalAmount     Float
  customerName    String
  phoneNumber     String
  shippingAddress String
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt

  // Relations
  customerRepId   Int?
  deliveryAgentId Int?
  items           OrderItem[]
  delivery        Delivery?
}
```

### Delivery
```prisma
model Delivery {
  id                  Int       @id @default(autoincrement())
  orderId             Int       @unique
  agentId             Int
  scheduledTime       DateTime?
  actualDeliveryTime  DateTime?
  status              String
  notes               String?
  createdAt           DateTime  @default(now())

  // Relations
  order               Order     @relation(fields: [orderId], references: [id])
  agent               User      @relation(fields: [agentId], references: [id])
}
```

### User (Reps & Agents)
```prisma
model User {
  id              Int      @id @default(autoincrement())
  email           String   @unique
  firstName       String
  lastName        String
  role            UserRole
  commissionRate  Float?   @default(0)
  deliveryRate    Float?   @default(0)
  totalEarnings   Float?   @default(0)
  isActive        Boolean  @default(true)
  isAvailable     Boolean  @default(true)
}
```

## Creating Custom Analytics Queries

### Pattern for New Analytics
```typescript
// In analyticsService.ts
async getCustomMetric(filters: FilterObject) {
  const results = await prisma.order.findMany({
    where: {
      // Apply filters
      createdAt: {
        gte: filters.startDate,
        lte: filters.endDate
      },
      status: filters.status
    },
    select: {
      // Select only needed fields
      totalAmount: true,
      status: true,
      createdAt: true
    }
  });

  // Transform and aggregate data
  return results;
}
```

### Adding New Endpoint
```typescript
// In analyticsRoutes.ts
router.get('/custom-metric', authenticate, authorize(['admin', 'manager']),
  async (req, res) => {
    try {
      const data = await analyticsService.getCustomMetric(req.query);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch metric' });
    }
  }
);
```

## Frontend Integration

### Using Analytics Store
Location: `frontend/src/stores/analyticsStore.ts`

```typescript
import { useAnalyticsStore } from '../stores/analyticsStore';

function MyComponent() {
  const {
    metrics,
    trends,
    isLoading,
    fetchDashboardMetrics,
    fetchSalesTrends
  } = useAnalyticsStore();

  useEffect(() => {
    fetchDashboardMetrics();
    fetchSalesTrends('daily', 30);
  }, []);

  return (
    <div>
      {isLoading ? <Skeleton /> : <Chart data={trends} />}
    </div>
  );
}
```

### Direct API Calls
Location: `frontend/src/services/analytics.service.ts`

```typescript
import { analyticsService } from '../services/analytics.service';

// Fetch custom data
const customData = await analyticsService.getCustomMetric({
  startDate: '2024-01-01',
  endDate: '2024-12-31'
});
```

## Common Aggregations

### Group by Date
```typescript
// Daily aggregation
const daily = await prisma.$queryRaw`
  SELECT
    DATE(created_at) as date,
    COUNT(*) as orders,
    SUM(total_amount) as revenue
  FROM orders
  WHERE created_at >= ${startDate}
  GROUP BY DATE(created_at)
  ORDER BY date
`;
```

### Calculate Percentages
```typescript
const totalOrders = await prisma.order.count();
const statusCounts = await prisma.order.groupBy({
  by: ['status'],
  _count: true
});

const percentages = statusCounts.map(item => ({
  status: item.status,
  count: item._count,
  percentage: (item._count / totalOrders * 100).toFixed(2)
}));
```

### Moving Averages
```typescript
function calculateMovingAverage(data: number[], window: number) {
  return data.map((_, index, array) => {
    const start = Math.max(0, index - window + 1);
    const subset = array.slice(start, index + 1);
    return subset.reduce((a, b) => a + b, 0) / subset.length;
  });
}
```

## Performance Tips

1. **Use indexes** - Ensure queries use indexed fields (see `DATABASE_OPTIMIZATION_SUMMARY.md`)
2. **Select only needed fields** - Don't fetch entire models
3. **Cache results** - Use Redis for frequently accessed metrics
4. **Aggregate in database** - Use SQL aggregations instead of JS
5. **Limit date ranges** - Add default date range limits

## Real-Time Updates

Subscribe to Socket.io events for live data:
```typescript
import { socket } from '../services/socket';

socket.on('order:created', (order) => {
  // Update metrics
  fetchDashboardMetrics();
});

socket.on('order:status_changed', (order) => {
  // Update trends
  fetchSalesTrends('daily', 7);
});
```
