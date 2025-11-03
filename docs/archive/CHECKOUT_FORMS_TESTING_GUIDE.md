# Checkout Forms Testing Guide

## Quick Start

### 1. Start Backend
```bash
cd backend
npm run dev
# Server runs on http://localhost:3000
```

### 2. Start Frontend
```bash
cd frontend
npm run dev
# UI runs on http://localhost:5173
```

## Testing Workflow

### Step 1: Create a Product (Prerequisites)
1. Login to admin dashboard: `http://localhost:5173/login`
2. Navigate to **Products** in sidebar
3. Create a product:
   - Name: "Magic Copybook"
   - SKU: "MAGIC-COPY-001"
   - Category: "Educational"
   - Price: 250.00
   - Stock: 100
   - Click **Create Product**

### Step 2: Create a Checkout Form

1. Navigate to **Checkout Forms** in sidebar (new menu item)
2. Click **"+ Create Checkout Form"** button
3. Fill in the form builder:

**Basic Info:**
- Form Name: "Magic Copybook Order Form"
- Product: Select "Magic Copybook" from dropdown
- Description: "Get your Magic Copybook delivered to your doorstep"

**Form Fields** (Pre-configured):
- Full Name ✓ Required ✓ Enabled
- Phone ✓ Required ✓ Enabled
- Alternative Phone ✓ Enabled
- Country/Region ✓ Required ✓ Enabled
- Region/State ✓ Required ✓ Enabled
- Street Address ✓ Required ✓ Enabled

**Product Packages:**
Click **"Add Custom Package"** and add:

1. Package 1:
   - Name: "Buy 1 Set"
   - Price: 250.00
   - Quantity: 1
   - Popular: No

2. Package 2:
   - Name: "Buy 2 Sets"
   - Price: 450.00
   - Quantity: 2
   - Popular: Yes (toggle on)

3. Package 3:
   - Name: "Buy 3 Sets"
   - Price: 675.00
   - Quantity: 3
   - Popular: No

**Upsells/Add-ons:**
Click **"Add Custom Upsell"** and add:

1. Extra Ink Refill Pack:
   - Name: "Extra Magic Ink Refill Packs (+ Silicone Grip)"
   - Description: "Keep practicing for months without re-ordering."
   - Price: 150.00
   - Items:
     ```json
     ["1 Extra Pen", "10 Extra Refill Disappearing Ink", "1 Extra Pen Holder"]
     ```

**Form Settings:**
- Default Country: Ghana

**Styling Settings:**
- Button Color: #0f172a (navy blue)
- Accent Color: #f97316 (orange)

4. Click **"Create Form"**
5. Note the **slug** generated (e.g., "magic-copybook-order-form")

### Step 3: Test Public Checkout Form

1. Open new browser tab (or incognito mode - no login needed!)
2. Go to: `http://localhost:5173/order/magic-copybook-order-form`
3. You should see the beautiful checkout form with:
   - Product title "Magic Copybook"
   - Customer information fields
   - Package selection cards (with "Most Popular" badge on 2 Sets)
   - Optional add-ons section
   - Live order summary on the right

### Step 4: Submit Test Order

Fill in the form:
- **Full Name**: John Doe
- **Phone**: 0241234567 (10-digit Ghana format)
- **Alternative Phone**: 0201234567
- **Region/State**: Greater Accra
- **Street Address**: 123 Liberation Road, Accra

Select Package:
- Click on "Buy 2 Sets - GHC 450.00" (the popular one)

Add Optional Upsell:
- Click the **+** button on "Extra Magic Ink Refill Packs"
- Verify total updates to GHC 600.00

Click **"Place Order"**

### Step 5: Verify Order Creation

After submitting, you should:
1. See success page with order number (e.g., "ORD-1234567890-00001")
2. The order should appear in **Orders** page in admin dashboard
3. Customer should be auto-created if phone number is new

### Step 6: View Order in Admin

1. Go back to admin dashboard
2. Navigate to **Orders**
3. Find the order you just created
4. Verify:
   - Customer name: John Doe
   - Phone: 0241234567
   - Total: GHC 600.00
   - Status: pending_confirmation
   - Source: checkout-form
   - Order contains 2x Magic Copybook + 1x Extra Ink Refill Pack

## API Endpoints

### Admin Endpoints (Require Auth)
```
GET    /api/checkout-forms           # List all forms
GET    /api/checkout-forms/:id       # Get form by ID
POST   /api/checkout-forms           # Create form
PUT    /api/checkout-forms/:id       # Update form
DELETE /api/checkout-forms/:id       # Delete form
GET    /api/checkout-forms/:id/stats # Form statistics
```

### Public Endpoints (No Auth)
```
GET    /api/public/forms/:slug             # Get form by slug
POST   /api/public/forms/:slug/orders      # Submit order
GET    /api/public/orders/track            # Track order
       ?orderNumber=XXX&phoneNumber=YYY
```

## Test Data Examples

### Create Form Request (POST /api/checkout-forms)
```json
{
  "name": "Magic Copybook Order Form",
  "slug": "magic-copybook",
  "productId": "clxxx123456",
  "description": "Order your Magic Copybook today!",
  "fields": {
    "fullName": { "type": "text", "required": true, "enabled": true },
    "phone": { "type": "phone", "required": true, "enabled": true },
    "alternatePhone": { "type": "phone", "required": false, "enabled": true },
    "region": { "type": "select", "required": true, "enabled": true },
    "address": { "type": "textarea", "required": true, "enabled": true }
  },
  "regions": ["Greater Accra", "Ashanti", "Western", "Eastern", "Central"],
  "styling": {
    "buttonColor": "#0f172a",
    "accentColor": "#f97316"
  },
  "packages": [
    { "name": "Buy 1 Set", "price": 250, "quantity": 1, "isPopular": false },
    { "name": "Buy 2 Sets", "price": 450, "quantity": 2, "isPopular": true },
    { "name": "Buy 3 Sets", "price": 675, "quantity": 3, "isPopular": false }
  ],
  "upsells": [
    {
      "name": "Extra Ink Refill Pack",
      "price": 150,
      "description": "Keep practicing for months",
      "items": ["1 Extra Pen", "10 Refills", "1 Pen Holder"]
    }
  ]
}
```

### Submit Order Request (POST /api/public/forms/:slug/orders)
```json
{
  "customerInfo": {
    "fullName": "John Doe",
    "phone": "0241234567",
    "alternatePhone": "0201234567",
    "region": "Greater Accra",
    "address": "123 Liberation Road, Accra"
  },
  "selectedPackage": {
    "id": "pkg-123",
    "name": "Buy 2 Sets",
    "price": 450,
    "quantity": 2
  },
  "selectedUpsells": [
    {
      "id": "ups-456",
      "name": "Extra Ink Refill Pack",
      "price": 150
    }
  ],
  "totalAmount": 600
}
```

## Troubleshooting

### Form Not Loading
- Check backend is running on port 3000
- Verify product exists in database
- Check browser console for API errors
- Ensure slug is correct in URL

### Order Not Creating
- Check phone number format (must be 10 digits)
- Verify all required fields are filled
- Check backend logs for validation errors
- Ensure product has sufficient stock

### Styling Issues
- Clear browser cache
- Check button/accent colors in form settings
- Verify Shadcn components are properly imported

## Database Queries

### View All Checkout Forms
```sql
SELECT * FROM checkout_forms;
```

### View Form with Packages
```sql
SELECT
  cf.name,
  cf.slug,
  fp.name as package_name,
  fp.price,
  fp.quantity
FROM checkout_forms cf
LEFT JOIN form_packages fp ON cf.id = fp.form_id
ORDER BY cf.created_at DESC;
```

### View Form Submissions
```sql
SELECT
  fs.id,
  fs.total_amount,
  o.order_number,
  c.first_name,
  c.phone_number,
  fs.created_at
FROM form_submissions fs
JOIN orders o ON fs.order_id = o.id
JOIN customers c ON o.customer_id = c.id
ORDER BY fs.created_at DESC;
```

## Success Criteria

✅ Form builder loads without errors
✅ Can create/edit/delete checkout forms
✅ Public form loads at `/order/:slug` without authentication
✅ Can select packages and add-ons
✅ Order summary calculates totals correctly
✅ Order submits successfully
✅ Customer auto-created if new phone number
✅ Order appears in admin dashboard
✅ Order items include selected package + upsells
✅ Form submission tracked in `form_submissions` table

## Next Steps

1. **Seed Sample Data**: Create sample products and forms for testing
2. **Email Notifications**: Send order confirmation to customers
3. **SMS Integration**: Send order updates via SMS
4. **Analytics**: Track conversion rates per form
5. **Custom Domains**: Host public forms on custom domain
6. **Payment Integration**: Add payment gateway options
