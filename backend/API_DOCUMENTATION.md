# E-commerce COD Admin API Documentation

## Base URL
```
http://localhost:3000/api
```

## Authentication

All protected endpoints require a JWT token in the Authorization header:
```
Authorization: Bearer <access_token>
```

### Authentication Endpoints

#### Register User
```http
POST /api/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123",
  "firstName": "John",
  "lastName": "Doe",
  "role": "sales_rep",
  "phoneNumber": "+1234567890"
}

Response: 201 Created
{
  "message": "User registered successfully",
  "user": {
    "id": "usr_abc123",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "role": "sales_rep"
  }
}
```

#### Login
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}

Response: 200 OK
{
  "message": "Login successful",
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "usr_abc123",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "role": "sales_rep"
  }
}
```

#### Refresh Token
```http
POST /api/auth/refresh
Content-Type: application/json

{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}

Response: 200 OK
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

## Order Endpoints

### List Orders
```http
GET /api/orders?page=1&limit=20&status=confirmed&area=Manhattan
Authorization: Bearer <token>

Response: 200 OK
{
  "orders": [
    {
      "id": "ord_abc123",
      "orderNumber": "ORD-1234567890-00001",
      "status": "confirmed",
      "totalAmount": 150.50,
      "customer": {
        "firstName": "Jane",
        "lastName": "Smith",
        "phoneNumber": "+1234567890"
      },
      "orderItems": [
        {
          "product": {
            "name": "Product A",
            "sku": "SKU-001"
          },
          "quantity": 2,
          "unitPrice": 75.25
        }
      ]
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "pages": 8
  }
}
```

### Create Order
```http
POST /api/orders
Authorization: Bearer <token>
Content-Type: application/json

{
  "customerId": "cst_xyz789",
  "orderItems": [
    {
      "productId": "prd_abc123",
      "quantity": 2,
      "unitPrice": 50.00
    }
  ],
  "subtotal": 100.00,
  "shippingCost": 10.00,
  "discount": 5.00,
  "totalAmount": 105.00,
  "deliveryAddress": "123 Main St, Apt 4B",
  "deliveryCity": "New York",
  "deliveryState": "NY",
  "deliveryZipCode": "10001",
  "deliveryArea": "Manhattan",
  "notes": "Ring doorbell twice"
}

Response: 201 Created
{
  "order": {
    "id": "ord_new123",
    "orderNumber": "ORD-1234567890-00002",
    "status": "pending_confirmation",
    "totalAmount": 105.00,
    ...
  }
}
```

### Bulk Import Orders
```http
POST /api/orders/bulk
Authorization: Bearer <token>
Content-Type: application/json

{
  "orders": [
    {
      "customerPhone": "+1234567890",
      "customerFirstName": "John",
      "customerLastName": "Doe",
      "deliveryAddress": "123 Main St",
      "deliveryCity": "New York",
      "deliveryState": "NY",
      "deliveryZipCode": "10001",
      "deliveryArea": "Manhattan",
      "subtotal": 100.00,
      "totalAmount": 110.00
    }
  ]
}

Response: 200 OK
{
  "results": {
    "success": 1,
    "failed": 0,
    "errors": []
  }
}
```

### Update Order Status
```http
PATCH /api/orders/:id/status
Authorization: Bearer <token>
Content-Type: application/json

{
  "status": "out_for_delivery",
  "notes": "Assigned to delivery agent"
}

Response: 200 OK
{
  "order": {
    "id": "ord_abc123",
    "status": "out_for_delivery",
    ...
  }
}
```

### Assign Customer Rep
```http
PATCH /api/orders/:id/assign-rep
Authorization: Bearer <token>
Content-Type: application/json

{
  "customerRepId": "usr_rep123"
}

Response: 200 OK
```

### Assign Delivery Agent
```http
PATCH /api/orders/:id/assign-agent
Authorization: Bearer <token>
Content-Type: application/json

{
  "deliveryAgentId": "usr_agent456"
}

Response: 200 OK
```

### Get Kanban View
```http
GET /api/orders/kanban?area=Manhattan
Authorization: Bearer <token>

Response: 200 OK
{
  "kanban": {
    "pending_confirmation": [...],
    "confirmed": [...],
    "preparing": [...],
    "ready_for_pickup": [...],
    "out_for_delivery": [...],
    "delivered": [...],
    "cancelled": [...],
    "returned": [...],
    "failed_delivery": [...]
  }
}
```

## Webhook Endpoints

### Import Orders via Webhook (Public)
```http
POST /api/webhooks/import
Content-Type: application/json
X-API-Key: your-api-key
X-Webhook-Signature: hmac-sha256-signature

{
  "orders": [
    {
      "customer_phone": "+1234567890",
      "customer_name": "John Doe",
      "amount": 150.00,
      "address": "123 Main St",
      "city": "New York",
      "area": "Manhattan",
      "notes": "Urgent delivery"
    }
  ]
}

Response: 200 OK
{
  "message": "Webhook processed",
  "results": {
    "success": 1,
    "failed": 0,
    "errors": []
  }
}
```

### Create Webhook Config
```http
POST /api/webhooks
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Shopify Integration",
  "url": "https://api.shopify.com/webhook",
  "secret": "webhook-secret-key",
  "apiKey": "api-key-123",
  "fieldMapping": {
    "customerPhone": "customer.phone",
    "customerFirstName": "customer.first_name",
    "deliveryAddress": "shipping_address.address1",
    "totalAmount": "total_price"
  },
  "headers": {
    "X-Custom-Header": "value"
  }
}

Response: 201 Created
```

## Customer Endpoints

### List Customers
```http
GET /api/customers?search=john&city=New York&page=1&limit=20
Authorization: Bearer <token>

Response: 200 OK
{
  "customers": [...],
  "pagination": {...}
}
```

### Get Customer Analytics
```http
GET /api/customers/:id/analytics
Authorization: Bearer <token>

Response: 200 OK
{
  "analytics": {
    "totalOrders": 15,
    "totalSpent": 1250.00,
    "avgOrderValue": 83.33,
    "ordersByStatus": {
      "delivered": 12,
      "pending": 2,
      "cancelled": 1
    },
    "lastOrderDate": "2025-10-01T10:30:00Z"
  }
}
```

## Analytics Endpoints

### Dashboard Metrics
```http
GET /api/analytics/dashboard
Authorization: Bearer <token>

Response: 200 OK
{
  "metrics": {
    "totalOrders": 1250,
    "todayOrders": 45,
    "pendingOrders": 120,
    "deliveredOrders": 980,
    "totalRevenue": 125000.00,
    "todayRevenue": 4500.00,
    "activeAgents": 12,
    "avgDeliveryTime": 3.5,
    "deliveryRate": 78.4
  }
}
```

### Sales Trends
```http
GET /api/analytics/sales-trends?period=daily&days=30
Authorization: Bearer <token>

Response: 200 OK
{
  "trends": [
    {
      "date": "2025-10-01",
      "orders": 45,
      "revenue": 4500.00,
      "delivered": 35,
      "conversionRate": 77.78
    }
  ]
}
```

### Rep Performance
```http
GET /api/analytics/rep-performance
Authorization: Bearer <token>

Response: 200 OK
{
  "performance": [
    {
      "userId": "usr_rep123",
      "userName": "John Doe",
      "totalAssigned": 150,
      "completed": 120,
      "pending": 30,
      "successRate": 80.0,
      "revenue": 15000.00,
      "avgResponseTime": 25
    }
  ]
}
```

## Workflow Endpoints

### Create Workflow
```http
POST /api/workflows
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Auto-Confirm Orders",
  "description": "Automatically confirm orders from webhooks",
  "triggerType": "webhook",
  "triggerData": {
    "source": "shopify"
  },
  "actions": [
    {
      "type": "update_order",
      "config": {
        "status": "confirmed"
      }
    },
    {
      "type": "send_sms",
      "config": {
        "message": "Your order has been confirmed!"
      }
    }
  ],
  "conditions": {
    "if": {
      "field": "totalAmount",
      "operator": "greater_than",
      "value": 100
    }
  }
}

Response: 201 Created
```

### Execute Workflow
```http
POST /api/workflows/:id/execute
Authorization: Bearer <token>
Content-Type: application/json

{
  "input": {
    "orderId": "ord_abc123"
  }
}

Response: 200 OK
{
  "message": "Workflow execution started",
  "execution": {
    "id": "wex_xyz789",
    "workflowId": "wfl_abc123",
    "status": "pending"
  }
}
```

## Financial Endpoints

### Financial Summary
```http
GET /api/financial/summary?startDate=2025-10-01&endDate=2025-10-07
Authorization: Bearer <token>

Response: 200 OK
{
  "summary": {
    "totalRevenue": 50000.00,
    "totalExpenses": 15000.00,
    "profit": 35000.00,
    "codCollected": 45000.00,
    "profitMargin": 70.0
  }
}
```

### COD Collections
```http
GET /api/financial/cod-collections?agentId=usr_agent123
Authorization: Bearer <token>

Response: 200 OK
{
  "collections": [
    {
      "id": "txn_abc123",
      "amount": 150.00,
      "status": "collected",
      "order": {
        "orderNumber": "ORD-123",
        "deliveryAgent": {
          "firstName": "Mike",
          "lastName": "Johnson"
        }
      }
    }
  ]
}
```

## Delivery Endpoints

### Get Agent Route
```http
GET /api/deliveries/routes/:agentId?date=2025-10-07
Authorization: Bearer <token>

Response: 200 OK
{
  "route": [
    {
      "deliveryId": "dlv_abc123",
      "orderId": "ord_xyz789",
      "orderNumber": "ORD-123",
      "customer": {
        "firstName": "Jane",
        "phoneNumber": "+1234567890"
      },
      "address": "123 Main St",
      "area": "Manhattan",
      "scheduledTime": "2025-10-07T10:00:00Z",
      "status": "out_for_delivery",
      "codAmount": 150.00
    }
  ]
}
```

### Complete Delivery
```http
PATCH /api/deliveries/:id/complete
Authorization: Bearer <token>
Content-Type: application/json

{
  "codAmount": 150.00,
  "proofType": "signature",
  "proofData": "data:image/png;base64,...",
  "recipientName": "Jane Doe"
}

Response: 200 OK
{
  "message": "Delivery completed successfully"
}
```

## Error Responses

### 400 Bad Request
```json
{
  "error": "Validation failed",
  "details": [
    {
      "field": "email",
      "message": "Invalid email format"
    }
  ]
}
```

### 401 Unauthorized
```json
{
  "error": "Invalid token"
}
```

### 403 Forbidden
```json
{
  "error": "Forbidden: Insufficient permissions"
}
```

### 404 Not Found
```json
{
  "error": "Order not found"
}
```

### 500 Internal Server Error
```json
{
  "error": "Internal server error",
  "message": "Something went wrong"
}
```

## Rate Limits

- Auth endpoints: 5 requests / 15 minutes
- General API: 100 requests / 15 minutes
- Webhooks: 50 requests / 15 minutes

Rate limit headers:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1633024800
```

## Pagination

All list endpoints support pagination:
- `page`: Page number (default: 1)
- `limit`: Items per page (default: 20, max: 100)

Response includes pagination metadata:
```json
{
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "pages": 8
  }
}
```

## Filtering & Search

Common query parameters:
- `search`: Text search
- `status`: Filter by status
- `startDate`: Start date filter
- `endDate`: End date filter
- `area`: Delivery area filter
- `city`: City filter

Example:
```
GET /api/orders?status=confirmed&area=Manhattan&startDate=2025-10-01
```
