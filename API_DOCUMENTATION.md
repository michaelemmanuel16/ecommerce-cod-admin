# API Documentation

Complete API reference for the E-Commerce COD Admin Dashboard.

## Table of Contents

- [Overview](#overview)
- [Authentication](#authentication)
- [Base URL](#base-url)
- [Common Headers](#common-headers)
- [Response Format](#response-format)
- [Error Codes](#error-codes)
- [Rate Limiting](#rate-limiting)
- [Pagination](#pagination)
- [Filtering & Sorting](#filtering--sorting)
- [Authentication Endpoints](#authentication-endpoints)
- [User Endpoints](#user-endpoints)
- [Order Endpoints](#order-endpoints)
- [Customer Endpoints](#customer-endpoints)
- [Product Endpoints](#product-endpoints)
- [Workflow Endpoints](#workflow-endpoints)
- [Webhook Endpoints](#webhook-endpoints)
- [Analytics Endpoints](#analytics-endpoints)
- [Settings Endpoints](#settings-endpoints)
- [Webhook Integration](#webhook-integration)
- [Code Examples](#code-examples)

## Overview

The E-Commerce COD Admin API is a RESTful API that provides access to all features of the platform. All endpoints return JSON responses and use standard HTTP methods.

### API Versioning

Current version: **v1**

API endpoints are prefixed with `/api` but not versioned in URL. Breaking changes will be announced via deprecation headers.

## Authentication

The API uses JWT (JSON Web Tokens) for authentication.

### Authentication Flow

```mermaid
sequenceDiagram
    participant C as Client
    participant A as Auth Endpoint
    participant S as Protected Resource
    
    C->>A: POST /auth/login<br/>{email, password}
    A->>C: {token, refreshToken, user}
    C->>S: GET /orders<br/>Authorization: Bearer {token}
    S->>C: {data}
    
    Note over C,S: When token expires
    C->>A: POST /auth/refresh<br/>{refreshToken}
    A->>C: {token, refreshToken}
```

### Getting a Token

**Request:**
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "email": "user@example.com",
      "name": "John Doe",
      "role": "ADMIN"
    }
  }
}
```

### Using the Token

Include the token in the `Authorization` header:

```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Token Expiration

- Access tokens expire after **7 days** (configurable)
- Refresh tokens expire after **30 days** (configurable)
- Use the refresh endpoint to get a new token before expiration

## Base URL

**Development:**
```
http://localhost:5000/api
```

**Production:**
```
https://api.yourdomain.com/api
```

## Common Headers

| Header | Required | Description |
|--------|----------|-------------|
| `Content-Type` | Yes | `application/json` for all POST/PUT/PATCH requests |
| `Authorization` | Yes* | `Bearer {token}` for authenticated endpoints |
| `Accept` | No | `application/json` (default) |
| `X-API-Key` | No | Alternative authentication for integrations |

*Not required for public endpoints like `/auth/login`

## Response Format

### Success Response

```json
{
  "success": true,
  "data": {
    // Response data
  },
  "meta": {
    "timestamp": "2025-10-08T10:30:00Z",
    "requestId": "req_123456"
  }
}
```

### Paginated Response

```json
{
  "success": true,
  "data": [...],
  "pagination": {
    "total": 150,
    "page": 1,
    "limit": 20,
    "totalPages": 8
  },
  "meta": {
    "timestamp": "2025-10-08T10:30:00Z"
  }
}
```

### Error Response

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [
      {
        "field": "email",
        "message": "Invalid email format"
      }
    ]
  },
  "meta": {
    "timestamp": "2025-10-08T10:30:00Z",
    "requestId": "req_123456"
  }
}
```

## Error Codes

| HTTP Status | Error Code | Description |
|-------------|------------|-------------|
| 400 | `VALIDATION_ERROR` | Request validation failed |
| 401 | `UNAUTHORIZED` | Authentication required or failed |
| 403 | `FORBIDDEN` | Insufficient permissions |
| 404 | `NOT_FOUND` | Resource not found |
| 409 | `CONFLICT` | Resource conflict (e.g., duplicate) |
| 429 | `RATE_LIMIT_EXCEEDED` | Too many requests |
| 500 | `INTERNAL_ERROR` | Server error |
| 503 | `SERVICE_UNAVAILABLE` | Service temporarily unavailable |

## Rate Limiting

- **Default**: 100 requests per 15 minutes per IP
- **Authenticated**: 1000 requests per 15 minutes per user
- **Webhook**: 10 requests per minute per endpoint

### Rate Limit Headers

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1696765800
```

### Rate Limit Exceeded Response

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests. Please try again later.",
    "retryAfter": 900
  }
}
```

## Pagination

All list endpoints support pagination using query parameters:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `page` | `1` | Page number (1-indexed) |
| `limit` | `20` | Items per page (max: 100) |
| `sort` | `createdAt` | Sort field |
| `order` | `desc` | Sort order (`asc` or `desc`) |

**Example:**
```http
GET /api/orders?page=2&limit=50&sort=totalAmount&order=desc
```

## Filtering & Sorting

### Filtering

Use query parameters for filtering:

```http
GET /api/orders?status=PENDING&customerId=abc123
```

### Advanced Filtering

Use operators for complex queries:

```http
GET /api/orders?totalAmount[gte]=100&totalAmount[lte]=500
```

**Supported Operators:**
- `eq` - Equal
- `ne` - Not equal
- `gt` - Greater than
- `gte` - Greater than or equal
- `lt` - Less than
- `lte` - Less than or equal
- `in` - In array
- `contains` - Contains (string)

### Date Filtering

```http
GET /api/orders?createdAt[gte]=2025-01-01&createdAt[lte]=2025-12-31
```

### Sorting

```http
GET /api/orders?sort=createdAt&order=desc
```

Multiple sorts:
```http
GET /api/orders?sort=status,createdAt&order=asc,desc
```

## Authentication Endpoints

### POST /api/auth/login

Authenticate a user and receive tokens.

**Request:**
```json
{
  "email": "admin@example.com",
  "password": "admin123"
}
```

**Response: 200 OK**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "email": "admin@example.com",
      "name": "Admin User",
      "role": "ADMIN",
      "createdAt": "2025-01-01T00:00:00Z"
    }
  }
}
```

**Errors:**
- `401 UNAUTHORIZED` - Invalid credentials
- `400 VALIDATION_ERROR` - Missing or invalid fields

---

### POST /api/auth/register

Register a new user (if registration is enabled).

**Request:**
```json
{
  "email": "newuser@example.com",
  "password": "securePassword123",
  "name": "New User",
  "role": "AGENT"
}
```

**Response: 201 Created**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "660e8400-e29b-41d4-a716-446655440001",
      "email": "newuser@example.com",
      "name": "New User",
      "role": "AGENT"
    }
  }
}
```

**Errors:**
- `409 CONFLICT` - Email already exists
- `400 VALIDATION_ERROR` - Invalid input
- `403 FORBIDDEN` - Registration disabled

---

### POST /api/auth/refresh

Refresh an expired access token.

**Request:**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response: 200 OK**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

---

### GET /api/auth/me

Get current authenticated user.

**Headers:**
```http
Authorization: Bearer {token}
```

**Response: 200 OK**
```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "admin@example.com",
    "name": "Admin User",
    "role": "ADMIN",
    "createdAt": "2025-01-01T00:00:00Z"
  }
}
```

---

### POST /api/auth/logout

Invalidate current token (optional - client can just discard token).

**Response: 200 OK**
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

## User Endpoints

### GET /api/users

List all users (Admin only).

**Query Parameters:**
- `page` - Page number
- `limit` - Items per page
- `role` - Filter by role
- `search` - Search by name or email

**Response: 200 OK**
```json
{
  "success": true,
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "email": "admin@example.com",
      "name": "Admin User",
      "role": "ADMIN",
      "createdAt": "2025-01-01T00:00:00Z"
    }
  ],
  "pagination": {
    "total": 10,
    "page": 1,
    "limit": 20,
    "totalPages": 1
  }
}
```

---

### GET /api/users/:id

Get user by ID.

**Response: 200 OK**
```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "admin@example.com",
    "name": "Admin User",
    "role": "ADMIN",
    "createdAt": "2025-01-01T00:00:00Z",
    "updatedAt": "2025-01-05T00:00:00Z"
  }
}
```

---

### POST /api/users

Create a new user (Admin only).

**Request:**
```json
{
  "email": "newagent@example.com",
  "password": "securePass123",
  "name": "Agent Smith",
  "role": "AGENT"
}
```

**Response: 201 Created**
```json
{
  "success": true,
  "data": {
    "id": "770e8400-e29b-41d4-a716-446655440002",
    "email": "newagent@example.com",
    "name": "Agent Smith",
    "role": "AGENT"
  }
}
```

---

### PUT /api/users/:id

Update user.

**Request:**
```json
{
  "name": "Agent John Smith",
  "role": "MANAGER"
}
```

**Response: 200 OK**
```json
{
  "success": true,
  "data": {
    "id": "770e8400-e29b-41d4-a716-446655440002",
    "email": "newagent@example.com",
    "name": "Agent John Smith",
    "role": "MANAGER"
  }
}
```

---

### DELETE /api/users/:id

Delete user (Admin only).

**Response: 200 OK**
```json
{
  "success": true,
  "message": "User deleted successfully"
}
```

## Order Endpoints

### GET /api/orders

List all orders with filtering and pagination.

**Query Parameters:**
- `page` - Page number (default: 1)
- `limit` - Items per page (default: 20, max: 100)
- `status` - Filter by status
- `customerId` - Filter by customer
- `startDate` - Filter orders after date
- `endDate` - Filter orders before date
- `search` - Search by order number or customer name
- `sort` - Sort field (default: createdAt)
- `order` - Sort order (asc/desc, default: desc)

**Response: 200 OK**
```json
{
  "success": true,
  "data": [
    {
      "id": "880e8400-e29b-41d4-a716-446655440003",
      "orderNumber": "ORD-2025-0001",
      "customerId": "990e8400-e29b-41d4-a716-446655440004",
      "status": "PENDING",
      "totalAmount": 299.99,
      "paymentMethod": "COD",
      "shippingAddress": {
        "street": "123 Main St",
        "city": "New York",
        "state": "NY",
        "zipCode": "10001",
        "country": "USA"
      },
      "customer": {
        "id": "990e8400-e29b-41d4-a716-446655440004",
        "name": "Jane Doe",
        "email": "jane@example.com",
        "phone": "+1234567890"
      },
      "items": [
        {
          "id": "aa0e8400-e29b-41d4-a716-446655440005",
          "productId": "bb0e8400-e29b-41d4-a716-446655440006",
          "product": {
            "name": "Product A",
            "sku": "PROD-A-001"
          },
          "quantity": 2,
          "price": 149.99,
          "total": 299.98
        }
      ],
      "notes": "Customer requested morning delivery",
      "createdAt": "2025-10-08T08:00:00Z",
      "updatedAt": "2025-10-08T09:00:00Z"
    }
  ],
  "pagination": {
    "total": 150,
    "page": 1,
    "limit": 20,
    "totalPages": 8
  }
}
```

---

### GET /api/orders/:id

Get order details by ID.

**Response: 200 OK**
```json
{
  "success": true,
  "data": {
    "id": "880e8400-e29b-41d4-a716-446655440003",
    "orderNumber": "ORD-2025-0001",
    "customerId": "990e8400-e29b-41d4-a716-446655440004",
    "status": "PENDING",
    "totalAmount": 299.99,
    "paymentMethod": "COD",
    "shippingAddress": {
      "street": "123 Main St",
      "city": "New York",
      "state": "NY",
      "zipCode": "10001",
      "country": "USA"
    },
    "customer": {
      "id": "990e8400-e29b-41d4-a716-446655440004",
      "name": "Jane Doe",
      "email": "jane@example.com",
      "phone": "+1234567890"
    },
    "items": [
      {
        "id": "aa0e8400-e29b-41d4-a716-446655440005",
        "productId": "bb0e8400-e29b-41d4-a716-446655440006",
        "product": {
          "id": "bb0e8400-e29b-41d4-a716-446655440006",
          "name": "Product A",
          "sku": "PROD-A-001",
          "price": 149.99,
          "imageUrl": "https://example.com/products/a.jpg"
        },
        "quantity": 2,
        "price": 149.99,
        "total": 299.98
      }
    ],
    "history": [
      {
        "id": "cc0e8400-e29b-41d4-a716-446655440007",
        "status": "PENDING",
        "note": "Order created",
        "createdBy": "system",
        "createdAt": "2025-10-08T08:00:00Z"
      }
    ],
    "notes": "Customer requested morning delivery",
    "createdAt": "2025-10-08T08:00:00Z",
    "updatedAt": "2025-10-08T09:00:00Z"
  }
}
```

---

### POST /api/orders

Create a new order.

**Request:**
```json
{
  "customerId": "990e8400-e29b-41d4-a716-446655440004",
  "items": [
    {
      "productId": "bb0e8400-e29b-41d4-a716-446655440006",
      "quantity": 2,
      "price": 149.99
    }
  ],
  "shippingAddress": {
    "street": "123 Main St",
    "city": "New York",
    "state": "NY",
    "zipCode": "10001",
    "country": "USA"
  },
  "paymentMethod": "COD",
  "notes": "Handle with care"
}
```

**Response: 201 Created**
```json
{
  "success": true,
  "data": {
    "id": "dd0e8400-e29b-41d4-a716-446655440008",
    "orderNumber": "ORD-2025-0002",
    "customerId": "990e8400-e29b-41d4-a716-446655440004",
    "status": "PENDING",
    "totalAmount": 299.98,
    "paymentMethod": "COD",
    "createdAt": "2025-10-08T10:00:00Z"
  }
}
```

---

### PUT /api/orders/:id

Update order details.

**Request:**
```json
{
  "shippingAddress": {
    "street": "456 Oak Ave",
    "city": "Boston",
    "state": "MA",
    "zipCode": "02101",
    "country": "USA"
  },
  "notes": "Updated delivery address"
}
```

**Response: 200 OK**
```json
{
  "success": true,
  "data": {
    "id": "880e8400-e29b-41d4-a716-446655440003",
    "orderNumber": "ORD-2025-0001",
    "shippingAddress": {
      "street": "456 Oak Ave",
      "city": "Boston",
      "state": "MA",
      "zipCode": "02101",
      "country": "USA"
    },
    "updatedAt": "2025-10-08T11:00:00Z"
  }
}
```

---

### PATCH /api/orders/:id/status

Update order status.

**Request:**
```json
{
  "status": "CONFIRMED",
  "note": "Payment verified, order confirmed"
}
```

**Response: 200 OK**
```json
{
  "success": true,
  "data": {
    "id": "880e8400-e29b-41d4-a716-446655440003",
    "orderNumber": "ORD-2025-0001",
    "status": "CONFIRMED",
    "updatedAt": "2025-10-08T11:30:00Z"
  }
}
```

**Valid Status Transitions:**
- `PENDING` → `CONFIRMED`, `CANCELLED`
- `CONFIRMED` → `PROCESSING`, `CANCELLED`
- `PROCESSING` → `SHIPPED`, `CANCELLED`
- `SHIPPED` → `DELIVERED`, `RETURNED`
- `DELIVERED` → `COMPLETED`, `RETURNED`

---

### PATCH /api/orders/bulk/status

Update status for multiple orders.

**Request:**
```json
{
  "orderIds": [
    "880e8400-e29b-41d4-a716-446655440003",
    "dd0e8400-e29b-41d4-a716-446655440008"
  ],
  "status": "CONFIRMED",
  "note": "Bulk confirmation"
}
```

**Response: 200 OK**
```json
{
  "success": true,
  "data": {
    "updated": 2,
    "failed": 0,
    "orders": [
      {
        "id": "880e8400-e29b-41d4-a716-446655440003",
        "status": "CONFIRMED"
      },
      {
        "id": "dd0e8400-e29b-41d4-a716-446655440008",
        "status": "CONFIRMED"
      }
    ]
  }
}
```

---

### DELETE /api/orders/:id

Delete an order (soft delete).

**Response: 200 OK**
```json
{
  "success": true,
  "message": "Order deleted successfully"
}
```

---

### GET /api/orders/:id/history

Get order status history.

**Response: 200 OK**
```json
{
  "success": true,
  "data": [
    {
      "id": "ee0e8400-e29b-41d4-a716-446655440009",
      "orderId": "880e8400-e29b-41d4-a716-446655440003",
      "status": "PENDING",
      "note": "Order created",
      "createdBy": "system",
      "createdAt": "2025-10-08T08:00:00Z"
    },
    {
      "id": "ff0e8400-e29b-41d4-a716-44665544000a",
      "orderId": "880e8400-e29b-41d4-a716-446655440003",
      "status": "CONFIRMED",
      "note": "Payment verified",
      "createdBy": "admin@example.com",
      "createdAt": "2025-10-08T09:00:00Z"
    }
  ]
}
```

## Customer Endpoints

### GET /api/customers

List all customers.

**Query Parameters:**
- `page` - Page number
- `limit` - Items per page
- `search` - Search by name, email, or phone
- `city` - Filter by city
- `country` - Filter by country

**Response: 200 OK**
```json
{
  "success": true,
  "data": [
    {
      "id": "990e8400-e29b-41d4-a716-446655440004",
      "name": "Jane Doe",
      "email": "jane@example.com",
      "phone": "+1234567890",
      "address": "123 Main St",
      "city": "New York",
      "state": "NY",
      "zipCode": "10001",
      "country": "USA",
      "totalOrders": 5,
      "totalSpent": 1499.95,
      "createdAt": "2025-01-15T00:00:00Z"
    }
  ],
  "pagination": {
    "total": 50,
    "page": 1,
    "limit": 20,
    "totalPages": 3
  }
}
```

---

### GET /api/customers/:id

Get customer details.

**Response: 200 OK**
```json
{
  "success": true,
  "data": {
    "id": "990e8400-e29b-41d4-a716-446655440004",
    "name": "Jane Doe",
    "email": "jane@example.com",
    "phone": "+1234567890",
    "address": "123 Main St",
    "city": "New York",
    "state": "NY",
    "zipCode": "10001",
    "country": "USA",
    "totalOrders": 5,
    "totalSpent": 1499.95,
    "averageOrderValue": 299.99,
    "lastOrderDate": "2025-10-08T08:00:00Z",
    "createdAt": "2025-01-15T00:00:00Z",
    "updatedAt": "2025-10-08T08:00:00Z"
  }
}
```

---

### POST /api/customers

Create a new customer.

**Request:**
```json
{
  "name": "John Smith",
  "email": "john@example.com",
  "phone": "+1234567891",
  "address": "456 Oak Ave",
  "city": "Boston",
  "state": "MA",
  "zipCode": "02101",
  "country": "USA"
}
```

**Response: 201 Created**
```json
{
  "success": true,
  "data": {
    "id": "110e8400-e29b-41d4-a716-44665544000b",
    "name": "John Smith",
    "email": "john@example.com",
    "phone": "+1234567891",
    "createdAt": "2025-10-08T12:00:00Z"
  }
}
```

---

### PUT /api/customers/:id

Update customer information.

**Request:**
```json
{
  "name": "John Robert Smith",
  "phone": "+1234567892"
}
```

**Response: 200 OK**
```json
{
  "success": true,
  "data": {
    "id": "110e8400-e29b-41d4-a716-44665544000b",
    "name": "John Robert Smith",
    "phone": "+1234567892",
    "updatedAt": "2025-10-08T13:00:00Z"
  }
}
```

---

### DELETE /api/customers/:id

Delete a customer.

**Response: 200 OK**
```json
{
  "success": true,
  "message": "Customer deleted successfully"
}
```

---

### GET /api/customers/:id/orders

Get all orders for a customer.

**Response: 200 OK**
```json
{
  "success": true,
  "data": [
    {
      "id": "880e8400-e29b-41d4-a716-446655440003",
      "orderNumber": "ORD-2025-0001",
      "status": "CONFIRMED",
      "totalAmount": 299.99,
      "createdAt": "2025-10-08T08:00:00Z"
    }
  ],
  "pagination": {
    "total": 5,
    "page": 1,
    "limit": 20,
    "totalPages": 1
  }
}
```

## Product Endpoints

### GET /api/products

List all products.

**Query Parameters:**
- `page` - Page number
- `limit` - Items per page
- `search` - Search by name or SKU
- `category` - Filter by category
- `inStock` - Filter by stock status (true/false)

**Response: 200 OK**
```json
{
  "success": true,
  "data": [
    {
      "id": "bb0e8400-e29b-41d4-a716-446655440006",
      "name": "Product A",
      "sku": "PROD-A-001",
      "description": "High-quality product",
      "price": 149.99,
      "stock": 50,
      "category": "Electronics",
      "imageUrl": "https://example.com/products/a.jpg",
      "createdAt": "2025-01-01T00:00:00Z"
    }
  ],
  "pagination": {
    "total": 100,
    "page": 1,
    "limit": 20,
    "totalPages": 5
  }
}
```

---

### GET /api/products/:id

Get product details.

**Response: 200 OK**
```json
{
  "success": true,
  "data": {
    "id": "bb0e8400-e29b-41d4-a716-446655440006",
    "name": "Product A",
    "sku": "PROD-A-001",
    "description": "High-quality electronic product with advanced features",
    "price": 149.99,
    "stock": 50,
    "category": "Electronics",
    "imageUrl": "https://example.com/products/a.jpg",
    "variants": [
      {
        "id": "var-001",
        "name": "Color",
        "options": ["Black", "White", "Blue"]
      }
    ],
    "totalSold": 150,
    "rating": 4.5,
    "reviews": 45,
    "createdAt": "2025-01-01T00:00:00Z",
    "updatedAt": "2025-10-08T00:00:00Z"
  }
}
```

---

### POST /api/products

Create a new product.

**Request:**
```json
{
  "name": "Product B",
  "sku": "PROD-B-001",
  "description": "Amazing new product",
  "price": 199.99,
  "stock": 100,
  "category": "Electronics",
  "imageUrl": "https://example.com/products/b.jpg"
}
```

**Response: 201 Created**
```json
{
  "success": true,
  "data": {
    "id": "120e8400-e29b-41d4-a716-44665544000c",
    "name": "Product B",
    "sku": "PROD-B-001",
    "price": 199.99,
    "stock": 100,
    "createdAt": "2025-10-08T14:00:00Z"
  }
}
```

---

### PUT /api/products/:id

Update product information.

**Request:**
```json
{
  "price": 179.99,
  "stock": 75
}
```

**Response: 200 OK**
```json
{
  "success": true,
  "data": {
    "id": "120e8400-e29b-41d4-a716-44665544000c",
    "name": "Product B",
    "price": 179.99,
    "stock": 75,
    "updatedAt": "2025-10-08T15:00:00Z"
  }
}
```

---

### DELETE /api/products/:id

Delete a product.

**Response: 200 OK**
```json
{
  "success": true,
  "message": "Product deleted successfully"
}
```

## Workflow Endpoints

### GET /api/workflows

List all workflow automation rules.

**Response: 200 OK**
```json
{
  "success": true,
  "data": [
    {
      "id": "130e8400-e29b-41d4-a716-44665544000d",
      "name": "Auto-confirm high-value orders",
      "description": "Automatically confirm orders over $1000",
      "trigger": "order.created",
      "conditions": {
        "totalAmount": { "gte": 1000 }
      },
      "actions": [
        {
          "type": "updateStatus",
          "params": { "status": "CONFIRMED" }
        },
        {
          "type": "sendEmail",
          "params": { "template": "high-value-order" }
        }
      ],
      "enabled": true,
      "createdAt": "2025-01-01T00:00:00Z"
    }
  ]
}
```

---

### POST /api/workflows

Create a workflow rule.

**Request:**
```json
{
  "name": "Auto-assign to agent",
  "description": "Assign new orders to available agents",
  "trigger": "order.created",
  "conditions": {
    "status": "PENDING"
  },
  "actions": [
    {
      "type": "assignUser",
      "params": { "strategy": "round-robin" }
    }
  ],
  "enabled": true
}
```

**Response: 201 Created**
```json
{
  "success": true,
  "data": {
    "id": "140e8400-e29b-41d4-a716-44665544000e",
    "name": "Auto-assign to agent",
    "enabled": true,
    "createdAt": "2025-10-08T16:00:00Z"
  }
}
```

---

### PUT /api/workflows/:id

Update workflow rule.

**Request:**
```json
{
  "enabled": false
}
```

**Response: 200 OK**
```json
{
  "success": true,
  "data": {
    "id": "140e8400-e29b-41d4-a716-44665544000e",
    "enabled": false,
    "updatedAt": "2025-10-08T17:00:00Z"
  }
}
```

---

### DELETE /api/workflows/:id

Delete workflow rule.

**Response: 200 OK**
```json
{
  "success": true,
  "message": "Workflow deleted successfully"
}
```

## Webhook Endpoints

### GET /api/webhooks

List configured webhooks.

**Response: 200 OK**
```json
{
  "success": true,
  "data": [
    {
      "id": "150e8400-e29b-41d4-a716-44665544000f",
      "name": "Shopify Orders",
      "url": "https://yourstore.myshopify.com/admin/api/2024-01/webhooks",
      "events": ["order.created", "order.updated"],
      "active": true,
      "secret": "whsec_***************",
      "createdAt": "2025-01-01T00:00:00Z"
    }
  ]
}
```

---

### POST /api/webhooks

Create a webhook.

**Request:**
```json
{
  "name": "Order Status Updates",
  "url": "https://example.com/webhooks/orders",
  "events": ["order.status.updated"],
  "secret": "your-webhook-secret"
}
```

**Response: 201 Created**
```json
{
  "success": true,
  "data": {
    "id": "160e8400-e29b-41d4-a716-446655440010",
    "name": "Order Status Updates",
    "url": "https://example.com/webhooks/orders",
    "events": ["order.status.updated"],
    "active": true,
    "createdAt": "2025-10-08T18:00:00Z"
  }
}
```

---

### POST /api/webhooks/shopify

Receive Shopify webhook (public endpoint).

**Headers:**
```http
X-Shopify-Topic: orders/create
X-Shopify-Hmac-SHA256: <signature>
X-Shopify-Shop-Domain: yourstore.myshopify.com
```

**Request:** (Shopify order payload)

**Response: 200 OK**
```json
{
  "success": true,
  "message": "Webhook processed successfully"
}
```

---

### POST /api/webhooks/woocommerce

Receive WooCommerce webhook (public endpoint).

**Headers:**
```http
X-WC-Webhook-Topic: order.created
X-WC-Webhook-Signature: <signature>
```

**Response: 200 OK**
```json
{
  "success": true,
  "message": "Webhook processed successfully"
}
```

## Analytics Endpoints

### GET /api/analytics/overview

Get dashboard overview analytics.

**Query Parameters:**
- `startDate` - Start date (ISO 8601)
- `endDate` - End date (ISO 8601)
- `period` - Period (day/week/month/year)

**Response: 200 OK**
```json
{
  "success": true,
  "data": {
    "orders": {
      "total": 1500,
      "change": 15.5,
      "trend": "up"
    },
    "revenue": {
      "total": 125000.00,
      "change": 22.3,
      "trend": "up"
    },
    "customers": {
      "total": 450,
      "change": 8.2,
      "trend": "up"
    },
    "averageOrderValue": {
      "value": 83.33,
      "change": 5.8,
      "trend": "up"
    },
    "ordersByStatus": [
      { "status": "PENDING", "count": 50 },
      { "status": "CONFIRMED", "count": 120 },
      { "status": "PROCESSING", "count": 80 },
      { "status": "SHIPPED", "count": 100 },
      { "status": "DELIVERED", "count": 1000 },
      { "status": "CANCELLED", "count": 150 }
    ],
    "revenueByDay": [
      { "date": "2025-10-01", "revenue": 5000 },
      { "date": "2025-10-02", "revenue": 5500 }
    ]
  }
}
```

---

### GET /api/analytics/orders

Get detailed order analytics.

**Response: 200 OK**
```json
{
  "success": true,
  "data": {
    "totalOrders": 1500,
    "completedOrders": 1000,
    "cancelledOrders": 150,
    "conversionRate": 66.67,
    "averageProcessingTime": "2.5 days",
    "ordersBySource": [
      { "source": "Shopify", "count": 800 },
      { "source": "WooCommerce", "count": 500 },
      { "source": "Manual", "count": 200 }
    ]
  }
}
```

---

### GET /api/analytics/customers

Get customer analytics.

**Response: 200 OK**
```json
{
  "success": true,
  "data": {
    "totalCustomers": 450,
    "newCustomers": 50,
    "returningCustomers": 400,
    "averageLifetimeValue": 277.78,
    "retentionRate": 88.89,
    "topCustomers": [
      {
        "id": "990e8400-e29b-41d4-a716-446655440004",
        "name": "Jane Doe",
        "totalSpent": 5000.00,
        "orderCount": 25
      }
    ]
  }
}
```

---

### GET /api/analytics/products

Get product analytics.

**Response: 200 OK**
```json
{
  "success": true,
  "data": {
    "totalProducts": 100,
    "outOfStock": 5,
    "lowStock": 15,
    "topSellingProducts": [
      {
        "id": "bb0e8400-e29b-41d4-a716-446655440006",
        "name": "Product A",
        "soldCount": 500,
        "revenue": 74995.00
      }
    ],
    "categoryPerformance": [
      {
        "category": "Electronics",
        "revenue": 80000.00,
        "orderCount": 400
      }
    ]
  }
}
```

## Settings Endpoints

### GET /api/settings

Get application settings.

**Response: 200 OK**
```json
{
  "success": true,
  "data": {
    "general": {
      "siteName": "E-Commerce COD Admin",
      "currency": "USD",
      "timezone": "America/New_York"
    },
    "orders": {
      "autoConfirm": false,
      "requireApproval": true,
      "defaultPaymentMethod": "COD"
    },
    "notifications": {
      "email": {
        "enabled": true,
        "from": "noreply@example.com"
      },
      "sms": {
        "enabled": false
      }
    }
  }
}
```

---

### PUT /api/settings

Update settings.

**Request:**
```json
{
  "orders": {
    "autoConfirm": true
  }
}
```

**Response: 200 OK**
```json
{
  "success": true,
  "data": {
    "orders": {
      "autoConfirm": true,
      "requireApproval": true,
      "defaultPaymentMethod": "COD"
    }
  }
}
```

## Webhook Integration

### Webhook Security

All incoming webhooks must be verified using HMAC signatures.

**Verification Process:**
```javascript
const crypto = require('crypto');

function verifyWebhook(payload, signature, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  const digest = hmac.update(payload).digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(digest)
  );
}
```

### Webhook Events

The system emits the following webhook events:

| Event | Description |
|-------|-------------|
| `order.created` | New order created |
| `order.updated` | Order details updated |
| `order.status.updated` | Order status changed |
| `order.deleted` | Order deleted |
| `customer.created` | New customer created |
| `customer.updated` | Customer updated |
| `product.created` | New product created |
| `product.updated` | Product updated |
| `product.stock.low` | Product stock below threshold |

### Webhook Payload Format

```json
{
  "event": "order.created",
  "timestamp": "2025-10-08T10:00:00Z",
  "data": {
    "id": "880e8400-e29b-41d4-a716-446655440003",
    "orderNumber": "ORD-2025-0001",
    "status": "PENDING",
    "totalAmount": 299.99
  }
}
```

## Code Examples

### JavaScript/Node.js

```javascript
const axios = require('axios');

const API_URL = 'http://localhost:5000/api';
let token = null;

// Login
async function login(email, password) {
  const response = await axios.post(`${API_URL}/auth/login`, {
    email,
    password
  });
  token = response.data.data.token;
  return response.data.data.user;
}

// Get orders
async function getOrders(page = 1, limit = 20) {
  const response = await axios.get(`${API_URL}/orders`, {
    params: { page, limit },
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  return response.data.data;
}

// Create order
async function createOrder(orderData) {
  const response = await axios.post(`${API_URL}/orders`, orderData, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });
  return response.data.data;
}

// Update order status
async function updateOrderStatus(orderId, status, note) {
  const response = await axios.patch(
    `${API_URL}/orders/${orderId}/status`,
    { status, note },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }
  );
  return response.data.data;
}

// Usage
(async () => {
  await login('admin@example.com', 'admin123');
  const orders = await getOrders(1, 20);
  console.log('Orders:', orders);
})();
```

### Python

```python
import requests

API_URL = 'http://localhost:5000/api'
token = None

def login(email, password):
    global token
    response = requests.post(f'{API_URL}/auth/login', json={
        'email': email,
        'password': password
    })
    data = response.json()['data']
    token = data['token']
    return data['user']

def get_orders(page=1, limit=20):
    response = requests.get(f'{API_URL}/orders', 
        params={'page': page, 'limit': limit},
        headers={'Authorization': f'Bearer {token}'}
    )
    return response.json()['data']

def create_order(order_data):
    response = requests.post(f'{API_URL}/orders',
        json=order_data,
        headers={
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json'
        }
    )
    return response.json()['data']

# Usage
login('admin@example.com', 'admin123')
orders = get_orders(page=1, limit=20)
print('Orders:', orders)
```

### cURL

```bash
# Login
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"admin123"}'

# Get orders
curl -X GET "http://localhost:5000/api/orders?page=1&limit=20" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Create order
curl -X POST http://localhost:5000/api/orders \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "990e8400-e29b-41d4-a716-446655440004",
    "items": [{"productId": "bb0e8400-e29b-41d4-a716-446655440006", "quantity": 2}],
    "paymentMethod": "COD"
  }'

# Update order status
curl -X PATCH http://localhost:5000/api/orders/ORDER_ID/status \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"CONFIRMED","note":"Order confirmed"}'
```

---

**API Version:** 1.0.0  
**Last Updated:** 2025-10-08  
**Support:** api-support@example.com
