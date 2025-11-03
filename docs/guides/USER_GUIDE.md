# User Guide

Complete guide for using the E-Commerce COD Admin Dashboard.

## Table of Contents

- [Introduction](#introduction)
- [Getting Started](#getting-started)
- [Dashboard Overview](#dashboard-overview)
- [Order Management](#order-management)
- [Customer Management](#customer-management)
- [Product Management](#product-management)
- [Workflow Automation](#workflow-automation)
- [Analytics & Reports](#analytics--reports)
- [Settings](#settings)
- [Role-Based Guides](#role-based-guides)
- [Tips & Best Practices](#tips--best-practices)
- [Troubleshooting](#troubleshooting)
- [Keyboard Shortcuts](#keyboard-shortcuts)

## Introduction

Welcome to the E-Commerce COD Admin Dashboard! This comprehensive order management system helps you efficiently handle Cash on Delivery (COD) orders with features like:

- Visual Kanban board for order tracking
- Automated workflow rules
- Customer relationship management
- Product inventory management
- Real-time analytics and reporting

### Who Should Use This Guide?

- **Administrators**: Complete system management
- **Managers**: Team oversight and reporting
- **Agents**: Day-to-day order processing

## Getting Started

### First-Time Login

1. **Access the Application**
   - Open your web browser
   - Navigate to your dashboard URL (e.g., `https://admin.yourstore.com`)

2. **Login**
   - Enter your email address
   - Enter your password
   - Click "Sign In"

   **Default credentials (first-time setup):**
   - Email: `admin@example.com`
   - Password: `admin123`
   
   ⚠️ **Important**: Change the default password immediately after first login!

3. **Dashboard Tour**
   - After login, you'll see the main dashboard
   - Take a moment to familiarize yourself with the navigation

### Navigation Layout

```
┌─────────────────────────────────────────────────────┐
│  Logo    Dashboard  Orders  Customers  Products     │  ← Header
├──────┬──────────────────────────────────────────────┤
│      │                                               │
│ Nav  │           Main Content Area                   │
│ Bar  │                                               │
│      │                                               │
│      │                                               │
└──────┴──────────────────────────────────────────────┘
```

**Navigation Menu:**
- 📊 Dashboard - Overview and analytics
- 📦 Orders - Order management
- 👥 Customers - Customer database
- 🏷️ Products - Product catalog
- ⚙️ Workflows - Automation rules
- 📈 Analytics - Reports and insights
- ⚙️ Settings - System configuration

## Dashboard Overview

The dashboard provides a quick overview of your e-commerce operations.

### Key Metrics Cards

**Total Orders**
- Shows total number of orders
- Percentage change from previous period
- Trend indicator (up/down)

**Revenue**
- Total revenue in your currency
- Period-over-period comparison
- Revenue trend graph

**Active Customers**
- Number of customers with orders
- New vs. returning customers
- Growth rate

**Average Order Value (AOV)**
- Average amount per order
- Helps track pricing effectiveness
- Comparison with previous period

### Charts & Graphs

**Order Status Distribution**
- Pie chart showing orders by status
- Quick view of workflow bottlenecks
- Click to filter orders by status

**Revenue Over Time**
- Line graph showing daily/weekly revenue
- Helps identify trends and patterns
- Hover for detailed numbers

**Top Products**
- Best-selling products list
- Shows quantity sold and revenue
- Quick access to product details

**Recent Orders**
- Latest orders created
- Quick status overview
- Click to view/edit order

### Quick Actions

Use the quick action buttons to:
- Create new order
- Add customer
- View pending approvals
- Generate reports

## Order Management

The heart of the system - manage all your COD orders efficiently.

### Order Kanban Board

The Kanban board provides a visual workflow for managing orders.

```
┌──────────┬──────────┬──────────┬──────────┬──────────┐
│ PENDING  │CONFIRMED │PROCESSING│ SHIPPED  │DELIVERED │
├──────────┼──────────┼──────────┼──────────┼──────────┤
│ Order 1  │ Order 5  │ Order 8  │ Order 12 │ Order 15 │
│ Order 2  │ Order 6  │ Order 9  │ Order 13 │ Order 16 │
│ Order 3  │ Order 7  │ Order 10 │ Order 14 │ Order 17 │
│ Order 4  │          │ Order 11 │          │          │
└──────────┴──────────┴──────────┴──────────┴──────────┘
```

**Order Statuses:**
1. **PENDING** - New orders waiting for review
2. **CONFIRMED** - Orders verified and approved
3. **PROCESSING** - Orders being prepared
4. **SHIPPED** - Orders dispatched for delivery
5. **DELIVERED** - Orders successfully delivered
6. **CANCELLED** - Orders cancelled
7. **RETURNED** - Orders returned by customer

### Working with Orders

#### Viewing Order Details

1. Click on any order card
2. Order details panel opens showing:
   - Order number and date
   - Customer information
   - Products ordered
   - Shipping address
   - Payment details
   - Order history
   - Internal notes

#### Creating a New Order

1. Click "New Order" button
2. Fill in the form:
   
   **Customer Information:**
   - Search for existing customer OR
   - Create new customer
   
   **Order Details:**
   - Add products (search and select)
   - Set quantities
   - Review total amount
   
   **Shipping Information:**
   - Enter/verify shipping address
   - Add delivery notes
   
   **Payment:**
   - Select payment method (COD default)
   - Add payment notes if needed

3. Click "Create Order"
4. Order appears in PENDING column

#### Updating Order Status

**Method 1: Drag and Drop**
1. Click and hold an order card
2. Drag to target status column
3. Release to drop
4. Confirm status change if prompted

**Method 2: Order Details**
1. Open order details
2. Click "Change Status" button
3. Select new status
4. Add note (optional)
5. Click "Update"

#### Editing Order Details

1. Open order details
2. Click "Edit" button
3. Modify fields:
   - Customer information
   - Shipping address
   - Products and quantities
   - Notes
4. Click "Save Changes"

#### Bulk Operations

Select multiple orders for bulk actions:

1. **Enable Selection Mode**
   - Click checkbox icon in toolbar
   - Checkboxes appear on order cards

2. **Select Orders**
   - Click checkboxes on desired orders
   - Or use "Select All" option

3. **Choose Action**
   - Update Status
   - Assign to User
   - Export Data
   - Print Labels

4. **Execute**
   - Confirm bulk operation
   - View progress and results

### Filtering Orders

Use filters to find specific orders:

**Filter Panel** (click filter icon)
- **Status**: Select one or multiple statuses
- **Date Range**: From/To dates
- **Customer**: Search by customer name
- **Amount**: Min/Max range
- **Payment Method**: COD, Online, etc.
- **Order Source**: Shopify, WooCommerce, Manual

**Search Box**
- Search by order number
- Search by customer name
- Search by product name

**Quick Filters** (above board)
- My Orders (assigned to you)
- Urgent Orders (flagged)
- High Value (above threshold)
- Today's Orders

### Order Actions

**Available Actions:**
- ✏️ Edit - Modify order details
- 🔄 Change Status - Update workflow status
- 👤 Assign - Assign to team member
- 📧 Email Customer - Send notification
- 📝 Add Note - Add internal comment
- 🖨️ Print - Print order details/label
- 📎 Attach File - Upload documents
- 🗑️ Cancel/Delete - Cancel or remove order

### Order History

Every order maintains a complete history:
- Status changes
- Modifications
- User actions
- Timestamps
- Notes added

View history:
1. Open order details
2. Click "History" tab
3. See chronological timeline

## Customer Management

Manage your customer database effectively.

### Customer List

**View Customers:**
1. Navigate to "Customers" section
2. See list of all customers with:
   - Name and contact info
   - Total orders
   - Total spent
   - Last order date
   - Status indicators

**Sorting Options:**
- Name (A-Z)
- Total orders
- Total spent
- Recent activity
- Registration date

### Customer Profile

Click any customer to view profile:

**Customer Information:**
- Name, email, phone
- Complete address
- Registration date
- Customer tags/segments

**Order History:**
- All orders placed
- Status of each order
- Total order value
- Quick links to orders

**Statistics:**
- Total orders count
- Total amount spent
- Average order value
- Order frequency
- Lifetime value

**Activity Timeline:**
- Recent orders
- Account updates
- Support interactions
- Notes history

### Adding a Customer

1. Click "Add Customer" button
2. Fill customer form:
   ```
   Name: [Full Name]
   Email: [email@example.com]
   Phone: [+1234567890]
   
   Address:
   Street: [123 Main St]
   City: [City Name]
   State: [State]
   ZIP: [12345]
   Country: [Country]
   
   Notes: [Optional internal notes]
   Tags: [VIP, Wholesale, etc.]
   ```
3. Click "Save Customer"

### Editing Customer Information

1. Open customer profile
2. Click "Edit" button
3. Update information
4. Save changes

### Customer Notes

Add internal notes about customers:
1. Open customer profile
2. Click "Add Note"
3. Type note content
4. Save note

Notes are visible to all team members.

### Customer Segmentation

Organize customers with tags:
- VIP
- Wholesale
- Frequent Buyer
- New Customer
- At Risk (no recent orders)

**Create Custom Tags:**
1. Go to Settings > Customer Tags
2. Add new tag
3. Assign color and rules
4. Save

## Product Management

Manage your product catalog efficiently.

### Product List

**View Products:**
- Grid or list view
- Product image
- Name and SKU
- Price
- Stock quantity
- Status (Active/Inactive)

**Filtering:**
- Category
- Stock status (In Stock, Low Stock, Out of Stock)
- Price range
- Search by name/SKU

### Product Details

Click product to view:

**Basic Information:**
- Product name
- SKU (Stock Keeping Unit)
- Description
- Category
- Brand

**Pricing:**
- Regular price
- Sale price (if applicable)
- Cost price (for profit margin)

**Inventory:**
- Current stock
- Low stock threshold
- Stock location
- Reorder point

**Images:**
- Primary image
- Additional images
- Gallery view

**Sales Data:**
- Total sold
- Revenue generated
- Average rating
- Number of reviews

### Adding Products

1. Click "Add Product" button
2. Fill product form:
   ```
   Name: [Product Name]
   SKU: [PROD-001]
   Description: [Product description]
   
   Pricing:
   Price: [$99.99]
   Cost: [$50.00]
   
   Inventory:
   Stock: [100]
   Low Stock Alert: [10]
   
   Category: [Select category]
   ```
3. Upload images
4. Click "Save Product"

### Updating Stock

**Manual Update:**
1. Open product details
2. Click "Update Stock"
3. Enter new quantity
4. Add note (reason for change)
5. Save

**Bulk Update:**
1. Import CSV with stock data
2. System validates and updates
3. Review change report

### Stock Alerts

Set up low stock notifications:
1. Go to product settings
2. Set "Low Stock Threshold"
3. Choose notification method:
   - Email alert
   - Dashboard notification
   - SMS (if configured)

### Product Variants

For products with variations (size, color, etc.):

1. Enable "Has Variants"
2. Add variant types:
   - Size: Small, Medium, Large
   - Color: Red, Blue, Green
3. Set pricing per variant (if different)
4. Track stock per variant

## Workflow Automation

Automate repetitive tasks and improve efficiency.

### Understanding Workflows

Workflows are rules that automatically perform actions when conditions are met.

**Components:**
1. **Trigger**: What starts the workflow
2. **Conditions**: When the workflow runs
3. **Actions**: What the workflow does

### Common Workflow Examples

#### Example 1: Auto-Confirm High-Value Orders

```
Trigger: Order Created
Condition: Total Amount >= $1000
Actions:
  - Update Status to "CONFIRMED"
  - Send Email to Admin
  - Add Tag "High Value"
```

#### Example 2: Low Stock Alert

```
Trigger: Product Stock Changed
Condition: Stock <= Low Stock Threshold
Actions:
  - Send Email to Manager
  - Create Task "Reorder Product"
  - Update Product Status "Low Stock"
```

#### Example 3: Auto-Assign Orders

```
Trigger: Order Created
Condition: Status = "PENDING"
Actions:
  - Assign to Next Available Agent
  - Send Email to Assigned Agent
```

### Creating a Workflow

1. Navigate to "Workflows" section
2. Click "Create Workflow"
3. Configure workflow:

   **Step 1: Basic Info**
   ```
   Name: [Workflow Name]
   Description: [What this workflow does]
   Enabled: [✓ Yes]
   ```

   **Step 2: Trigger**
   - Select trigger event:
     - Order Created
     - Order Updated
     - Order Status Changed
     - Customer Created
     - Product Stock Changed
     - Time-Based (scheduled)

   **Step 3: Conditions**
   - Add conditions:
     ```
     If Order Total Amount >= 1000
     AND Order Status = PENDING
     ```

   **Step 4: Actions**
   - Add actions:
     ```
     1. Update Order Status to "CONFIRMED"
     2. Send Email (Template: high-value-order)
     3. Assign to User: manager@example.com
     ```

4. Test workflow (optional)
5. Save and activate

### Managing Workflows

**View Workflows:**
- List of all workflows
- Status (Active/Inactive)
- Last run time
- Success rate

**Edit Workflow:**
1. Click workflow name
2. Modify settings
3. Save changes

**Disable Workflow:**
1. Toggle "Enabled" switch
2. Confirm

**View Logs:**
1. Click "View Logs"
2. See execution history
3. Check for errors

### Workflow Best Practices

✅ **Do:**
- Test workflows before activating
- Use descriptive names
- Add detailed descriptions
- Monitor workflow logs
- Start simple, then add complexity

❌ **Don't:**
- Create conflicting workflows
- Use too many actions in one workflow
- Set up infinite loops
- Forget to test edge cases

## Analytics & Reports

Track performance and make data-driven decisions.

### Dashboard Analytics

**Key Metrics Overview:**
- Total orders (with trend)
- Revenue (with growth %)
- Customer count
- Average order value
- Conversion rate

**Time Period Selection:**
- Today
- Yesterday
- Last 7 days
- Last 30 days
- This month
- Last month
- Custom range

### Order Analytics

**Order Metrics:**
- Total orders by status
- Order completion rate
- Average processing time
- Orders by source (Shopify, WooCommerce, etc.)

**Order Trends:**
- Orders over time (line chart)
- Peak order times
- Day-of-week analysis
- Seasonal patterns

**Geographic Distribution:**
- Orders by country/state/city
- Map visualization
- Top locations

### Customer Analytics

**Customer Metrics:**
- Total customers
- New customers (period)
- Returning customers
- Customer retention rate
- Churn rate

**Customer Behavior:**
- Average lifetime value
- Purchase frequency
- Average order value per customer
- Customer segments

**Top Customers:**
- Highest spending customers
- Most frequent buyers
- At-risk customers (no recent orders)

### Product Analytics

**Product Performance:**
- Top selling products
- Revenue by product
- Products by quantity sold
- Low performing products

**Inventory Analytics:**
- Stock levels
- Products out of stock
- Products low on stock
- Stock turnover rate

**Category Performance:**
- Revenue by category
- Best performing categories
- Category growth trends

### Generating Reports

**Standard Reports:**
1. Go to "Reports" section
2. Select report type:
   - Sales Report
   - Customer Report
   - Product Report
   - Inventory Report
3. Choose date range
4. Click "Generate"

**Custom Reports:**
1. Click "Custom Report"
2. Select metrics:
   - Choose dimensions (what to measure)
   - Choose measures (how to measure)
   - Add filters
3. Choose visualization:
   - Table
   - Chart (line, bar, pie)
   - Combined
4. Preview report
5. Save or export

**Export Options:**
- PDF
- Excel (XLSX)
- CSV
- Print

### Scheduled Reports

Set up automatic report delivery:

1. Create/open report
2. Click "Schedule"
3. Configure:
   ```
   Frequency: [Daily/Weekly/Monthly]
   Time: [09:00 AM]
   Recipients: [email1@example.com, email2@example.com]
   Format: [PDF/Excel]
   ```
4. Save schedule

## Settings

Configure the system to match your business needs.

### General Settings

**Business Information:**
- Company name
- Contact email
- Phone number
- Address
- Website URL

**Regional Settings:**
- Currency (USD, EUR, etc.)
- Date format (MM/DD/YYYY, DD/MM/YYYY)
- Time zone
- Language

### Order Settings

**Order Numbering:**
- Prefix (e.g., "ORD-")
- Starting number
- Padding (ORD-0001 vs ORD-1)

**Order Processing:**
- Auto-confirm orders (Yes/No)
- Require approval for high-value orders
- Threshold amount
- Default payment method

**Order Statuses:**
- Customize status names
- Add/remove statuses
- Set status colors
- Define allowed transitions

### Notification Settings

**Email Notifications:**
- Enable/disable email notifications
- SMTP configuration
- Email templates
- Sender name and address

**Notification Types:**
- Order created (customer)
- Order confirmed (customer)
- Order shipped (customer)
- Order delivered (customer)
- Order cancelled (customer)
- Low stock alert (admin)
- New order alert (admin)

**SMS Notifications (if configured):**
- Enable/disable SMS
- SMS provider settings
- SMS templates

### User Management

**Users:**
- Add new users
- Edit user details
- Deactivate users
- Reset passwords

**Roles & Permissions:**
- Define roles (Admin, Manager, Agent)
- Set permissions per role
- Create custom roles

**Permission Matrix:**
```
                 Admin  Manager  Agent
Orders: View      ✓      ✓       ✓
Orders: Create    ✓      ✓       ✓
Orders: Edit      ✓      ✓       ✓
Orders: Delete    ✓      ✓       ✗
Customers: View   ✓      ✓       ✓
Customers: Edit   ✓      ✓       ✗
Products: View    ✓      ✓       ✓
Products: Edit    ✓      ✓       ✗
Analytics: View   ✓      ✓       ✗
Settings: Edit    ✓      ✗       ✗
```

### Integration Settings

**Shopify Integration:**
- API credentials
- Store URL
- Webhook setup
- Sync frequency

**WooCommerce Integration:**
- Consumer key
- Consumer secret
- Store URL
- API version

**Custom Webhooks:**
- Add webhook URLs
- Configure events
- Set security keys

## Role-Based Guides

### For Administrators

**Daily Tasks:**
- Monitor system health
- Review workflow automation
- Check user activity logs
- Review flagged orders

**Weekly Tasks:**
- Analyze performance reports
- Adjust workflow rules
- Review user permissions
- Update system settings

**Monthly Tasks:**
- Generate comprehensive reports
- Review customer feedback
- Plan system improvements
- Audit security logs

### For Managers

**Daily Tasks:**
- Review pending orders
- Monitor team performance
- Approve high-value orders
- Check inventory levels

**Weekly Tasks:**
- Generate team reports
- Conduct team meetings
- Review customer satisfaction
- Identify bottlenecks

**Monthly Tasks:**
- Performance reviews
- Revenue analysis
- Goal setting
- Process improvements

### For Agents

**Daily Tasks:**
- Process assigned orders
- Update order statuses
- Respond to customer inquiries
- Add order notes

**Best Practices:**
- Check your assigned orders first
- Keep order statuses updated
- Add detailed notes
- Flag issues for manager review
- Maintain customer communication

## Tips & Best Practices

### Order Processing Tips

1. **Review Orders Promptly**
   - Check new orders within 1 hour
   - Verify customer details
   - Confirm product availability

2. **Keep Statuses Updated**
   - Update status as work progresses
   - Don't batch update at end of day
   - Use notes to explain status changes

3. **Communication**
   - Keep customers informed
   - Set realistic delivery expectations
   - Proactively address issues

4. **Quality Checks**
   - Verify addresses before shipping
   - Double-check order contents
   - Confirm payment amounts

### Efficiency Tips

1. **Use Keyboard Shortcuts**
   - Learn and use shortcuts (see section below)
   - Saves significant time

2. **Bulk Operations**
   - Use bulk status updates for similar orders
   - Export/import for large data changes

3. **Filters & Views**
   - Create saved filter views
   - Quick access to common searches

4. **Automation**
   - Set up workflows for repetitive tasks
   - Let the system work for you

### Data Quality Tips

1. **Customer Data**
   - Always verify email addresses
   - Standardize phone number format
   - Complete all address fields

2. **Product Data**
   - Use consistent SKU format
   - Keep descriptions up-to-date
   - Accurate stock levels

3. **Order Data**
   - Add notes for special cases
   - Document customer requests
   - Track issues and resolutions

## Troubleshooting

### Common Issues

**Can't Login**
- Verify email and password
- Check caps lock
- Try password reset
- Contact admin if account is locked

**Orders Not Showing**
- Check filter settings
- Verify date range
- Clear all filters and retry
- Refresh the page

**Drag and Drop Not Working**
- Refresh the browser
- Check browser compatibility
- Try different browser
- Clear browser cache

**Export Failed**
- Check data size (may be too large)
- Try smaller date range
- Check internet connection
- Retry after few minutes

**Webhook Not Receiving Orders**
- Verify webhook URL is correct
- Check HMAC secret key
- Review webhook logs
- Test with webhook testing tool

### Getting Help

1. **Built-in Help**
   - Click "?" icon in any screen
   - Hover over fields for tooltips

2. **Documentation**
   - Refer to this user guide
   - Check API documentation
   - Review FAQ section

3. **Support**
   - Email: support@example.com
   - Live chat (if available)
   - Support ticket system

## Keyboard Shortcuts

### Global Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + K` | Quick search |
| `Ctrl/Cmd + N` | New order |
| `Ctrl/Cmd + ,` | Settings |
| `Esc` | Close modal/dialog |
| `?` | Show keyboard shortcuts |

### Navigation

| Shortcut | Action |
|----------|--------|
| `G then D` | Go to Dashboard |
| `G then O` | Go to Orders |
| `G then C` | Go to Customers |
| `G then P` | Go to Products |
| `G then A` | Go to Analytics |

### Order Management

| Shortcut | Action |
|----------|--------|
| `N` | New order (in orders view) |
| `E` | Edit selected order |
| `Delete` | Delete selected order |
| `Ctrl/Cmd + A` | Select all |
| `Ctrl/Cmd + D` | Deselect all |

### Kanban Board

| Shortcut | Action |
|----------|--------|
| `Arrow Keys` | Navigate between orders |
| `Enter` | Open selected order |
| `Space` | Quick status update |
| `1-7` | Move to status column 1-7 |

---

**Need more help?**  
Contact our support team at support@example.com or check our FAQ section.

**Last Updated:** 2025-10-08
