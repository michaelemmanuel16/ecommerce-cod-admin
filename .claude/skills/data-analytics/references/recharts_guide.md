# Recharts Guide

Comprehensive reference for creating charts with Recharts library.

## Chart Types and When to Use Them

### Line Chart
**Best for:** Trends over time, continuous data

**Use cases:**
- Sales trends over days/weeks/months
- Growth metrics
- Performance tracking over time

**Implementation:**
```tsx
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

<ResponsiveContainer width="100%" height={300}>
  <LineChart data={data}>
    <CartesianGrid strokeDasharray="3 3" />
    <XAxis dataKey="date" />
    <YAxis />
    <Tooltip />
    <Legend />
    <Line type="monotone" dataKey="sales" stroke="#3b82f6" strokeWidth={2} />
  </LineChart>
</ResponsiveContainer>
```

### Bar Chart
**Best for:** Comparing categories, discrete data

**Use cases:**
- Revenue by product
- Sales by sales rep
- Orders by status
- Regional performance

**Implementation:**
```tsx
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

<ResponsiveContainer width="100%" height={300}>
  <BarChart data={data}>
    <CartesianGrid strokeDasharray="3 3" />
    <XAxis dataKey="category" />
    <YAxis />
    <Tooltip />
    <Legend />
    <Bar dataKey="value" fill="#3b82f6" radius={[8, 8, 0, 0]} />
  </BarChart>
</ResponsiveContainer>
```

**Stacked Bar Chart:**
```tsx
<Bar dataKey="delivered" stackId="a" fill="#10b981" />
<Bar dataKey="pending" stackId="a" fill="#f59e0b" />
<Bar dataKey="cancelled" stackId="a" fill="#ef4444" />
```

### Area Chart
**Best for:** Cumulative data, showing volume

**Use cases:**
- Cumulative revenue
- Stock levels over time
- Order volume trends

**Implementation:**
```tsx
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

<ResponsiveContainer width="100%" height={300}>
  <AreaChart data={data}>
    <CartesianGrid strokeDasharray="3 3" />
    <XAxis dataKey="date" />
    <YAxis />
    <Tooltip />
    <Area type="monotone" dataKey="revenue" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.6} />
  </AreaChart>
</ResponsiveContainer>
```

### Pie Chart
**Best for:** Proportions, percentage breakdown

**Use cases:**
- Order status distribution
- Revenue by category
- Market share
- Customer segments

**Implementation:**
```tsx
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444'];

<ResponsiveContainer width="100%" height={300}>
  <PieChart>
    <Pie
      data={data}
      cx="50%"
      cy="50%"
      labelLine={false}
      label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
      outerRadius={80}
      fill="#8884d8"
      dataKey="value"
    >
      {data.map((entry, index) => (
        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
      ))}
    </Pie>
    <Tooltip />
    <Legend />
  </PieChart>
</ResponsiveContainer>
```

**Donut Chart:** Set `innerRadius` prop:
```tsx
<Pie innerRadius={60} outerRadius={80} ... />
```

### Composed Chart
**Best for:** Multiple metrics with different scales

**Use cases:**
- Revenue (bars) + conversion rate (line)
- Orders (bars) + average order value (line)
- Volume + trend line

**Implementation:**
```tsx
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

<ResponsiveContainer width="100%" height={300}>
  <ComposedChart data={data}>
    <CartesianGrid strokeDasharray="3 3" />
    <XAxis dataKey="date" />
    <YAxis yAxisId="left" />
    <YAxis yAxisId="right" orientation="right" />
    <Tooltip />
    <Legend />
    <Bar yAxisId="left" dataKey="orders" fill="#3b82f6" />
    <Line yAxisId="right" type="monotone" dataKey="conversionRate" stroke="#10b981" strokeWidth={2} />
  </ComposedChart>
</ResponsiveContainer>
```

## Color Palette

### Primary Colors (Use these for consistency)
- Blue: `#3b82f6` - Primary data, main metrics
- Green: `#10b981` - Success, growth, positive
- Orange: `#f59e0b` - Warning, pending
- Red: `#ef4444` - Error, decline, negative
- Purple: `#8b5cf6` - Secondary metrics

### Extended Palette
- Teal: `#14b8a6`
- Pink: `#ec4899`
- Indigo: `#6366f1`
- Amber: `#f97316`

## Common Patterns

### Responsive Container
Always wrap charts in ResponsiveContainer:
```tsx
<ResponsiveContainer width="100%" height={300}>
  {/* Chart here */}
</ResponsiveContainer>
```

### Custom Tooltip
```tsx
const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white p-3 border border-gray-200 rounded shadow-lg">
        <p className="font-semibold">{label}</p>
        {payload.map((entry, index) => (
          <p key={index} style={{ color: entry.color }}>
            {entry.name}: {entry.value}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

<Tooltip content={<CustomTooltip />} />
```

### Formatted Axis Labels
```tsx
// Format currency
<YAxis tickFormatter={(value) => `$${value.toLocaleString()}`} />

// Format percentage
<YAxis tickFormatter={(value) => `${value}%`} />

// Format dates
<XAxis dataKey="date" tickFormatter={(value) => new Date(value).toLocaleDateString()} />
```

### Grid Customization
```tsx
<CartesianGrid
  strokeDasharray="3 3"
  stroke="#e5e7eb"
  vertical={false}  // Hide vertical lines
/>
```

### Legend Position
```tsx
<Legend
  verticalAlign="top"
  height={36}
  iconType="circle"
/>
```

## Performance Optimization

### Large Datasets (>1000 points)
1. Use `isAnimationActive={false}` to disable animations
2. Aggregate data before rendering
3. Use `dot={false}` for Line charts
4. Consider using sampling

```tsx
<Line
  type="monotone"
  dataKey="sales"
  stroke="#3b82f6"
  dot={false}  // No dots for large datasets
  isAnimationActive={false}
/>
```

### Memoization
Wrap chart components in React.memo:
```tsx
const SalesChart = React.memo(({ data }) => {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data}>
        {/* ... */}
      </LineChart>
    </ResponsiveContainer>
  );
});
```

## Accessibility

### Proper Labels
```tsx
<XAxis dataKey="date" label={{ value: 'Date', position: 'insideBottom', offset: -5 }} />
<YAxis label={{ value: 'Revenue ($)', angle: -90, position: 'insideLeft' }} />
```

### Color Contrast
Ensure sufficient contrast for readability:
- Use darker colors for text
- Test in grayscale mode
- Add patterns for color-blind accessibility

## Common Issues

### Data Not Showing
- Check data structure matches dataKey props
- Ensure data is an array of objects
- Verify numeric values are numbers, not strings
- Check ResponsiveContainer has valid dimensions

### Overlapping Labels
```tsx
<XAxis dataKey="date" angle={-45} textAnchor="end" height={80} />
```

### Missing Axis
- Ensure YAxis domain is appropriate for your data
- Use `domain={[0, 'auto']}` to start from zero
- Use `domain={['dataMin', 'dataMax']}` for tight bounds

## Reference Links
- Recharts Documentation: https://recharts.org/
- Examples Gallery: https://recharts.org/en-US/examples
- API Reference: https://recharts.org/en-US/api
