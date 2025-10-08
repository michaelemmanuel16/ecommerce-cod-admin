# Component Guide

Guide to components in the E-Commerce COD Admin frontend.

## Table of Contents

- [Component Architecture](#component-architecture)
- [Layout Components](#layout-components)
- [Order Components](#order-components)
- [Customer Components](#customer-components)
- [Product Components](#product-components)
- [Common Components](#common-components)
- [Best Practices](#best-practices)

## Component Architecture

### Component Types

1. **Layout Components**: Page structure (Header, Sidebar, Layout)
2. **Page Components**: Full pages (Dashboard, Orders, Customers)
3. **Feature Components**: Feature-specific (OrderCard, CustomerList)
4. **Common Components**: Reusable UI (Button, Input, Modal)

### File Structure

```
components/
├── layout/
│   ├── Header.tsx
│   ├── Sidebar.tsx
│   └── Layout.tsx
├── orders/
│   ├── KanbanBoard.tsx
│   ├── OrderCard.tsx
│   └── OrderDetails.tsx
└── common/
    ├── Button.tsx
    ├── Input.tsx
    └── Modal.tsx
```

## Layout Components

### Layout

Main layout wrapper with sidebar and header.

```typescript
import { Layout } from '@/components/layout/Layout';

function Page() {
  return (
    <Layout>
      <div>Page content</div>
    </Layout>
  );
}
```

### Header

Top navigation bar with user menu.

### Sidebar

Navigation sidebar with menu items.

## Order Components

### KanbanBoard

Drag-and-drop board for orders.

```typescript
import { KanbanBoard } from '@/components/orders/KanbanBoard';

<KanbanBoard 
  orders={orders}
  onStatusChange={handleStatusChange}
/>
```

### OrderCard

Individual order card in Kanban.

```typescript
<OrderCard 
  order={order}
  onClick={() => setSelectedOrder(order)}
/>
```

### OrderDetails

Order details modal/panel.

```typescript
<OrderDetails 
  order={order}
  onClose={() => setSelectedOrder(null)}
  onUpdate={handleUpdate}
/>
```

## Common Components

### Button

```typescript
<Button 
  variant="primary" // primary, secondary, danger
  size="md"         // sm, md, lg
  onClick={handleClick}
  disabled={isLoading}
>
  Click Me
</Button>
```

### Input

```typescript
<Input
  type="text"
  label="Email"
  value={email}
  onChange={(e) => setEmail(e.target.value)}
  error={errors.email}
  placeholder="Enter email"
/>
```

### Modal

```typescript
<Modal
  isOpen={isOpen}
  onClose={() => setIsOpen(false)}
  title="Modal Title"
>
  <div>Modal content</div>
</Modal>
```

### Table

```typescript
<Table
  columns={columns}
  data={data}
  onRowClick={handleRowClick}
  loading={isLoading}
/>
```

## Best Practices

1. **Use TypeScript**: Always define prop types
2. **Keep Components Small**: Single responsibility
3. **Composition**: Compose complex UIs from simple components
4. **Memoization**: Use React.memo for expensive components
5. **Custom Hooks**: Extract reusable logic
6. **Error Boundaries**: Handle errors gracefully

---

**For more information:**
- [Developer Guide](../DEVELOPER_GUIDE.md)
- [Frontend README](README.md)

**Last Updated:** 2025-10-08
