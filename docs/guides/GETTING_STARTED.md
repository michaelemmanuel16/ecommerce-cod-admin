# Getting Started Guide

> **Quick Setup Guide for E-Commerce COD Admin Dashboard**
> **Time to First Launch:** 5-10 minutes

---

## Table of Contents

1. [5-Minute Quick Start](#5-minute-quick-start)
2. [Demo Setup](#demo-setup)
3. [Key Features Walkthrough](#key-features-walkthrough)
4. [Common Workflows](#common-workflows)
5. [Sample Data Creation](#sample-data-creation)
6. [Next Steps](#next-steps)

---

## 5-Minute Quick Start

Get the application running locally in just 5 minutes!

### Prerequisites

Before you begin, ensure you have:
- **Node.js** 18+ installed ([Download](https://nodejs.org/))
- **PostgreSQL** 15+ installed and running ([Download](https://www.postgresql.org/download/))
- **Git** installed ([Download](https://git-scm.com/downloads))

### Step 1: Clone the Repository (30 seconds)

```bash
git clone https://github.com/yourusername/ecommerce-cod-admin.git
cd ecommerce-cod-admin
```

### Step 2: Backend Setup (2 minutes)

```bash
# Navigate to backend
cd backend

# Install dependencies
npm install

# Create environment file
cp .env.example .env

# Edit .env with your database credentials
# Minimum required:
# DATABASE_URL="postgresql://postgres:password@localhost:5432/ecommerce_cod"
# JWT_SECRET="your-secret-key-minimum-32-characters-long"

# Create database
createdb ecommerce_cod

# Run migrations
npx prisma migrate deploy
npx prisma generate

# Start backend server
npm run dev
```

Backend should now be running on `http://localhost:3000`

### Step 3: Frontend Setup (2 minutes)

Open a new terminal:

```bash
# Navigate to frontend
cd frontend

# Install dependencies
npm install

# Create environment file
cp .env.example .env

# Edit .env
# VITE_API_URL=http://localhost:3000
# VITE_SOCKET_URL=http://localhost:3000

# Start frontend
npm run dev
```

Frontend should now be running on `http://localhost:5173`

### Step 4: Access the Application (30 seconds)

1. Open your browser to `http://localhost:5173`
2. You'll see the login page
3. Create a new account by clicking "Register"
4. Login with your credentials

**🎉 Congratulations! Your application is running!**

---

## Demo Setup

For a quick demo with sample data, use our automated setup script.

### Automated Demo Setup

```bash
# From project root
./scripts/setup-dev.sh --with-demo-data
```

This script will:
- Install all dependencies
- Set up the database
- Create sample users, products, customers, and orders
- Start both backend and frontend

### Manual Demo Setup

If you prefer manual setup:

```bash
# Backend
cd backend
npm run dev

# In another terminal - Frontend
cd frontend
npm run dev

# In another terminal - Create demo data
cd backend
node scripts/seed-demo-data.js
```

### Demo Credentials

After running demo setup, use these credentials:

| Role | Email | Password | Access Level |
|------|-------|----------|--------------|
| Super Admin | admin@example.com | admin123 | Full access |
| Manager | manager@example.com | manager123 | Management operations |
| Sales Rep | sales@example.com | sales123 | Customer & order management |
| Delivery Agent | agent@example.com | agent123 | Delivery operations |

---

## Key Features Walkthrough

### 1. Dashboard Overview (Home Page)

**What you'll see:**
- **KPI Cards**: Total orders, revenue, COD collected, pending deliveries
- **Sales Trend Chart**: Visual representation of sales over time
- **Order Funnel**: Conversion rates across order statuses
- **Recent Orders**: Latest order activity
- **Low Stock Alerts**: Products running low

**Quick Actions:**
- Click any KPI card to drill down into details
- Hover over charts for detailed data points
- Click "View All" on recent orders to see full list

### 2. Kanban Board (Order Management)

**Location:** Click "Orders" in sidebar

**What you'll see:**
- 8 columns representing order statuses:
  - New Orders
  - Confirmation Pending
  - Confirmed
  - Being Prepared
  - Ready for Pickup
  - Out for Delivery
  - Delivered
  - Returned

**How to use:**
1. **View Orders**: Each card shows order details (number, customer, amount)
2. **Drag & Drop**: Move orders between columns to update status
3. **Quick Actions**: Click three dots on card for options:
   - View Details
   - Assign Rep
   - Assign Agent
   - Add Note
   - Cancel Order

4. **Filters**: Use top filters to find orders:
   - Search by order number or customer
   - Filter by date range
   - Filter by status
   - Filter by assigned rep/agent

### 3. Order Details

**How to access:** Click any order card or go to Orders > List View

**Information shown:**
- Order summary (number, date, status, total)
- Customer information (name, phone, address)
- Product details (items, quantities, prices)
- Order history (all status changes)
- Delivery information
- Payment details
- Internal notes

**Actions available:**
- Update order status
- Assign to rep or agent
- Add notes
- Print invoice
- Track delivery
- Process refund

### 4. Customer Management

**Location:** Click "Customers" in sidebar

**Features:**
- **Customer List**: View all customers with search and filters
- **Customer Profile**: Click any customer to see:
  - Personal information
  - Order history
  - Total spent
  - Average order value
  - Purchase patterns
  - Saved addresses

**Quick Actions:**
- Add new customer
- Edit customer details
- Add tags (VIP, Regular, etc.)
- View order history
- Send notification

### 5. Product Management

**Location:** Click "Products" in sidebar

**Features:**
- **Product Catalog**: View all products
- **Stock Management**: Real-time inventory tracking
- **Low Stock Alerts**: Automatic notifications
- **Product Details**: Name, SKU, price, stock, images

**Quick Actions:**
- Add new product
- Edit product details
- Update stock quantity
- Upload product images
- Set variants (size, color)

### 6. Workflow Automation

**Location:** Click "Workflows" in sidebar

**What is it?**
Automate repetitive tasks based on events and conditions.

**Example workflows:**
1. **Auto-assign high-value orders**
   - Trigger: Order created
   - Condition: Total amount > $1000
   - Action: Assign to senior rep

2. **Delivery reminder**
   - Trigger: Order status = Out for Delivery
   - Action: Send SMS to customer

3. **Stock alert**
   - Trigger: Product stock < 10
   - Action: Notify inventory manager

**How to create:**
1. Click "Create Workflow"
2. Choose trigger (event that starts workflow)
3. Add conditions (optional)
4. Add actions (what should happen)
5. Test and activate

### 7. Delivery Management

**Location:** Click "Deliveries" in sidebar

**Features:**
- View all deliveries
- See assigned agent
- Track delivery status
- View route optimization
- Upload proof of delivery

**For Delivery Agents:**
- View assigned deliveries
- Update delivery status
- Upload delivery proof (photo, signature)
- Mark COD collected
- Report issues

### 8. Financial Dashboard

**Location:** Click "Financial" in sidebar

**What you'll see:**
- **Revenue Summary**: Total sales, COD collected, pending
- **Expense Tracking**: Record business expenses
- **Profit Analysis**: Revenue vs. expenses
- **Daily Reports**: Daily sales and collections
- **Transaction History**: All financial transactions

**Quick Actions:**
- Record expense
- View daily report
- Export financial data
- Track COD collections

### 9. Analytics Dashboard

**Location:** Click "Analytics" in sidebar

**Available Reports:**
- **Sales Trends**: Daily, weekly, monthly sales
- **Conversion Funnel**: Order status conversion rates
- **Rep Performance**: Sales rep performance metrics
- **Agent Performance**: Delivery agent metrics
- **Customer Insights**: Purchase patterns, segmentation
- **Product Analytics**: Best sellers, slow movers

---

## Common Workflows

### Workflow 1: Processing a New Order

1. **Order arrives via webhook** (automatic)
   - Order appears in "New Orders" column
   - Notification sent to sales team

2. **Sales rep reviews order**
   - Click order card to view details
   - Verify customer information
   - Check product availability

3. **Confirm order**
   - Drag order to "Confirmed" column
   - Customer receives confirmation (if automated)

4. **Prepare order**
   - Move to "Being Prepared"
   - Inventory team picks items

5. **Assign delivery agent**
   - Move to "Ready for Pickup"
   - Click "Assign Agent"
   - Select available agent
   - Agent receives notification

6. **Out for delivery**
   - Agent updates status to "Out for Delivery"
   - Customer receives tracking notification

7. **Delivery complete**
   - Agent uploads proof of delivery
   - Marks COD collected (if applicable)
   - Order moves to "Delivered"

### Workflow 2: Managing Customer Returns

1. **Customer requests return**
   - Create return order
   - Link to original order

2. **Assign pickup agent**
   - Select delivery agent for pickup
   - Schedule pickup time

3. **Agent picks up return**
   - Agent collects item
   - Upload pickup proof

4. **Process return**
   - Verify returned item
   - Update inventory
   - Process refund

5. **Complete return**
   - Update order status
   - Notify customer

### Workflow 3: Inventory Management

1. **Check stock levels**
   - Go to Products
   - Sort by stock quantity
   - View low stock alerts

2. **Reorder products**
   - Record purchase order
   - Add to expenses

3. **Receive inventory**
   - Update stock quantities
   - Clear low stock alerts

4. **Track stock movement**
   - View product analytics
   - Monitor sales velocity
   - Adjust reorder points

### Workflow 4: Financial Reconciliation

1. **Daily COD collection**
   - Go to Financial > COD Collections
   - View agent collections
   - Verify amounts

2. **Record expenses**
   - Click "Record Expense"
   - Add expense details
   - Categorize expense

3. **Generate daily report**
   - View Daily Report
   - Export to CSV/Excel
   - Review profit/loss

4. **Monthly reconciliation**
   - View Monthly Report
   - Compare with bank statements
   - Adjust discrepancies

---

## Sample Data Creation

### Option 1: Using Seed Script

```bash
cd backend
npm run prisma:seed
```

This creates:
- 5 users (various roles)
- 20 customers
- 30 products
- 50 orders (various statuses)
- 5 workflows
- 3 webhook configurations

### Option 2: Manual Creation

#### Create a Customer

1. Go to Customers > Add Customer
2. Fill in details:
   ```
   Name: John Doe
   Email: john@example.com
   Phone: +1234567890
   Address: 123 Main St
   City: New York
   Postal Code: 10001
   ```
3. Click Save

#### Create a Product

1. Go to Products > Add Product
2. Fill in details:
   ```
   Name: Premium Widget
   SKU: WIDGET-001
   Price: 99.99
   Stock: 100
   Description: High-quality widget
   ```
3. Upload product image
4. Click Save

#### Create an Order

1. Go to Orders > Create Order
2. Select customer
3. Add products:
   - Search and select products
   - Set quantities
4. Choose payment method (COD)
5. Review total
6. Click Create Order

### Option 3: Import from CSV

1. Go to Orders > Import
2. Download CSV template
3. Fill in order data:
   ```csv
   order_number,customer_email,product_sku,quantity,total_amount
   ORD-001,john@example.com,WIDGET-001,2,199.98
   ```
4. Upload CSV file
5. Map columns if needed
6. Click Import

---

## Next Steps

### For Developers

1. **Explore the API**
   - Read [API_DOCUMENTATION.md](API_DOCUMENTATION.md)
   - Test endpoints with Postman
   - Review authentication flow

2. **Customize the Application**
   - Modify UI components
   - Add custom fields
   - Extend API endpoints

3. **Set Up Testing**
   - Run unit tests: `npm test`
   - Run integration tests
   - Set up E2E tests

4. **Deploy to Production**
   - Follow [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)
   - Set up CI/CD pipeline
   - Configure monitoring

### For Administrators

1. **Configure System Settings**
   - Set up email notifications (SMTP)
   - Configure SMS provider (Twilio)
   - Set up webhook integrations

2. **Create User Accounts**
   - Add sales reps
   - Add delivery agents
   - Configure permissions

3. **Set Up Workflows**
   - Create automation rules
   - Test workflow execution
   - Monitor workflow logs

4. **Configure Integrations**
   - Set up Shopify webhook
   - Configure WooCommerce
   - Test order import

### For End Users

1. **Complete Your Profile**
   - Update personal information
   - Upload profile picture
   - Set notification preferences

2. **Learn the Interface**
   - Explore all menu items
   - Try drag-and-drop on Kanban
   - Practice creating orders

3. **Set Up Workflows**
   - Create your first workflow
   - Test automation
   - Monitor results

4. **Master Reports**
   - Generate daily reports
   - Export data to Excel
   - Schedule automated reports

---

## Quick Reference

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + K` | Global search |
| `Ctrl/Cmd + N` | Create new order |
| `Ctrl/Cmd + S` | Save current form |
| `Esc` | Close modal |
| `?` | Show keyboard shortcuts |

### Common Commands

```bash
# Start development
npm run dev

# Build for production
npm run build

# Run tests
npm test

# Database migrations
npx prisma migrate dev

# View database
npx prisma studio

# Check health
curl http://localhost:3000/health
```

### Default Ports

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3000`
- Database: `postgresql://localhost:5432`
- Redis: `redis://localhost:6379`

### Important URLs

- Dashboard: `/dashboard`
- Orders: `/orders`
- Customers: `/customers`
- Products: `/products`
- Analytics: `/analytics`
- Settings: `/settings`

---

## Troubleshooting

### Common Issues

**Issue: Backend won't start**
```bash
# Check if port 3000 is in use
lsof -ti:3000
# Kill process if needed
kill -9 $(lsof -ti:3000)
```

**Issue: Database connection failed**
```bash
# Check PostgreSQL is running
pg_isready
# Start PostgreSQL
brew services start postgresql  # macOS
sudo systemctl start postgresql  # Linux
```

**Issue: Frontend can't connect to backend**
- Verify `VITE_API_URL` in `.env`
- Check backend is running: `curl http://localhost:3000/health`
- Check CORS settings in backend

**Issue: Migrations fail**
```bash
# Reset database (DEVELOPMENT ONLY!)
npx prisma migrate reset
# Or manually fix
npx prisma migrate resolve --rolled-back "migration-name"
```

---

## Support & Resources

### Documentation

- [README.md](README.md) - Project overview
- [API_DOCUMENTATION.md](API_DOCUMENTATION.md) - API reference
- [USER_GUIDE.md](USER_GUIDE.md) - Comprehensive user guide
- [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md) - Developer documentation
- [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) - Deployment instructions

### Video Tutorials

- Getting Started (5 minutes)
- Kanban Board Tutorial (10 minutes)
- Workflow Automation (15 minutes)
- Advanced Features (20 minutes)

### Community

- GitHub Issues: [Report bugs](https://github.com/yourusername/ecommerce-cod-admin/issues)
- Discord: [Join community](https://discord.gg/yourserver)
- Stack Overflow: Tag `ecommerce-cod-admin`

### Professional Support

- Email: support@example.com
- Enterprise: enterprise@example.com
- Phone: +1-XXX-XXX-XXXX

---

## Feedback

We'd love to hear from you!

- **Feature Requests**: [GitHub Discussions](https://github.com/yourusername/ecommerce-cod-admin/discussions)
- **Bug Reports**: [GitHub Issues](https://github.com/yourusername/ecommerce-cod-admin/issues)
- **General Feedback**: feedback@example.com

---

**Happy COD Managing!**

Built with ❤️ by the E-Commerce COD Team

**Star ⭐ this repo if you find it useful!**
