# Backend API Documentation

Complete API reference for the E-Commerce COD Admin Dashboard Backend.

## Table of Contents

- [Overview](#overview)
- [Authentication](#authentication)
- [Common Patterns](#common-patterns)
- [Authentication Endpoints](#authentication-endpoints)
- [User Endpoints](#user-endpoints)
- [Customer Endpoints](#customer-endpoints)
- [Product Endpoints](#product-endpoints)
- [Order Endpoints](#order-endpoints)
- [Delivery Endpoints](#delivery-endpoints)
- [Financial Endpoints](#financial-endpoints)
- [Analytics Endpoints](#analytics-endpoints)
- [Workflow Endpoints](#workflow-endpoints)
- [Webhook Endpoints](#webhook-endpoints)
- [Notification Endpoints](#notification-endpoints)
- [Error Handling](#error-handling)
- [Rate Limiting](#rate-limiting)

## Overview

**Base URL:** `http://localhost:3000/api` (development)
**API Version:** 1.0.0
**Response Format:** JSON
**Authentication:** JWT Bearer Token

### Key Features

- RESTful API design
- JWT-based authentication with refresh tokens
- Role-based access control (RBAC)
- Request validation using middleware
- Rate limiting
- Real-time updates via Socket.io
- Comprehensive error handling

## Authentication

The API uses JWT (JSON Web Tokens) for authentication. All protected endpoints require a valid access token in the `Authorization` header.

### Authentication Flow

```
1. Client → POST /api/auth/login {email, password}
2. Server → Returns {accessToken, refreshToken, user}
3. Client → Stores tokens (localStorage/sessionStorage)
4. Client → Includes accessToken in Authorization header for requests
5. When accessToken expires → POST /api/auth/refresh {refreshToken}
6. Server → Returns new {accessToken}
```

### Token Lifespan

- **Access Token:** 7 days (JWT_EXPIRES_IN)
- **Refresh Token:** 30 days (JWT_REFRESH_EXPIRES_IN)

### Using Tokens

Include the access token in the `Authorization` header:

```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

## Common Patterns

### Success Response

```json
{
  "order": {
    "id": "clx1234567890",
    "orderNumber": "ORD-20251012-0001",
    "status": "pending_confirmation",
    ...
  }
}
```

### Error Response

```json
{
  "error": "Error message description"
}
```

### Paginated Response

```json
{
  "orders": [...],
  "pagination": {
    "total": 150,
    "page": 1,
    "limit": 20,
    "totalPages": 8
  }
}
```

### Common Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | 1 | Page number (1-indexed) |
| `limit` | number | 20 | Items per page |
| `search` | string | - | Search query |
| `sortBy` | string | createdAt | Sort field |
| `sortOrder` | string | desc | Sort order (asc/desc) |

## Authentication Endpoints

### POST /api/auth/register

Register a new user account.

**Authentication:** Not required
**Authorization:** super_admin, admin (to create non-sales_rep users)

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!",
  "firstName": "John",
  "lastName": "Doe",
  "phoneNumber": "+1234567890",
  "role": "sales_rep"
}
```

**Validation Rules:**
- `email`: Valid email format, unique
- `password`: Min 8 characters, must include uppercase, lowercase, number
- `firstName`: Required, min 2 characters
- `lastName`: Required, min 2 characters
- `role`: One of: super_admin, admin, manager, sales_rep, inventory_manager, delivery_agent, accountant

**Response (201 Created):**
```json
{
  "message": "User registered successfully",
  "user": {
    "id": "clx1234567890",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "name": "John Doe",
    "role": "sales_rep",
    "createdAt": "2025-10-12T10:00:00.000Z"
  },
  "tokens": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

**Errors:**
- `400 Bad Request`: Validation error
- `400 Bad Request`: User already exists

---

### POST /api/auth/login

Authenticate a user and receive tokens.

**Authentication:** Not required

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!"
}
```

**Response (200 OK):**
```json
{
  "message": "Login successful",
  "user": {
    "id": "clx1234567890",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "name": "John Doe",
    "role": "sales_rep"
  },
  "tokens": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

**Errors:**
- `401 Unauthorized`: Invalid credentials
- `403 Forbidden`: Account is deactivated

---

### POST /api/auth/refresh

Refresh an expired access token using a refresh token.

**Authentication:** Not required

**Request Body:**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response (200 OK):**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Errors:**
- `400 Bad Request`: Refresh token required
- `401 Unauthorized`: Invalid refresh token

---

### POST /api/auth/logout

Invalidate the current refresh token.

**Authentication:** Required
**Authorization:** All roles

**Response (200 OK):**
```json
{
  "message": "Logout successful"
}
```

---

### GET /api/auth/me

Get current authenticated user information.

**Authentication:** Required
**Authorization:** All roles

**Response (200 OK):**
```json
{
  "user": {
    "id": "clx1234567890",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "phoneNumber": "+1234567890",
    "role": "sales_rep",
    "isActive": true,
    "isAvailable": true,
    "createdAt": "2025-10-12T10:00:00.000Z"
  }
}
```

**Errors:**
- `401 Unauthorized`: Invalid or missing token

---

## User Endpoints

### GET /api/users

List all users with pagination and filtering.

**Authentication:** Required
**Authorization:** super_admin, admin, manager

**Query Parameters:**
- `page` (number): Page number (default: 1)
- `limit` (number): Items per page (default: 20)
- `role` (string): Filter by role
- `isActive` (boolean): Filter by active status
- `isAvailable` (boolean): Filter by availability
- `search` (string): Search by name or email

**Response (200 OK):**
```json
{
  "users": [
    {
      "id": "clx1234567890",
      "email": "user@example.com",
      "firstName": "John",
      "lastName": "Doe",
      "phoneNumber": "+1234567890",
      "role": "sales_rep",
      "isActive": true,
      "isAvailable": true,
      "lastLogin": "2025-10-12T09:00:00.000Z",
      "createdAt": "2025-10-01T00:00:00.000Z"
    }
  ],
  "pagination": {
    "total": 45,
    "page": 1,
    "limit": 20,
    "totalPages": 3
  }
}
```

---

### POST /api/users

Create a new user.

**Authentication:** Required
**Authorization:** super_admin, admin

**Request Body:**
```json
{
  "email": "newuser@example.com",
  "password": "SecurePass123!",
  "firstName": "Jane",
  "lastName": "Smith",
  "phoneNumber": "+1234567891",
  "role": "delivery_agent"
}
```

**Response (201 Created):**
```json
{
  "user": {
    "id": "clx9876543210",
    "email": "newuser@example.com",
    "firstName": "Jane",
    "lastName": "Smith",
    "role": "delivery_agent",
    "createdAt": "2025-10-12T11:00:00.000Z"
  }
}
```

---

### GET /api/users/:id

Get user details by ID.

**Authentication:** Required
**Authorization:** All roles (own profile), super_admin/admin/manager (any user)

**Response (200 OK):**
```json
{
  "user": {
    "id": "clx1234567890",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "phoneNumber": "+1234567890",
    "role": "sales_rep",
    "isActive": true,
    "isAvailable": true,
    "lastLogin": "2025-10-12T09:00:00.000Z",
    "createdAt": "2025-10-01T00:00:00.000Z",
    "updatedAt": "2025-10-12T09:00:00.000Z"
  }
}
```

**Errors:**
- `404 Not Found`: User not found

---

### PUT /api/users/:id

Update user information.

**Authentication:** Required
**Authorization:** super_admin, admin

**Request Body:**
```json
{
  "firstName": "John",
  "lastName": "Doe Jr.",
  "phoneNumber": "+1234567892",
  "role": "manager",
  "isActive": true
}
```

**Response (200 OK):**
```json
{
  "user": {
    "id": "clx1234567890",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe Jr.",
    "phoneNumber": "+1234567892",
    "role": "manager",
    "updatedAt": "2025-10-12T11:30:00.000Z"
  }
}
```

---

### DELETE /api/users/:id

Delete a user (soft delete - sets isActive to false).

**Authentication:** Required
**Authorization:** super_admin, admin

**Response (200 OK):**
```json
{
  "message": "User deleted successfully"
}
```

---

### PATCH /api/users/:id/availability

Toggle user availability status.

**Authentication:** Required
**Authorization:** All roles (own profile), super_admin/admin (any user)

**Request Body:**
```json
{
  "isAvailable": false
}
```

**Response (200 OK):**
```json
{
  "user": {
    "id": "clx1234567890",
    "isAvailable": false,
    "updatedAt": "2025-10-12T12:00:00.000Z"
  }
}
```

---

### GET /api/users/reps/workload

Get workload statistics for customer representatives.

**Authentication:** Required
**Authorization:** super_admin, admin, manager

**Response (200 OK):**
```json
{
  "reps": [
    {
      "id": "clx1234567890",
      "firstName": "John",
      "lastName": "Doe",
      "assignedOrders": 15,
      "pendingOrders": 5,
      "completedToday": 3,
      "isAvailable": true
    }
  ]
}
```

---

### GET /api/users/agents/performance

Get performance metrics for delivery agents.

**Authentication:** Required
**Authorization:** super_admin, admin, manager

**Query Parameters:**
- `startDate` (ISO date): Start date for metrics
- `endDate` (ISO date): End date for metrics

**Response (200 OK):**
```json
{
  "agents": [
    {
      "id": "clx1234567890",
      "firstName": "Jane",
      "lastName": "Smith",
      "totalDeliveries": 150,
      "successfulDeliveries": 145,
      "failedDeliveries": 5,
      "averageDeliveryTime": "45 minutes",
      "onTimeRate": 96.67
    }
  ]
}
```

---

## Customer Endpoints

### GET /api/customers

List all customers with pagination and filtering.

**Authentication:** Required
**Authorization:** All roles

**Query Parameters:**
- `page` (number): Page number
- `limit` (number): Items per page
- `search` (string): Search by name, email, or phone
- `city` (string): Filter by city
- `area` (string): Filter by area
- `isActive` (boolean): Filter by active status

**Response (200 OK):**
```json
{
  "customers": [
    {
      "id": "clxcust1234567",
      "firstName": "Michael",
      "lastName": "Johnson",
      "email": "michael@example.com",
      "phoneNumber": "+1234567890",
      "address": "123 Main St",
      "city": "New York",
      "state": "NY",
      "zipCode": "10001",
      "area": "Manhattan",
      "totalOrders": 12,
      "totalSpent": 2500.50,
      "createdAt": "2025-09-01T00:00:00.000Z"
    }
  ],
  "pagination": {
    "total": 328,
    "page": 1,
    "limit": 20,
    "totalPages": 17
  }
}
```

---

### POST /api/customers

Create a new customer.

**Authentication:** Required
**Authorization:** All roles

**Request Body:**
```json
{
  "firstName": "Sarah",
  "lastName": "Williams",
  "email": "sarah@example.com",
  "phoneNumber": "+1234567891",
  "alternatePhone": "+1234567892",
  "address": "456 Oak Ave",
  "city": "Los Angeles",
  "state": "CA",
  "zipCode": "90001",
  "area": "Downtown",
  "landmark": "Near City Hall",
  "notes": "Prefers morning deliveries"
}
```

**Validation Rules:**
- `firstName`: Required
- `lastName`: Required
- `phoneNumber`: Required, unique
- `email`: Optional, valid email format
- `zipCode`: Required

**Response (201 Created):**
```json
{
  "customer": {
    "id": "clxcust9876543",
    "firstName": "Sarah",
    "lastName": "Williams",
    "email": "sarah@example.com",
    "phoneNumber": "+1234567891",
    "createdAt": "2025-10-12T13:00:00.000Z"
  }
}
```

---

### GET /api/customers/:id

Get customer details by ID.

**Authentication:** Required
**Authorization:** All roles

**Response (200 OK):**
```json
{
  "customer": {
    "id": "clxcust1234567",
    "firstName": "Michael",
    "lastName": "Johnson",
    "email": "michael@example.com",
    "phoneNumber": "+1234567890",
    "alternatePhone": "+1234567892",
    "address": "123 Main St",
    "city": "New York",
    "state": "NY",
    "zipCode": "10001",
    "area": "Manhattan",
    "landmark": "Near Central Park",
    "tags": ["vip", "repeat-customer"],
    "notes": "Prefers afternoon deliveries",
    "totalOrders": 12,
    "totalSpent": 2500.50,
    "isActive": true,
    "createdAt": "2025-09-01T00:00:00.000Z",
    "updatedAt": "2025-10-12T10:00:00.000Z"
  }
}
```

---

### PUT /api/customers/:id

Update customer information.

**Authentication:** Required
**Authorization:** All roles

**Request Body:**
```json
{
  "address": "789 Elm St",
  "landmark": "Near New Shopping Mall",
  "notes": "Updated delivery preferences"
}
```

**Response (200 OK):**
```json
{
  "customer": {
    "id": "clxcust1234567",
    "address": "789 Elm St",
    "landmark": "Near New Shopping Mall",
    "updatedAt": "2025-10-12T14:00:00.000Z"
  }
}
```

---

### DELETE /api/customers/:id

Delete a customer (soft delete).

**Authentication:** Required
**Authorization:** super_admin, admin, manager

**Response (200 OK):**
```json
{
  "message": "Customer deleted successfully"
}
```

---

### PATCH /api/customers/:id/tags

Update customer tags.

**Authentication:** Required
**Authorization:** All roles

**Request Body:**
```json
{
  "tags": ["vip", "priority", "wholesale"]
}
```

**Response (200 OK):**
```json
{
  "customer": {
    "id": "clxcust1234567",
    "tags": ["vip", "priority", "wholesale"],
    "updatedAt": "2025-10-12T14:30:00.000Z"
  }
}
```

---

### GET /api/customers/:id/analytics

Get customer analytics and purchase history.

**Authentication:** Required
**Authorization:** All roles

**Response (200 OK):**
```json
{
  "analytics": {
    "totalOrders": 12,
    "totalSpent": 2500.50,
    "averageOrderValue": 208.38,
    "lastOrderDate": "2025-10-10T00:00:00.000Z",
    "firstOrderDate": "2025-09-01T00:00:00.000Z",
    "ordersByStatus": {
      "delivered": 10,
      "out_for_delivery": 1,
      "cancelled": 1
    },
    "monthlySpending": [
      { "month": "2025-09", "amount": 1200.00 },
      { "month": "2025-10", "amount": 1300.50 }
    ]
  }
}
```

---

## Product Endpoints

### GET /api/products

List all products with pagination and filtering.

**Authentication:** Required
**Authorization:** All roles

**Query Parameters:**
- `page` (number): Page number
- `limit` (number): Items per page
- `search` (string): Search by name or SKU
- `category` (string): Filter by category
- `isActive` (boolean): Filter by active status

**Response (200 OK):**
```json
{
  "products": [
    {
      "id": "clxprod1234567",
      "sku": "PROD-001",
      "name": "Wireless Headphones",
      "description": "Premium noise-cancelling wireless headphones",
      "category": "Electronics",
      "price": 199.99,
      "costPrice": 120.00,
      "stockQuantity": 150,
      "lowStockThreshold": 20,
      "imageUrl": "https://example.com/products/headphones.jpg",
      "weight": 0.5,
      "isActive": true,
      "createdAt": "2025-08-01T00:00:00.000Z"
    }
  ],
  "pagination": {
    "total": 245,
    "page": 1,
    "limit": 20,
    "totalPages": 13
  }
}
```

---

### POST /api/products

Create a new product.

**Authentication:** Required
**Authorization:** super_admin, admin, inventory_manager

**Request Body:**
```json
{
  "sku": "PROD-002",
  "name": "Smart Watch",
  "description": "Fitness tracking smart watch with heart rate monitor",
  "category": "Electronics",
  "price": 299.99,
  "costPrice": 180.00,
  "stockQuantity": 75,
  "lowStockThreshold": 15,
  "imageUrl": "https://example.com/products/smartwatch.jpg",
  "weight": 0.2,
  "dimensions": {
    "length": 5,
    "width": 4,
    "height": 1.5
  }
}
```

**Validation Rules:**
- `sku`: Required, unique
- `name`: Required
- `price`: Required, positive number
- `costPrice`: Required, positive number
- `stockQuantity`: Required, non-negative integer

**Response (201 Created):**
```json
{
  "product": {
    "id": "clxprod9876543",
    "sku": "PROD-002",
    "name": "Smart Watch",
    "price": 299.99,
    "stockQuantity": 75,
    "createdAt": "2025-10-12T15:00:00.000Z"
  }
}
```

---

### GET /api/products/low-stock

Get products with stock below threshold.

**Authentication:** Required
**Authorization:** All roles

**Response (200 OK):**
```json
{
  "products": [
    {
      "id": "clxprod1234567",
      "sku": "PROD-001",
      "name": "Wireless Headphones",
      "stockQuantity": 18,
      "lowStockThreshold": 20,
      "reorderSuggested": 50
    }
  ]
}
```

---

### GET /api/products/:id

Get product details by ID.

**Authentication:** Required
**Authorization:** All roles

**Response (200 OK):**
```json
{
  "product": {
    "id": "clxprod1234567",
    "sku": "PROD-001",
    "name": "Wireless Headphones",
    "description": "Premium noise-cancelling wireless headphones",
    "category": "Electronics",
    "price": 199.99,
    "costPrice": 120.00,
    "stockQuantity": 150,
    "lowStockThreshold": 20,
    "imageUrl": "https://example.com/products/headphones.jpg",
    "weight": 0.5,
    "dimensions": {
      "length": 20,
      "width": 18,
      "height": 10
    },
    "isActive": true,
    "createdAt": "2025-08-01T00:00:00.000Z",
    "updatedAt": "2025-10-12T10:00:00.000Z"
  }
}
```

---

### PUT /api/products/:id

Update product information.

**Authentication:** Required
**Authorization:** super_admin, admin, inventory_manager

**Request Body:**
```json
{
  "price": 189.99,
  "description": "Updated description with new features"
}
```

**Response (200 OK):**
```json
{
  "product": {
    "id": "clxprod1234567",
    "price": 189.99,
    "description": "Updated description with new features",
    "updatedAt": "2025-10-12T15:30:00.000Z"
  }
}
```

---

### DELETE /api/products/:id

Delete a product (soft delete).

**Authentication:** Required
**Authorization:** super_admin, admin

**Response (200 OK):**
```json
{
  "message": "Product deleted successfully"
}
```

---

### PATCH /api/products/:id/stock

Update product stock quantity.

**Authentication:** Required
**Authorization:** super_admin, admin, inventory_manager

**Request Body:**
```json
{
  "stockQuantity": 200,
  "operation": "set"
}
```

**Operations:**
- `set`: Set absolute quantity
- `add`: Add to current quantity
- `subtract`: Subtract from current quantity

**Response (200 OK):**
```json
{
  "product": {
    "id": "clxprod1234567",
    "stockQuantity": 200,
    "updatedAt": "2025-10-12T16:00:00.000Z"
  }
}
```

---

## Order Endpoints

### GET /api/orders

List all orders with advanced filtering and pagination.

**Authentication:** Required
**Authorization:** All roles

**Query Parameters:**
- `page` (number): Page number
- `limit` (number): Items per page
- `status` (OrderStatus): Filter by status
- `customerRepId` (string): Filter by assigned customer rep
- `deliveryAgentId` (string): Filter by assigned delivery agent
- `area` (string): Filter by delivery area
- `city` (string): Filter by delivery city
- `startDate` (ISO date): Filter orders created after this date
- `endDate` (ISO date): Filter orders created before this date
- `search` (string): Search by order number or customer name

**Response (200 OK):**
```json
{
  "orders": [
    {
      "id": "clxorder1234567",
      "orderNumber": "ORD-20251012-0001",
      "customerId": "clxcust1234567",
      "customerRepId": "clxuser1234567",
      "deliveryAgentId": null,
      "status": "pending_confirmation",
      "paymentStatus": "pending",
      "subtotal": 199.99,
      "shippingCost": 10.00,
      "discount": 0,
      "totalAmount": 209.99,
      "codAmount": 209.99,
      "deliveryAddress": "123 Main St",
      "deliveryCity": "New York",
      "deliveryState": "NY",
      "deliveryZipCode": "10001",
      "deliveryArea": "Manhattan",
      "estimatedDelivery": "2025-10-14T00:00:00.000Z",
      "priority": 0,
      "tags": ["urgent"],
      "source": "manual",
      "createdAt": "2025-10-12T10:00:00.000Z",
      "customer": {
        "firstName": "Michael",
        "lastName": "Johnson",
        "phoneNumber": "+1234567890"
      }
    }
  ],
  "pagination": {
    "total": 1247,
    "page": 1,
    "limit": 20,
    "totalPages": 63
  }
}
```

---

### POST /api/orders

Create a new order.

**Authentication:** Required
**Authorization:** All roles

**Request Body:**
```json
{
  "customerId": "clxcust1234567",
  "orderItems": [
    {
      "productId": "clxprod1234567",
      "quantity": 2,
      "unitPrice": 99.99
    }
  ],
  "subtotal": 199.98,
  "shippingCost": 10.00,
  "discount": 0,
  "totalAmount": 209.98,
  "deliveryAddress": "123 Main St",
  "deliveryCity": "New York",
  "deliveryState": "NY",
  "deliveryZipCode": "10001",
  "deliveryArea": "Manhattan",
  "notes": "Please deliver before 5 PM",
  "estimatedDelivery": "2025-10-14T17:00:00.000Z"
}
```

**Validation Rules:**
- `customerId`: Required, must exist
- `orderItems`: Required, array with at least one item
- `orderItems[].productId`: Required, must exist
- `orderItems[].quantity`: Required, positive integer
- `orderItems[].unitPrice`: Required, positive number
- `totalAmount`: Required, must match calculated total

**Response (201 Created):**
```json
{
  "order": {
    "id": "clxorder9876543",
    "orderNumber": "ORD-20251012-0042",
    "status": "pending_confirmation",
    "totalAmount": 209.98,
    "createdAt": "2025-10-12T16:30:00.000Z"
  }
}
```

---

### POST /api/orders/bulk

Bulk import orders (for webhook integration).

**Authentication:** Required
**Authorization:** super_admin, admin, manager

**Request Body:**
```json
{
  "orders": [
    {
      "externalOrderId": "SHOP-12345",
      "customerId": "clxcust1234567",
      "orderItems": [...],
      "totalAmount": 209.98,
      ...
    }
  ]
}
```

**Response (200 OK):**
```json
{
  "results": {
    "created": 10,
    "failed": 2,
    "errors": [
      {
        "externalOrderId": "SHOP-12346",
        "error": "Customer not found"
      }
    ]
  }
}
```

---

### GET /api/orders/kanban

Get orders organized by status for Kanban board view.

**Authentication:** Required
**Authorization:** All roles

**Query Parameters:**
- `area` (string): Filter by delivery area
- `agentId` (string): Filter by assigned agent

**Response (200 OK):**
```json
{
  "kanban": {
    "pending_confirmation": [
      {
        "id": "clxorder1234567",
        "orderNumber": "ORD-20251012-0001",
        "customerName": "Michael Johnson",
        "totalAmount": 209.99,
        "deliveryArea": "Manhattan",
        "createdAt": "2025-10-12T10:00:00.000Z"
      }
    ],
    "confirmed": [...],
    "preparing": [...],
    "ready_for_pickup": [...],
    "out_for_delivery": [...],
    "delivered": [...]
  }
}
```

---

### GET /api/orders/stats

Get order statistics for dashboard.

**Authentication:** Required
**Authorization:** All roles

**Query Parameters:**
- `startDate` (ISO date): Start date for metrics
- `endDate` (ISO date): End date for metrics

**Response (200 OK):**
```json
{
  "stats": {
    "totalOrders": 1247,
    "ordersByStatus": {
      "pending_confirmation": 45,
      "confirmed": 120,
      "preparing": 78,
      "ready_for_pickup": 34,
      "out_for_delivery": 89,
      "delivered": 850,
      "cancelled": 31
    },
    "totalRevenue": 125000.50,
    "averageOrderValue": 100.24,
    "codCollections": {
      "pending": 15000.00,
      "collected": 95000.00,
      "reconciled": 80000.00
    }
  }
}
```

---

### GET /api/orders/:id

Get order details by ID with full relations.

**Authentication:** Required
**Authorization:** All roles

**Response (200 OK):**
```json
{
  "order": {
    "id": "clxorder1234567",
    "orderNumber": "ORD-20251012-0001",
    "customerId": "clxcust1234567",
    "customerRepId": "clxuser1234567",
    "deliveryAgentId": null,
    "status": "pending_confirmation",
    "paymentStatus": "pending",
    "subtotal": 199.99,
    "shippingCost": 10.00,
    "discount": 0,
    "totalAmount": 209.99,
    "codAmount": 209.99,
    "notes": "Please deliver before 5 PM",
    "internalNotes": "",
    "deliveryAddress": "123 Main St",
    "deliveryCity": "New York",
    "deliveryState": "NY",
    "deliveryZipCode": "10001",
    "deliveryArea": "Manhattan",
    "estimatedDelivery": "2025-10-14T00:00:00.000Z",
    "priority": 0,
    "tags": ["urgent"],
    "source": "manual",
    "externalOrderId": null,
    "webhookData": null,
    "createdById": "clxuser1234567",
    "createdAt": "2025-10-12T10:00:00.000Z",
    "updatedAt": "2025-10-12T10:00:00.000Z",
    "customer": {
      "id": "clxcust1234567",
      "firstName": "Michael",
      "lastName": "Johnson",
      "email": "michael@example.com",
      "phoneNumber": "+1234567890"
    },
    "customerRep": {
      "id": "clxuser1234567",
      "firstName": "John",
      "lastName": "Doe"
    },
    "orderItems": [
      {
        "id": "clxitem1234567",
        "productId": "clxprod1234567",
        "quantity": 2,
        "unitPrice": 99.99,
        "totalPrice": 199.98,
        "product": {
          "id": "clxprod1234567",
          "sku": "PROD-001",
          "name": "Wireless Headphones",
          "imageUrl": "https://example.com/products/headphones.jpg"
        }
      }
    ],
    "orderHistory": [
      {
        "id": "clxhist1234567",
        "status": "pending_confirmation",
        "notes": "Order created",
        "changedBy": "clxuser1234567",
        "createdAt": "2025-10-12T10:00:00.000Z"
      }
    ]
  }
}
```

**Errors:**
- `404 Not Found`: Order not found

---

### PUT /api/orders/:id

Update order information.

**Authentication:** Required
**Authorization:** All roles

**Request Body:**
```json
{
  "deliveryAddress": "456 Oak Ave",
  "notes": "Updated delivery instructions",
  "estimatedDelivery": "2025-10-15T00:00:00.000Z"
}
```

**Response (200 OK):**
```json
{
  "order": {
    "id": "clxorder1234567",
    "deliveryAddress": "456 Oak Ave",
    "notes": "Updated delivery instructions",
    "updatedAt": "2025-10-12T17:00:00.000Z"
  }
}
```

---

### DELETE /api/orders/:id

Cancel/delete an order.

**Authentication:** Required
**Authorization:** super_admin, admin, manager

**Response (200 OK):**
```json
{
  "message": "Order cancelled successfully",
  "order": {
    "id": "clxorder1234567",
    "status": "cancelled"
  }
}
```

---

### PATCH /api/orders/:id/status

Update order status with history tracking.

**Authentication:** Required
**Authorization:** All roles

**Request Body:**
```json
{
  "status": "confirmed",
  "notes": "Payment verified and order confirmed"
}
```

**Valid Status Transitions:**
```
pending_confirmation → confirmed, cancelled
confirmed → preparing, cancelled
preparing → ready_for_pickup, cancelled
ready_for_pickup → out_for_delivery
out_for_delivery → delivered, failed_delivery
delivered → (terminal)
cancelled → (terminal)
returned → (terminal)
failed_delivery → out_for_delivery, cancelled
```

**Response (200 OK):**
```json
{
  "order": {
    "id": "clxorder1234567",
    "status": "confirmed",
    "updatedAt": "2025-10-12T17:30:00.000Z"
  }
}
```

**Errors:**
- `400 Bad Request`: Invalid status transition

---

### PATCH /api/orders/:id/assign-rep

Assign a customer representative to an order.

**Authentication:** Required
**Authorization:** super_admin, admin, manager

**Request Body:**
```json
{
  "customerRepId": "clxuser1234567"
}
```

**Response (200 OK):**
```json
{
  "order": {
    "id": "clxorder1234567",
    "customerRepId": "clxuser1234567",
    "updatedAt": "2025-10-12T18:00:00.000Z"
  }
}
```

---

### PATCH /api/orders/:id/assign-agent

Assign a delivery agent to an order.

**Authentication:** Required
**Authorization:** super_admin, admin, manager

**Request Body:**
```json
{
  "deliveryAgentId": "clxagent1234567"
}
```

**Response (200 OK):**
```json
{
  "order": {
    "id": "clxorder1234567",
    "deliveryAgentId": "clxagent1234567",
    "updatedAt": "2025-10-12T18:30:00.000Z"
  }
}
```

---

## Delivery Endpoints

### GET /api/deliveries

List all deliveries with filtering.

**Authentication:** Required
**Authorization:** All roles

**Query Parameters:**
- `page` (number): Page number
- `limit` (number): Items per page
- `agentId` (string): Filter by agent
- `startDate` (ISO date): Filter deliveries after date
- `endDate` (ISO date): Filter deliveries before date

**Response (200 OK):**
```json
{
  "deliveries": [
    {
      "id": "clxdel1234567",
      "orderId": "clxorder1234567",
      "agentId": "clxagent1234567",
      "scheduledTime": "2025-10-14T10:00:00.000Z",
      "actualDeliveryTime": null,
      "proofType": null,
      "deliveryAttempts": 0,
      "createdAt": "2025-10-12T19:00:00.000Z"
    }
  ],
  "pagination": {
    "total": 89,
    "page": 1,
    "limit": 20,
    "totalPages": 5
  }
}
```

---

### GET /api/deliveries/routes/:agentId

Get delivery route for a specific agent.

**Authentication:** Required
**Authorization:** All roles

**Query Parameters:**
- `date` (ISO date): Date for route (default: today)

**Response (200 OK):**
```json
{
  "agent": {
    "id": "clxagent1234567",
    "firstName": "Jane",
    "lastName": "Smith"
  },
  "date": "2025-10-14",
  "deliveries": [
    {
      "id": "clxdel1234567",
      "orderId": "clxorder1234567",
      "orderNumber": "ORD-20251012-0001",
      "scheduledTime": "2025-10-14T10:00:00.000Z",
      "deliveryAddress": "123 Main St",
      "deliveryArea": "Manhattan",
      "customerName": "Michael Johnson",
      "customerPhone": "+1234567890",
      "codAmount": 209.99,
      "status": "pending"
    }
  ],
  "summary": {
    "totalDeliveries": 12,
    "completed": 0,
    "pending": 12,
    "totalCOD": 2519.88
  }
}
```

---

### GET /api/deliveries/:id

Get delivery details by ID.

**Authentication:** Required
**Authorization:** All roles

**Response (200 OK):**
```json
{
  "delivery": {
    "id": "clxdel1234567",
    "orderId": "clxorder1234567",
    "agentId": "clxagent1234567",
    "scheduledTime": "2025-10-14T10:00:00.000Z",
    "actualDeliveryTime": null,
    "proofType": null,
    "proofData": null,
    "proofImageUrl": null,
    "recipientName": null,
    "recipientPhone": null,
    "notes": null,
    "deliveryAttempts": 0,
    "route": null,
    "createdAt": "2025-10-12T19:00:00.000Z",
    "order": {
      "orderNumber": "ORD-20251012-0001",
      "deliveryAddress": "123 Main St",
      "customerName": "Michael Johnson"
    }
  }
}
```

---

### PATCH /api/deliveries/:id/proof

Upload proof of delivery.

**Authentication:** Required
**Authorization:** delivery_agent, super_admin, admin

**Request Body:**
```json
{
  "proofType": "signature",
  "proofData": "base64_signature_data",
  "proofImageUrl": "https://storage.example.com/proof/img123.jpg",
  "recipientName": "Michael Johnson",
  "recipientPhone": "+1234567890",
  "notes": "Delivered to customer directly"
}
```

**Proof Types:**
- `signature`: Digital signature
- `photo`: Photo of delivered package
- `otp`: One-time password verification

**Response (200 OK):**
```json
{
  "delivery": {
    "id": "clxdel1234567",
    "proofType": "signature",
    "proofImageUrl": "https://storage.example.com/proof/img123.jpg",
    "recipientName": "Michael Johnson",
    "updatedAt": "2025-10-14T15:30:00.000Z"
  }
}
```

---

### PATCH /api/deliveries/:id/complete

Mark delivery as complete.

**Authentication:** Required
**Authorization:** delivery_agent, super_admin, admin

**Request Body:**
```json
{
  "actualDeliveryTime": "2025-10-14T15:30:00.000Z",
  "notes": "Package delivered successfully"
}
```

**Response (200 OK):**
```json
{
  "delivery": {
    "id": "clxdel1234567",
    "actualDeliveryTime": "2025-10-14T15:30:00.000Z",
    "notes": "Package delivered successfully",
    "updatedAt": "2025-10-14T15:30:00.000Z"
  },
  "order": {
    "id": "clxorder1234567",
    "status": "delivered"
  }
}
```

---

## Financial Endpoints

### GET /api/financial/summary

Get financial summary and dashboard metrics.

**Authentication:** Required
**Authorization:** super_admin, admin, manager, accountant

**Query Parameters:**
- `startDate` (ISO date): Start date
- `endDate` (ISO date): End date

**Response (200 OK):**
```json
{
  "summary": {
    "totalRevenue": 125000.50,
    "totalExpenses": 45000.00,
    "netProfit": 80000.50,
    "codCollections": {
      "pending": 15000.00,
      "collected": 95000.00,
      "deposited": 80000.00,
      "reconciled": 75000.00
    },
    "orderRevenue": {
      "today": 5000.00,
      "thisWeek": 25000.00,
      "thisMonth": 95000.00
    }
  }
}
```

---

### GET /api/financial/transactions

List all financial transactions.

**Authentication:** Required
**Authorization:** super_admin, admin, accountant

**Query Parameters:**
- `page` (number): Page number
- `limit` (number): Items per page
- `type` (string): Filter by transaction type
- `status` (PaymentStatus): Filter by status
- `startDate` (ISO date): Filter after date
- `endDate` (ISO date): Filter before date

**Response (200 OK):**
```json
{
  "transactions": [
    {
      "id": "clxtxn1234567",
      "orderId": "clxorder1234567",
      "type": "cod_collection",
      "amount": 209.99,
      "paymentMethod": "cash",
      "status": "collected",
      "reference": "COD-001",
      "description": "COD payment for ORD-20251012-0001",
      "createdAt": "2025-10-14T15:30:00.000Z"
    }
  ],
  "pagination": {
    "total": 456,
    "page": 1,
    "limit": 20,
    "totalPages": 23
  }
}
```

---

### POST /api/financial/expenses

Record a new expense.

**Authentication:** Required
**Authorization:** super_admin, admin, accountant

**Request Body:**
```json
{
  "category": "fuel",
  "amount": 50.00,
  "description": "Fuel expense for delivery vehicle",
  "receiptUrl": "https://storage.example.com/receipts/receipt123.jpg",
  "expenseDate": "2025-10-14T00:00:00.000Z"
}
```

**Expense Categories:**
- `fuel`: Vehicle fuel costs
- `maintenance`: Vehicle maintenance
- `salary`: Staff salaries
- `rent`: Office/warehouse rent
- `utilities`: Utilities and services
- `supplies`: Office and operational supplies
- `marketing`: Marketing and advertising
- `other`: Other expenses

**Response (201 Created):**
```json
{
  "expense": {
    "id": "clxexp1234567",
    "category": "fuel",
    "amount": 50.00,
    "description": "Fuel expense for delivery vehicle",
    "expenseDate": "2025-10-14T00:00:00.000Z",
    "recordedBy": "clxuser1234567",
    "createdAt": "2025-10-14T16:00:00.000Z"
  }
}
```

---

### GET /api/financial/cod-collections

List COD collections with agent details.

**Authentication:** Required
**Authorization:** super_admin, admin, accountant

**Query Parameters:**
- `page` (number): Page number
- `limit` (number): Items per page
- `agentId` (string): Filter by agent
- `status` (PaymentStatus): Filter by status
- `startDate` (ISO date): Filter after date
- `endDate` (ISO date): Filter before date

**Response (200 OK):**
```json
{
  "collections": [
    {
      "agentId": "clxagent1234567",
      "agentName": "Jane Smith",
      "pending": 1500.00,
      "collected": 8500.00,
      "deposited": 7000.00,
      "reconciled": 6500.00,
      "orders": [
        {
          "orderId": "clxorder1234567",
          "orderNumber": "ORD-20251012-0001",
          "amount": 209.99,
          "status": "collected",
          "collectionDate": "2025-10-14T15:30:00.000Z"
        }
      ]
    }
  ],
  "summary": {
    "totalPending": 15000.00,
    "totalCollected": 95000.00,
    "totalDeposited": 80000.00,
    "totalReconciled": 75000.00
  },
  "pagination": {
    "total": 12,
    "page": 1,
    "limit": 20,
    "totalPages": 1
  }
}
```

---

### GET /api/financial/reports

Generate financial reports.

**Authentication:** Required
**Authorization:** super_admin, admin, manager, accountant

**Query Parameters:**
- `reportType` (string): Type of report (revenue, expenses, profit, cod)
- `startDate` (ISO date): Start date
- `endDate` (ISO date): End date
- `groupBy` (string): Group by day/week/month

**Response (200 OK):**
```json
{
  "report": {
    "type": "revenue",
    "period": {
      "startDate": "2025-10-01T00:00:00.000Z",
      "endDate": "2025-10-14T23:59:59.999Z"
    },
    "data": [
      {
        "date": "2025-10-01",
        "revenue": 5000.00,
        "orders": 50
      },
      {
        "date": "2025-10-02",
        "revenue": 5500.00,
        "orders": 55
      }
    ],
    "summary": {
      "totalRevenue": 70000.00,
      "averageDaily": 5000.00,
      "totalOrders": 700
    }
  }
}
```

---

## Analytics Endpoints

### GET /api/analytics/dashboard

Get comprehensive dashboard analytics.

**Authentication:** Required
**Authorization:** All roles

**Query Parameters:**
- `startDate` (ISO date): Start date
- `endDate` (ISO date): End date

**Response (200 OK):**
```json
{
  "metrics": {
    "orders": {
      "total": 1247,
      "completed": 850,
      "pending": 366,
      "cancelled": 31,
      "growthRate": 15.5
    },
    "revenue": {
      "total": 125000.50,
      "averageOrderValue": 100.24,
      "growthRate": 22.3
    },
    "customers": {
      "total": 328,
      "new": 45,
      "returning": 283,
      "growthRate": 8.2
    },
    "deliveries": {
      "completed": 850,
      "onTime": 820,
      "delayed": 30,
      "onTimeRate": 96.47
    }
  },
  "charts": {
    "ordersByDay": [...],
    "revenueByDay": [...],
    "ordersByStatus": [...],
    "topProducts": [...],
    "topCustomers": [...]
  }
}
```

---

### GET /api/analytics/sales-trends

Get sales trend analysis.

**Authentication:** Required
**Authorization:** All roles

**Query Parameters:**
- `startDate` (ISO date): Start date
- `endDate` (ISO date): End date
- `groupBy` (string): Group by hour/day/week/month

**Response (200 OK):**
```json
{
  "trends": {
    "period": "month",
    "data": [
      {
        "period": "2025-09",
        "orders": 450,
        "revenue": 45000.00,
        "averageOrderValue": 100.00
      },
      {
        "period": "2025-10",
        "orders": 797,
        "revenue": 80000.50,
        "averageOrderValue": 100.38
      }
    ],
    "growth": {
      "orders": 77.11,
      "revenue": 77.78,
      "averageOrderValue": 0.38
    }
  }
}
```

---

### GET /api/analytics/conversion-funnel

Get order conversion funnel metrics.

**Authentication:** Required
**Authorization:** All roles

**Response (200 OK):**
```json
{
  "funnel": {
    "pending_confirmation": {
      "count": 500,
      "percentage": 100,
      "conversionRate": 90
    },
    "confirmed": {
      "count": 450,
      "percentage": 90,
      "conversionRate": 95.56
    },
    "preparing": {
      "count": 430,
      "percentage": 86,
      "conversionRate": 97.67
    },
    "ready_for_pickup": {
      "count": 420,
      "percentage": 84,
      "conversionRate": 98.81
    },
    "out_for_delivery": {
      "count": 415,
      "percentage": 83,
      "conversionRate": 97.59
    },
    "delivered": {
      "count": 405,
      "percentage": 81,
      "conversionRate": 100
    }
  },
  "overallConversionRate": 81.00
}
```

---

### GET /api/analytics/rep-performance

Get customer representative performance metrics.

**Authentication:** Required
**Authorization:** super_admin, admin, manager

**Query Parameters:**
- `startDate` (ISO date): Start date
- `endDate` (ISO date): End date

**Response (200 OK):**
```json
{
  "performance": [
    {
      "repId": "clxuser1234567",
      "repName": "John Doe",
      "totalOrders": 150,
      "completedOrders": 140,
      "cancelledOrders": 10,
      "averageHandlingTime": "2.5 hours",
      "conversionRate": 93.33,
      "customerSatisfaction": 4.5
    }
  ]
}
```

---

### GET /api/analytics/agent-performance

Get delivery agent performance metrics.

**Authentication:** Required
**Authorization:** super_admin, admin, manager

**Query Parameters:**
- `startDate` (ISO date): Start date
- `endDate` (ISO date): End date

**Response (200 OK):**
```json
{
  "performance": [
    {
      "agentId": "clxagent1234567",
      "agentName": "Jane Smith",
      "totalDeliveries": 200,
      "successfulDeliveries": 195,
      "failedDeliveries": 5,
      "averageDeliveryTime": "45 minutes",
      "onTimeDeliveries": 190,
      "onTimeRate": 95.00,
      "codCollected": 19500.00
    }
  ]
}
```

---

### GET /api/analytics/customer-insights

Get customer behavior and insights analytics.

**Authentication:** Required
**Authorization:** All roles

**Query Parameters:**
- `startDate` (ISO date): Start date
- `endDate` (ISO date): End date

**Response (200 OK):**
```json
{
  "insights": {
    "customerSegments": {
      "new": 45,
      "returning": 283,
      "vip": 25
    },
    "lifetimeValue": {
      "average": 381.10,
      "median": 250.00,
      "top10Percent": 2500.00
    },
    "retentionRate": 86.28,
    "churnRate": 13.72,
    "averageOrdersPerCustomer": 3.8,
    "topCustomers": [
      {
        "customerId": "clxcust1234567",
        "customerName": "Michael Johnson",
        "totalOrders": 25,
        "totalSpent": 5000.00,
        "lastOrderDate": "2025-10-12T00:00:00.000Z"
      }
    ],
    "customersByCity": [
      {
        "city": "New York",
        "customers": 150,
        "orders": 600
      }
    ]
  }
}
```

---

## Workflow Endpoints

### GET /api/workflows

List all workflow automation rules.

**Authentication:** Required
**Authorization:** All roles

**Query Parameters:**
- `isActive` (boolean): Filter by active status

**Response (200 OK):**
```json
{
  "workflows": [
    {
      "id": "clxwf1234567",
      "name": "Auto-confirm high-value orders",
      "description": "Automatically confirm orders over $500",
      "triggerType": "status_change",
      "triggerData": {
        "status": "pending_confirmation",
        "conditions": {
          "totalAmount": { "gte": 500 }
        }
      },
      "actions": [
        {
          "type": "update_order",
          "params": { "status": "confirmed" }
        },
        {
          "type": "send_sms",
          "params": { "template": "order_confirmed" }
        }
      ],
      "isActive": true,
      "createdAt": "2025-09-01T00:00:00.000Z"
    }
  ]
}
```

---

### POST /api/workflows

Create a new workflow automation rule.

**Authentication:** Required
**Authorization:** super_admin, admin

**Request Body:**
```json
{
  "name": "Auto-assign delivery agent",
  "description": "Automatically assign available agent based on delivery area",
  "triggerType": "status_change",
  "triggerData": {
    "status": "ready_for_pickup"
  },
  "actions": [
    {
      "type": "assign_agent",
      "params": {
        "strategy": "least_busy",
        "areaMatching": true
      }
    }
  ],
  "conditions": {
    "deliveryArea": { "in": ["Manhattan", "Brooklyn", "Queens"] }
  },
  "isActive": true
}
```

**Trigger Types:**
- `webhook`: External webhook trigger
- `status_change`: Order status change
- `time_based`: Scheduled/cron trigger
- `manual`: Manually triggered

**Action Types:**
- `send_sms`: Send SMS notification
- `send_email`: Send email notification
- `update_order`: Update order fields
- `assign_agent`: Assign delivery agent
- `add_tag`: Add tag to order
- `wait`: Wait for specified duration
- `http_request`: Make HTTP request to external service

**Response (201 Created):**
```json
{
  "workflow": {
    "id": "clxwf9876543",
    "name": "Auto-assign delivery agent",
    "isActive": true,
    "createdAt": "2025-10-14T18:00:00.000Z"
  }
}
```

---

### GET /api/workflows/:id

Get workflow details by ID.

**Authentication:** Required
**Authorization:** All roles

**Response (200 OK):**
```json
{
  "workflow": {
    "id": "clxwf1234567",
    "name": "Auto-confirm high-value orders",
    "description": "Automatically confirm orders over $500",
    "triggerType": "status_change",
    "triggerData": {...},
    "actions": [...],
    "conditions": {...},
    "isActive": true,
    "createdAt": "2025-09-01T00:00:00.000Z",
    "updatedAt": "2025-10-01T00:00:00.000Z"
  }
}
```

---

### PUT /api/workflows/:id

Update workflow automation rule.

**Authentication:** Required
**Authorization:** super_admin, admin

**Request Body:**
```json
{
  "isActive": false,
  "description": "Updated description"
}
```

**Response (200 OK):**
```json
{
  "workflow": {
    "id": "clxwf1234567",
    "isActive": false,
    "description": "Updated description",
    "updatedAt": "2025-10-14T18:30:00.000Z"
  }
}
```

---

### DELETE /api/workflows/:id

Delete a workflow automation rule.

**Authentication:** Required
**Authorization:** super_admin, admin

**Response (200 OK):**
```json
{
  "message": "Workflow deleted successfully"
}
```

---

### POST /api/workflows/:id/execute

Manually execute a workflow.

**Authentication:** Required
**Authorization:** All roles

**Request Body:**
```json
{
  "orderId": "clxorder1234567",
  "input": {
    "customData": "value"
  }
}
```

**Response (200 OK):**
```json
{
  "execution": {
    "id": "clxexec1234567",
    "workflowId": "clxwf1234567",
    "status": "completed",
    "output": {
      "actionsExecuted": 2,
      "results": [...]
    },
    "startedAt": "2025-10-14T19:00:00.000Z",
    "completedAt": "2025-10-14T19:00:05.000Z"
  }
}
```

---

### GET /api/workflows/:id/executions

Get execution history for a workflow.

**Authentication:** Required
**Authorization:** All roles

**Query Parameters:**
- `page` (number): Page number
- `limit` (number): Items per page
- `status` (string): Filter by execution status

**Response (200 OK):**
```json
{
  "executions": [
    {
      "id": "clxexec1234567",
      "workflowId": "clxwf1234567",
      "status": "completed",
      "input": {...},
      "output": {...},
      "error": null,
      "startedAt": "2025-10-14T19:00:00.000Z",
      "completedAt": "2025-10-14T19:00:05.000Z"
    }
  ],
  "pagination": {
    "total": 125,
    "page": 1,
    "limit": 20,
    "totalPages": 7
  }
}
```

---

## Webhook Endpoints

### POST /api/webhooks/import

Import orders via webhook from external platforms (Shopify, WooCommerce, etc.).

**Authentication:** Not required (uses webhook secret verification)

**Headers:**
```http
X-Webhook-Signature: sha256=<hmac_signature>
X-Webhook-Source: shopify|woocommerce|custom
```

**Request Body:**
```json
{
  "orders": [
    {
      "externalOrderId": "SHOP-12345",
      "customer": {
        "email": "customer@example.com",
        "firstName": "John",
        "lastName": "Doe",
        "phone": "+1234567890",
        "address": "123 Main St",
        "city": "New York",
        "state": "NY",
        "zipCode": "10001"
      },
      "items": [
        {
          "sku": "PROD-001",
          "quantity": 2,
          "price": 99.99
        }
      ],
      "totalAmount": 209.98,
      "metadata": {...}
    }
  ]
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "imported": 1,
  "failed": 0,
  "orders": [
    {
      "externalOrderId": "SHOP-12345",
      "internalOrderId": "clxorder1234567",
      "orderNumber": "ORD-20251014-0001"
    }
  ]
}
```

**Errors:**
- `400 Bad Request`: Invalid signature
- `400 Bad Request`: Invalid payload format

---

### GET /api/webhooks

List configured webhook endpoints (for outgoing webhooks).

**Authentication:** Required
**Authorization:** super_admin, admin

**Response (200 OK):**
```json
{
  "webhooks": [
    {
      "id": "clxwebhook1234567",
      "name": "Order Status Notifications",
      "url": "https://example.com/webhooks/orders",
      "secret": "whsec_***",
      "apiKey": "api_key_***",
      "isActive": true,
      "fieldMapping": {...},
      "createdAt": "2025-09-01T00:00:00.000Z"
    }
  ]
}
```

---

### POST /api/webhooks

Create a new outgoing webhook configuration.

**Authentication:** Required
**Authorization:** super_admin, admin

**Request Body:**
```json
{
  "name": "Shopify Order Updates",
  "url": "https://myshop.myshopify.com/admin/api/webhooks",
  "secret": "webhook_secret_key",
  "apiKey": "api_key_optional",
  "fieldMapping": {
    "orderId": "id",
    "orderNumber": "order_number",
    "status": "status"
  },
  "headers": {
    "X-Custom-Header": "value"
  },
  "isActive": true
}
```

**Response (201 Created):**
```json
{
  "webhook": {
    "id": "clxwebhook9876543",
    "name": "Shopify Order Updates",
    "url": "https://myshop.myshopify.com/admin/api/webhooks",
    "isActive": true,
    "createdAt": "2025-10-14T20:00:00.000Z"
  }
}
```

---

### GET /api/webhooks/:id

Get webhook configuration details.

**Authentication:** Required
**Authorization:** super_admin, admin

**Response (200 OK):**
```json
{
  "webhook": {
    "id": "clxwebhook1234567",
    "name": "Order Status Notifications",
    "url": "https://example.com/webhooks/orders",
    "secret": "whsec_***",
    "apiKey": "api_key_***",
    "isActive": true,
    "fieldMapping": {...},
    "headers": {...},
    "createdAt": "2025-09-01T00:00:00.000Z",
    "updatedAt": "2025-10-01T00:00:00.000Z"
  }
}
```

---

### PUT /api/webhooks/:id

Update webhook configuration.

**Authentication:** Required
**Authorization:** super_admin, admin

**Request Body:**
```json
{
  "isActive": false,
  "url": "https://newurl.example.com/webhooks"
}
```

**Response (200 OK):**
```json
{
  "webhook": {
    "id": "clxwebhook1234567",
    "isActive": false,
    "url": "https://newurl.example.com/webhooks",
    "updatedAt": "2025-10-14T20:30:00.000Z"
  }
}
```

---

### DELETE /api/webhooks/:id

Delete a webhook configuration.

**Authentication:** Required
**Authorization:** super_admin, admin

**Response (200 OK):**
```json
{
  "message": "Webhook deleted successfully"
}
```

---

### GET /api/webhooks/:id/logs

Get webhook execution logs.

**Authentication:** Required
**Authorization:** super_admin, admin

**Query Parameters:**
- `page` (number): Page number
- `limit` (number): Items per page
- `success` (boolean): Filter by success/failure

**Response (200 OK):**
```json
{
  "logs": [
    {
      "id": "clxlog1234567",
      "webhookConfigId": "clxwebhook1234567",
      "endpoint": "https://example.com/webhooks/orders",
      "method": "POST",
      "headers": {...},
      "body": {...},
      "response": {...},
      "statusCode": 200,
      "success": true,
      "errorMessage": null,
      "processedAt": "2025-10-14T21:00:00.000Z"
    }
  ],
  "pagination": {
    "total": 350,
    "page": 1,
    "limit": 20,
    "totalPages": 18
  }
}
```

---

### POST /api/webhooks/:id/test

Test a webhook configuration by sending a test payload.

**Authentication:** Required
**Authorization:** super_admin, admin

**Request Body:**
```json
{
  "testData": {
    "orderId": "clxorder1234567",
    "orderNumber": "ORD-20251014-0001",
    "status": "confirmed"
  }
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "statusCode": 200,
  "response": {
    "message": "Webhook received successfully"
  },
  "executionTime": "150ms"
}
```

---

## Notification Endpoints

### GET /api/notifications

List user notifications.

**Authentication:** Required
**Authorization:** All roles

**Query Parameters:**
- `page` (number): Page number
- `limit` (number): Items per page
- `isRead` (boolean): Filter by read status
- `type` (string): Filter by notification type

**Response (200 OK):**
```json
{
  "notifications": [
    {
      "id": "clxnotif1234567",
      "userId": "clxuser1234567",
      "type": "order_status_changed",
      "title": "Order Status Updated",
      "message": "Order ORD-20251014-0001 status changed to 'confirmed'",
      "data": {
        "orderId": "clxorder1234567",
        "orderNumber": "ORD-20251014-0001",
        "newStatus": "confirmed"
      },
      "isRead": false,
      "createdAt": "2025-10-14T22:00:00.000Z"
    }
  ],
  "pagination": {
    "total": 45,
    "page": 1,
    "limit": 20,
    "totalPages": 3
  }
}
```

---

### PATCH /api/notifications/:id/read

Mark a notification as read.

**Authentication:** Required
**Authorization:** All roles (own notifications only)

**Response (200 OK):**
```json
{
  "notification": {
    "id": "clxnotif1234567",
    "isRead": true,
    "updatedAt": "2025-10-14T22:30:00.000Z"
  }
}
```

---

### PATCH /api/notifications/read-all

Mark all notifications as read for the current user.

**Authentication:** Required
**Authorization:** All roles

**Response (200 OK):**
```json
{
  "message": "All notifications marked as read",
  "count": 12
}
```

---

## Error Handling

All endpoints follow consistent error response formats:

### Error Response Format

```json
{
  "error": "Error message describing what went wrong"
}
```

### HTTP Status Codes

| Status Code | Meaning | Description |
|-------------|---------|-------------|
| 200 | OK | Successful GET, PUT, PATCH, DELETE |
| 201 | Created | Successful POST (resource created) |
| 400 | Bad Request | Invalid request data or validation error |
| 401 | Unauthorized | Missing or invalid authentication token |
| 403 | Forbidden | Authenticated but insufficient permissions |
| 404 | Not Found | Resource not found |
| 409 | Conflict | Resource conflict (e.g., duplicate email) |
| 422 | Unprocessable Entity | Request well-formed but semantically invalid |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Server error (logged for debugging) |
| 503 | Service Unavailable | Service temporarily unavailable |

### Common Error Messages

**Validation Errors:**
```json
{
  "error": "Validation failed: Email is required"
}
```

**Authentication Errors:**
```json
{
  "error": "No token provided"
}
```

```json
{
  "error": "Invalid token"
}
```

**Authorization Errors:**
```json
{
  "error": "Forbidden: Insufficient permissions"
}
```

**Not Found Errors:**
```json
{
  "error": "Order not found"
}
```

**Rate Limit Errors:**
```json
{
  "error": "Too many requests, please try again later"
}
```

---

## Rate Limiting

The API implements rate limiting to prevent abuse and ensure fair usage.

### Rate Limit Rules

**Development Environment (`NODE_ENV=development`):**
- **API Requests:** 10,000 requests per 15 minutes
- **Auth Requests:** 1,000 requests per 15 minutes

**Production Environment (`NODE_ENV=production`):**
- **API Requests:** 100 requests per 15 minutes per IP
- **Auth Requests:** 5 requests per 15 minutes per IP
- **Webhook Requests:** 10 requests per minute per endpoint

### Rate Limit Headers

All responses include rate limit information in headers:

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1697472000
```

### Rate Limit Exceeded Response

```json
{
  "error": "Too many requests, please try again later"
}
```

**HTTP Status:** 429 Too Many Requests

### Best Practices

1. **Monitor rate limit headers** to avoid hitting limits
2. **Implement exponential backoff** when retrying failed requests
3. **Use webhooks** instead of polling for real-time updates
4. **Cache responses** when appropriate
5. **Contact support** for higher rate limits if needed

---

## WebSocket Events (Socket.io)

The backend emits real-time events via Socket.io for live updates.

### Connection

```javascript
const socket = io('http://localhost:3000', {
  auth: {
    token: 'your_jwt_token'
  }
});
```

### Events

#### order:created
Emitted when a new order is created.

```javascript
socket.on('order:created', (order) => {
  console.log('New order:', order);
});
```

#### order:updated
Emitted when an order is updated.

```javascript
socket.on('order:updated', (order) => {
  console.log('Order updated:', order);
});
```

#### order:status_changed
Emitted when an order status changes.

```javascript
socket.on('order:status_changed', ({ orderId, oldStatus, newStatus }) => {
  console.log('Order status changed:', orderId, oldStatus, newStatus);
});
```

#### delivery:updated
Emitted when a delivery is updated.

```javascript
socket.on('delivery:updated', (delivery) => {
  console.log('Delivery updated:', delivery);
});
```

---

## Additional Resources

- **User Guide:** [/docs/USER_GUIDE.md](/docs/USER_GUIDE.md)
- **Developer Guide:** [/docs/DEVELOPER_GUIDE.md](/docs/DEVELOPER_GUIDE.md)
- **Deployment Guide:** [/docs/DEPLOYMENT_GUIDE.md](/docs/DEPLOYMENT_GUIDE.md)
- **Security Guide:** [/docs/SECURITY_GUIDE.md](/docs/SECURITY_GUIDE.md)
- **Workflow Automation:** [/docs/WORKFLOW_AUTOMATION_GUIDE.md](/docs/WORKFLOW_AUTOMATION_GUIDE.md)
- **Webhook Integration:** [/docs/WEBHOOK_INTEGRATION_GUIDE.md](/docs/WEBHOOK_INTEGRATION_GUIDE.md)

---

## Support

For API support and questions:
- **Email:** api-support@example.com
- **Documentation:** https://docs.example.com
- **GitHub Issues:** https://github.com/yourusername/ecommerce-cod-admin/issues

---

**API Version:** 1.0.0
**Last Updated:** 2025-10-12
**Maintained by:** E-Commerce COD Admin Team
