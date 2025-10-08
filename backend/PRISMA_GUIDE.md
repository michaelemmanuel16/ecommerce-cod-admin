# Prisma Guide

Complete guide to using Prisma ORM in the E-Commerce COD Admin backend.

## Table of Contents

- [Introduction](#introduction)
- [Schema Definition](#schema-definition)
- [Migrations](#migrations)
- [Querying Data](#querying-data)
- [Relations](#relations)
- [Transactions](#transactions)
- [Best Practices](#best-practices)

## Introduction

Prisma is a modern ORM that provides type-safe database access. It auto-generates types based on your schema.

## Schema Definition

See `prisma/schema.prisma` for the complete database schema.

### Example Model

```prisma
model Order {
  id            String      @id @default(uuid())
  orderNumber   String      @unique
  customerId    String
  status        OrderStatus @default(PENDING)
  totalAmount   Float
  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt
  
  customer      Customer    @relation(fields: [customerId], references: [id])
  items         OrderItem[]
  
  @@index([customerId])
  @@index([status])
}
```

## Migrations

```bash
# Create new migration
npx prisma migrate dev --name add_order_notes

# Apply migrations in production
npx prisma migrate deploy

# Reset database (development only)
npx prisma migrate reset
```

## Querying Data

### Basic Queries

```typescript
// Find all
const orders = await prisma.order.findMany();

// Find by ID
const order = await prisma.order.findUnique({
  where: { id: 'order-id' }
});

// Create
const order = await prisma.order.create({
  data: {
    orderNumber: 'ORD-001',
    customerId: 'customer-id',
    totalAmount: 100
  }
});

// Update
const order = await prisma.order.update({
  where: { id: 'order-id' },
  data: { status: 'CONFIRMED' }
});

// Delete
await prisma.order.delete({
  where: { id: 'order-id' }
});
```

## Relations

```typescript
// Include related data
const order = await prisma.order.findUnique({
  where: { id: 'order-id' },
  include: {
    customer: true,
    items: {
      include: {
        product: true
      }
    }
  }
});
```

## Transactions

```typescript
await prisma.$transaction(async (tx) => {
  await tx.order.create({ data: orderData });
  await tx.product.update({ 
    where: { id: productId },
    data: { stock: { decrement: quantity } }
  });
});
```

## Best Practices

1. Always use transactions for multi-step operations
2. Use indexes for frequently queried fields
3. Select only needed fields with `select`
4. Use `include` for relations
5. Handle unique constraint violations

---

**For more information:**
- [Prisma Documentation](https://www.prisma.io/docs)
- [Developer Guide](../DEVELOPER_GUIDE.md)

**Last Updated:** 2025-10-08
