# Data Transformation Patterns

Common data transformation and aggregation patterns for analytics dashboards.

## Time Series Transformations

### 1. Daily Aggregation
Convert granular data (orders, sales) to daily totals.

**Input:** Array of orders with timestamps
**Output:** Daily aggregated data

```typescript
function aggregateByDay(orders: Order[]) {
  const dailyMap = new Map<string, { orders: number; revenue: number }>();

  orders.forEach(order => {
    const dateKey = order.createdAt.toISOString().split('T')[0];
    const existing = dailyMap.get(dateKey) || { orders: 0, revenue: 0 };
    dailyMap.set(dateKey, {
      orders: existing.orders + 1,
      revenue: existing.revenue + order.totalAmount
    });
  });

  return Array.from(dailyMap.entries())
    .map(([date, data]) => ({ date, ...data }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
```

### 2. Weekly Aggregation
Group data by week (Monday to Sunday).

```typescript
function aggregateByWeek(data: any[], dateField: string) {
  const weeklyMap = new Map();

  data.forEach(item => {
    const date = new Date(item[dateField]);
    const startOfWeek = new Date(date);
    startOfWeek.setDate(date.getDate() - date.getDay() + 1); // Monday
    const weekKey = startOfWeek.toISOString().split('T')[0];

    if (!weeklyMap.has(weekKey)) {
      weeklyMap.set(weekKey, []);
    }
    weeklyMap.get(weekKey).push(item);
  });

  return Array.from(weeklyMap.entries()).map(([week, items]) => ({
    week,
    count: items.length,
    // Add other aggregations as needed
  }));
}
```

### 3. Monthly Aggregation
Group data by month.

```typescript
function aggregateByMonth(data: any[], dateField: string, valueField: string) {
  const monthlyMap = new Map();

  data.forEach(item => {
    const date = new Date(item[dateField]);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

    const existing = monthlyMap.get(monthKey) || { count: 0, total: 0 };
    monthlyMap.set(monthKey, {
      count: existing.count + 1,
      total: existing.total + (item[valueField] || 0)
    });
  });

  return Array.from(monthlyMap.entries())
    .map(([month, data]) => ({ month, ...data }))
    .sort((a, b) => a.month.localeCompare(b.month));
}
```

## Grouping & Pivoting

### 4. Group By Single Field
```typescript
function groupBy<T>(array: T[], key: keyof T): Map<any, T[]> {
  return array.reduce((map, item) => {
    const keyValue = item[key];
    if (!map.has(keyValue)) {
      map.set(keyValue, []);
    }
    map.get(keyValue)!.push(item);
    return map;
  }, new Map());
}

// Usage
const ordersByStatus = groupBy(orders, 'status');
```

### 5. Pivot Table
Transform data from long format to wide format.

```typescript
interface PivotOptions {
  index: string;      // Row key
  columns: string;    // Column key
  values: string;     // Value to aggregate
  aggFunc: 'sum' | 'avg' | 'count';
}

function pivot(data: any[], options: PivotOptions) {
  const { index, columns, values, aggFunc } = options;
  const pivotMap = new Map();

  // Build pivot structure
  data.forEach(item => {
    const rowKey = item[index];
    const colKey = item[columns];
    const value = item[values];

    if (!pivotMap.has(rowKey)) {
      pivotMap.set(rowKey, new Map());
    }

    const row = pivotMap.get(rowKey);
    if (!row.has(colKey)) {
      row.set(colKey, []);
    }
    row.get(colKey).push(value);
  });

  // Apply aggregation
  const result = [];
  for (const [rowKey, row] of pivotMap) {
    const rowData: any = { [index]: rowKey };
    for (const [colKey, values] of row) {
      rowData[colKey] = aggregate(values, aggFunc);
    }
    result.push(rowData);
  }

  return result;
}

function aggregate(values: number[], func: string): number {
  switch (func) {
    case 'sum':
      return values.reduce((a, b) => a + b, 0);
    case 'avg':
      return values.reduce((a, b) => a + b, 0) / values.length;
    case 'count':
      return values.length;
    default:
      return 0;
  }
}
```

## Filtering & Sorting

### 6. Date Range Filter
```typescript
function filterByDateRange(data: any[], dateField: string, startDate: Date, endDate: Date) {
  return data.filter(item => {
    const itemDate = new Date(item[dateField]);
    return itemDate >= startDate && itemDate <= endDate;
  });
}
```

### 7. Top N Items
```typescript
function getTopN<T>(array: T[], field: keyof T, n: number, order: 'asc' | 'desc' = 'desc'): T[] {
  return array
    .sort((a, b) => {
      const aVal = a[field] as any;
      const bVal = b[field] as any;
      return order === 'desc' ? bVal - aVal : aVal - bVal;
    })
    .slice(0, n);
}

// Usage
const top5Reps = getTopN(reps, 'revenue', 5);
```

## Calculated Fields

### 8. Add Calculated Fields
```typescript
function addCalculatedFields<T extends Record<string, any>>(
  data: T[],
  calculations: Record<string, (item: T) => any>
): (T & Record<string, any>)[] {
  return data.map(item => {
    const calculated: Record<string, any> = {};
    for (const [key, calc] of Object.entries(calculations)) {
      calculated[key] = calc(item);
    }
    return { ...item, ...calculated };
  });
}

// Usage
const ordersWithAOV = addCalculatedFields(orders, {
  itemCount: (order) => order.items.length,
  avgItemPrice: (order) => order.totalAmount / order.items.length
});
```

### 9. Running Total (Cumulative Sum)
```typescript
function calculateRunningTotal(data: any[], valueField: string, outputField: string = 'cumulative') {
  let total = 0;
  return data.map(item => ({
    ...item,
    [outputField]: total += item[valueField]
  }));
}
```

### 10. Percentage of Total
```typescript
function addPercentageOfTotal(data: any[], valueField: string) {
  const total = data.reduce((sum, item) => sum + item[valueField], 0);
  return data.map(item => ({
    ...item,
    percentage: (item[valueField] / total * 100).toFixed(2),
    percentageValue: item[valueField] / total * 100
  }));
}
```

## Statistical Transformations

### 11. Normalize Values (0-1 range)
```typescript
function normalize(data: any[], field: string) {
  const values = data.map(item => item[field]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;

  return data.map(item => ({
    ...item,
    [`${field}_normalized`]: range === 0 ? 0 : (item[field] - min) / range
  }));
}
```

### 12. Z-Score (Standard Score)
```typescript
function calculateZScores(data: any[], field: string) {
  const values = data.map(item => item[field]);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
  const stdDev = Math.sqrt(variance);

  return data.map(item => ({
    ...item,
    [`${field}_zscore`]: stdDev === 0 ? 0 : (item[field] - mean) / stdDev
  }));
}
```

## Comparison Patterns

### 13. Period-over-Period Comparison
```typescript
interface PeriodData {
  period: string;
  value: number;
}

function comparePeriods(current: PeriodData[], previous: PeriodData[]) {
  const prevMap = new Map(previous.map(p => [p.period, p.value]));

  return current.map(curr => {
    const prevValue = prevMap.get(curr.period) || 0;
    const change = curr.value - prevValue;
    const changePercent = prevValue === 0 ? 0 : (change / prevValue * 100);

    return {
      ...curr,
      previousValue: prevValue,
      change,
      changePercent: changePercent.toFixed(2),
      trend: changePercent > 5 ? 'up' : changePercent < -5 ? 'down' : 'stable'
    };
  });
}
```

### 14. Rank Items
```typescript
function rankItems<T>(array: T[], field: keyof T, order: 'asc' | 'desc' = 'desc'): (T & { rank: number })[] {
  const sorted = [...array].sort((a, b) => {
    const aVal = a[field] as any;
    const bVal = b[field] as any;
    return order === 'desc' ? bVal - aVal : aVal - bVal;
  });

  return sorted.map((item, index) => ({
    ...item,
    rank: index + 1
  }));
}
```

## Cohort Analysis Patterns

### 15. Build Cohort Matrix
```typescript
interface CohortData {
  customerId: number;
  firstOrderDate: Date;
  orderDate: Date;
  revenue: number;
}

function buildCohortMatrix(data: CohortData[]) {
  // Group by cohort (first order month)
  const cohorts = new Map<string, Map<number, { customers: Set<number>, revenue: number }>>();

  data.forEach(item => {
    const cohortKey = item.firstOrderDate.toISOString().substring(0, 7); // YYYY-MM
    const monthsSinceFirst = Math.floor(
      (item.orderDate.getTime() - item.firstOrderDate.getTime()) / (30 * 24 * 60 * 60 * 1000)
    );

    if (!cohorts.has(cohortKey)) {
      cohorts.set(cohortKey, new Map());
    }

    const cohort = cohorts.get(cohortKey)!;
    if (!cohort.has(monthsSinceFirst)) {
      cohort.set(monthsSinceFirst, { customers: new Set(), revenue: 0 });
    }

    const period = cohort.get(monthsSinceFirst)!;
    period.customers.add(item.customerId);
    period.revenue += item.revenue;
  });

  // Convert to array format
  const matrix = [];
  for (const [cohortKey, periods] of cohorts) {
    const row: any = { cohort: cohortKey };
    for (const [month, data] of periods) {
      row[`month${month}`] = {
        customers: data.customers.size,
        revenue: data.revenue
      };
    }
    matrix.push(row);
  }

  return matrix;
}
```

## Funnel Analysis

### 16. Calculate Funnel Metrics
```typescript
interface FunnelStep {
  name: string;
  count: number;
}

function calculateFunnel(steps: FunnelStep[]) {
  const total = steps[0]?.count || 0;

  return steps.map((step, index) => {
    const previousCount = index > 0 ? steps[index - 1].count : total;
    const dropoff = index > 0 ? previousCount - step.count : 0;
    const dropoffRate = previousCount === 0 ? 0 : (dropoff / previousCount * 100);
    const conversionRate = total === 0 ? 0 : (step.count / total * 100);

    return {
      ...step,
      conversionRate: conversionRate.toFixed(2),
      dropoff,
      dropoffRate: dropoffRate.toFixed(2)
    };
  });
}
```

## Data Quality & Cleaning

### 17. Fill Missing Values
```typescript
function fillMissing<T>(data: T[], field: keyof T, strategy: 'zero' | 'mean' | 'forward' | 'backward') {
  if (strategy === 'zero') {
    return data.map(item => ({
      ...item,
      [field]: item[field] ?? 0
    }));
  }

  if (strategy === 'mean') {
    const values = data.filter(item => item[field] != null).map(item => item[field] as any);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return data.map(item => ({
      ...item,
      [field]: item[field] ?? mean
    }));
  }

  if (strategy === 'forward') {
    let lastValue: any = null;
    return data.map(item => {
      const value = item[field] ?? lastValue;
      lastValue = value;
      return { ...item, [field]: value };
    });
  }

  // backward fill
  let lastValue: any = null;
  return data.reverse().map(item => {
    const value = item[field] ?? lastValue;
    lastValue = value;
    return { ...item, [field]: value };
  }).reverse();
}
```

### 18. Remove Outliers
```typescript
function removeOutliers(data: any[], field: string, threshold: number = 2) {
  const values = data.map(item => item[field]);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
  const stdDev = Math.sqrt(variance);

  return data.filter(item => {
    const zScore = Math.abs((item[field] - mean) / stdDev);
    return zScore <= threshold;
  });
}
```

## Formatting Patterns

### 19. Format for Chart Display
```typescript
function formatForRecharts(data: any[], xKey: string, yKeys: string[]) {
  return data.map(item => {
    const formatted: any = { [xKey]: item[xKey] };
    yKeys.forEach(key => {
      formatted[key] = typeof item[key] === 'number' ? Number(item[key].toFixed(2)) : item[key];
    });
    return formatted;
  });
}
```

### 20. Flatten Nested Data
```typescript
function flattenNested(data: any[], nestedKey: string, prefix: string = '') {
  return data.map(item => {
    const flattened = { ...item };
    const nested = item[nestedKey];

    if (nested && typeof nested === 'object') {
      Object.keys(nested).forEach(key => {
        flattened[`${prefix}${key}`] = nested[key];
      });
      delete flattened[nestedKey];
    }

    return flattened;
  });
}
```

## Utility Functions

### 21. Safe Division
```typescript
function safeDivide(numerator: number, denominator: number, defaultValue: number = 0): number {
  return denominator === 0 ? defaultValue : numerator / denominator;
}
```

### 22. Round to Decimals
```typescript
function roundTo(value: number, decimals: number = 2): number {
  const multiplier = Math.pow(10, decimals);
  return Math.round(value * multiplier) / multiplier;
}
```

### 23. Format Currency
```typescript
function formatCurrency(amount: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency
  }).format(amount);
}
```
