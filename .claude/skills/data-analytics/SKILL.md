---
name: data-analytics
description: Create data-driven dashboards and visualizations with custom charts, statistical analysis, and business intelligence insights. Use when building analytics dashboards, KPI tracking, data visualizations, forecasting, or any task requiring data transformation and chart creation with Recharts.
---

# Data Analytics & Visualization

Build beautiful, insightful dashboards with custom charts, statistical analysis, and business intelligence for e-commerce operations.

## Overview

This skill provides comprehensive tools and workflows for creating data-driven dashboards that transform raw business data into actionable insights. Use this skill when building analytics features, KPI dashboards, performance reports, or any visualization that helps stakeholders understand business metrics.

**Core Capabilities:**
- Data transformation and aggregation (time series, grouping, pivoting)
- Statistical analysis (trends, forecasting, outlier detection)
- Custom chart creation with Recharts (line, bar, area, pie, composed)
- Business KPI calculations (conversion rates, growth, CLV, etc.)
- Dashboard template and component library

## When to Use This Skill

Invoke this skill when the task involves:
- Creating new analytics dashboards or KPI pages
- Building custom charts and visualizations
- Transforming or aggregating data for analysis
- Calculating business metrics and KPIs
- Forecasting trends or detecting patterns
- Extending existing analytics features

**Example requests:**
- "Create a sales performance dashboard with revenue trends"
- "Build a delivery agent efficiency report with charts"
- "Calculate customer lifetime value and show cohort analysis"
- "Forecast next month's revenue based on historical data"
- "Create a rep leaderboard with commission tracking"

## Analytics Development Workflow

Follow this workflow for building analytics features from scratch:

### Step 1: Define Requirements
Identify what metrics and insights are needed:
- Which KPIs to track? (revenue, conversion rate, delivery time, etc.)
- What time period? (daily, weekly, monthly, custom range)
- Who is the audience? (admin, manager, sales rep, etc.)
- What decisions will this data inform?

### Step 2: Source the Data
Determine where data comes from:

**Option A: Use Existing Analytics API**
- Check `references/analytics_api.md` for available endpoints
- Backend service: `backend/src/services/analyticsService.ts`
- Frontend store: `frontend/src/stores/analyticsStore.ts`
- Socket.io for real-time updates

**Option B: Create New Analytics Query**
- Write Prisma query in `analyticsService.ts`
- Add endpoint in `analyticsRoutes.ts`
- Create frontend service method
- Add store action if needed

**Example:**
```typescript
// In analyticsService.ts
async getCustomerRetention(months: number) {
  // Query database for cohort analysis
  const cohorts = await prisma.$queryRaw`...`;
  return transformCohortData(cohorts);
}
```

### Step 3: Transform Data
Use scripts or TypeScript functions to prepare data for visualization:

**Script-Based (for complex transformations):**
```bash
# Aggregate sales by day
python scripts/data_transformer.py aggregate \
  --input sales.json \
  --output daily_sales.json \
  --group-by date \
  --sum totalAmount

# Calculate moving average
python scripts/data_transformer.py calculate \
  --input daily_sales.json \
  --output trends.json \
  --metric moving_average \
  --value-field totalAmount \
  --window 7
```

**TypeScript-Based (in frontend/backend):**
- See `references/data_patterns.md` for transformation functions
- Examples: groupBy, pivot, aggregate, calculateGrowthRate

### Step 4: Select Chart Types
Choose appropriate visualizations:
- **Time series data** → Line or Area chart
- **Category comparison** → Bar chart
- **Proportions** → Pie or Donut chart
- **Multiple metrics** → Composed chart
- **Distributions** → Histogram or Box plot

Consult `references/recharts_guide.md` for implementation details.

**Chart selection tool:**
```bash
python scripts/chart_config.py suggest \
  --data sales.json \
  --x-axis date \
  --y-axis revenue
```

### Step 5: Build Dashboard Components
Use provided templates:

**Dashboard Page Template:**
Copy `assets/DashboardTemplate.tsx` to create new dashboard page with:
- Metric cards with icons and trends
- Responsive grid layout
- Loading skeletons
- Error handling

**Chart Components:**
- `assets/chart_templates/TrendLineChart.tsx` - Line charts for trends
- `assets/chart_templates/ComparisonBarChart.tsx` - Bar charts for comparisons
- `assets/chart_templates/DistributionPieChart.tsx` - Pie charts for proportions

**Example usage:**
```tsx
import { TrendLineChart } from './chart_templates/TrendLineChart';

<TrendLineChart
  data={salesData}
  xDataKey="date"
  lines={[
    { dataKey: 'revenue', color: '#3b82f6', name: 'Revenue' },
    { dataKey: 'orders', color: '#10b981', name: 'Orders' }
  ]}
  formatYAxis={(value) => `$${value.toLocaleString()}`}
  height={400}
/>
```

### Step 6: Apply Statistical Analysis (Optional)
Add advanced insights:

**Trend Detection:**
```bash
python scripts/trend_analyzer.py detect-trends \
  --input sales.json \
  --output trends.json \
  --value-field revenue \
  --trend-window 7
```

**Forecasting:**
```bash
python scripts/trend_analyzer.py forecast \
  --input sales.json \
  --output forecast.json \
  --value-field revenue \
  --periods 7 \
  --method ema
```

**Outlier Detection:**
```bash
python scripts/trend_analyzer.py outliers \
  --input deliveries.json \
  --output outliers.json \
  --value-field deliveryTime \
  --threshold 2
```

### Step 7: Calculate KPIs
Implement business metrics using formulas from `references/kpi_formulas.md`:

**Common KPIs:**
- Conversion Rate = (Delivered Orders / Total Orders) × 100
- Average Order Value = Total Revenue / Number of Orders
- Growth Rate = ((Current - Previous) / Previous) × 100
- Customer Lifetime Value = AOV × Purchase Frequency × Lifespan
- Delivery Success Rate = (Successful Deliveries / Total Attempts) × 100

**Implementation example:**
```typescript
const metrics = {
  conversionRate: (deliveredOrders / totalOrders * 100).toFixed(2),
  aov: (totalRevenue / totalOrders).toFixed(2),
  growthRate: ((currentRevenue - lastMonthRevenue) / lastMonthRevenue * 100).toFixed(2)
};
```

### Step 8: Optimize Performance
For large datasets:
- Disable animations: `isAnimationActive={false}`
- Remove dots on line charts: `dot={false}`
- Aggregate data before rendering
- Use memoization: `React.memo()`
- Limit data points (show top N or paginate)

See `references/recharts_guide.md` section "Performance Optimization" for details.

### Step 9: Add Real-Time Updates (Optional)
Subscribe to Socket.io events for live data:
```typescript
import { socket } from '../services/socket';

useEffect(() => {
  socket.on('order:created', () => {
    fetchDashboardMetrics(); // Refresh data
  });

  return () => {
    socket.off('order:created');
  };
}, []);
```

## Quick Reference

### Available Scripts

1. **data_transformer.py** - Transform and aggregate data
   - Operations: aggregate, pivot, timeseries, calculate
   - Run with `--help` for usage examples

2. **trend_analyzer.py** - Statistical analysis and forecasting
   - Operations: forecast, detect-trends, seasonality, outliers, statistics
   - Supports moving average and exponential smoothing

3. **chart_config.py** - Generate Recharts configurations
   - Chart types: line, bar, area, pie, composed
   - Includes chart type suggestion tool

### Reference Documentation

- **recharts_guide.md** - Complete Recharts implementation guide
  - All chart types with examples
  - Color palette standards
  - Performance optimization tips

- **analytics_api.md** - Backend analytics endpoints
  - Existing service methods
  - Database schema reference
  - Integration patterns

- **kpi_formulas.md** - Business metrics calculations
  - 30+ KPI formulas with examples
  - Sales, conversion, delivery, customer metrics
  - Forecasting and trend analysis formulas

- **data_patterns.md** - Data transformation patterns
  - Time series aggregation
  - Grouping and pivoting
  - Statistical transformations
  - Cohort analysis patterns

### Asset Templates

- **DashboardTemplate.tsx** - Full dashboard page template
- **TrendLineChart.tsx** - Reusable line chart component
- **ComparisonBarChart.tsx** - Reusable bar chart component
- **DistributionPieChart.tsx** - Reusable pie/donut chart component

## Integration with Existing Codebase

### Backend Analytics
Location: `backend/src/services/analyticsService.ts`

Existing methods:
- `getDashboardMetrics()` - Core dashboard metrics
- `getSalesTrends(period, limit)` - Time series data
- `getRepPerformance(startDate, endDate)` - Sales rep metrics
- `getAgentPerformance(startDate, endDate)` - Delivery agent metrics

Add new methods here for custom analytics queries.

### Frontend Store
Location: `frontend/src/stores/analyticsStore.ts`

Manages analytics state with Zustand. Add actions for new metrics.

### Existing Charts
Location: `frontend/src/components/charts/`

Current implementations:
- `SalesTrendChart.tsx`
- `RevenueChart.tsx`
- `OrderFunnelChart.tsx`
- `PerformanceChart.tsx`

Study these for patterns and consistency.

### Database Schema
Location: `backend/prisma/schema.prisma`

Key models for analytics:
- Order (status, totalAmount, timestamps)
- Delivery (scheduledTime, actualDeliveryTime)
- User (role, commissionRate, deliveryRate)
- Customer (order history, lifetime value)

## Examples

### Example 1: Sales Trend Dashboard

**Requirements:** Show daily sales for last 30 days with 7-day moving average

**Implementation:**
```bash
# 1. Get data from API
curl http://localhost:3000/api/analytics/trends?period=daily&limit=30

# 2. Calculate moving average
python scripts/data_transformer.py calculate \
  --input sales.json \
  --output trends.json \
  --metric moving_average \
  --value-field sales \
  --window 7

# 3. Use TrendLineChart component
<TrendLineChart
  data={trendsData}
  xDataKey="date"
  lines={[
    { dataKey: 'sales', color: '#3b82f6', name: 'Daily Sales' },
    { dataKey: 'moving_average', color: '#10b981', name: '7-Day Average' }
  ]}
/>
```

### Example 2: Rep Performance Leaderboard

**Requirements:** Top 10 sales reps by revenue with commission

**Implementation:**
```typescript
// Fetch rep performance
const reps = await analyticsService.getRepPerformance();

// Calculate commission
const repsWithCommission = reps.map(rep => ({
  ...rep,
  commission: (rep.totalRevenue * (rep.commissionRate / 100)).toFixed(2)
}));

// Sort and limit
const top10 = repsWithCommission
  .sort((a, b) => b.totalRevenue - a.totalRevenue)
  .slice(0, 10);

// Display in bar chart
<ComparisonBarChart
  data={top10}
  xDataKey="repName"
  bars={[
    { dataKey: 'totalRevenue', color: '#3b82f6', name: 'Revenue' },
    { dataKey: 'commission', color: '#10b981', name: 'Commission' }
  ]}
  formatYAxis={(value) => `$${value.toLocaleString()}`}
/>
```

### Example 3: Order Status Distribution

**Requirements:** Pie chart showing order status breakdown

**Implementation:**
```typescript
// Aggregate orders by status
const statusData = await prisma.order.groupBy({
  by: ['status'],
  _count: true
});

// Format for pie chart
const pieData = statusData.map(item => ({
  status: item.status,
  count: item._count
}));

// Display
<DistributionPieChart
  data={pieData}
  nameKey="status"
  valueKey="count"
  donut={true}
/>
```

## Best Practices

1. **Always validate data** - Check for null/undefined before visualization
2. **Format numbers consistently** - Use Intl.NumberFormat for currency/percentages
3. **Show loading states** - Use skeletons while data loads
4. **Handle errors gracefully** - Display user-friendly error messages
5. **Add tooltips** - Help users understand what metrics mean
6. **Use color consistently** - Follow palette in recharts_guide.md
7. **Optimize for performance** - Aggregate large datasets before rendering
8. **Test with real data** - Use production-like data volumes
9. **Document calculations** - Add comments explaining KPI formulas
10. **Make it responsive** - Test on different screen sizes

## Troubleshooting

**Charts not displaying:**
- Verify data structure matches dataKey props
- Check ResponsiveContainer has valid height
- Ensure numeric values are numbers, not strings

**Performance issues:**
- Reduce data points (aggregate or limit)
- Disable animations
- Remove dots from line charts
- Use React.memo for chart components

**Incorrect calculations:**
- Verify KPI formulas against kpi_formulas.md
- Check for division by zero
- Handle null/undefined values
- Round to appropriate decimal places

**Data not updating:**
- Check Socket.io connection
- Verify useEffect dependencies
- Ensure API calls complete successfully
- Check for caching issues
