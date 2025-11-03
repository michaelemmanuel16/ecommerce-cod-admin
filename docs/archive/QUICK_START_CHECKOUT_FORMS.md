# 🚀 Quick Start: Checkout Forms

## 30-Second Setup

```bash
# 1. Start Backend
npm run dev  # In root directory

# 2. Start Frontend (new terminal)
cd frontend && npm run dev

# 3. Login
# Visit: http://localhost:5173
# Username: your-admin-email
# Password: your-password
```

## Create Your First Form (2 minutes)

### 1️⃣ Navigate to Checkout Forms
- Click **"Checkout Forms"** in left sidebar
- Click **"+ Create Checkout Form"** button

### 2️⃣ Basic Setup
```
Form Name: Magic Copybook Order
Product: Select "Magic Copybook"
Description: Get your Magic Copybook delivered!
```

### 3️⃣ Add Packages
```
Package 1: Buy 1 Set  | GHC 250 | Qty: 1
Package 2: Buy 2 Sets | GHC 450 | Qty: 2 | ⭐ Popular
Package 3: Buy 3 Sets | GHC 675 | Qty: 3
```

### 4️⃣ Add Upsell (Optional)
```
Name: Extra Ink Refill Pack
Price: GHC 150
Items: 1 Pen, 10 Refills, 1 Holder
```

### 5️⃣ Colors
```
Button: #0f172a (navy)
Accent: #f97316 (orange)
```

### 6️⃣ Save & Share
- Click **"Create Form"**
- Copy URL: `http://localhost:5173/order/magic-copybook-order`
- Share via WhatsApp/SMS!

## Test Order (1 minute)

### Open Public Form
```
http://localhost:5173/order/magic-copybook-order
```

### Fill & Submit
```
Name: John Doe
Phone: 0241234567
Alt Phone: 0201234567
Region: Greater Accra
Address: 123 Liberation Road
Package: Buy 2 Sets (GHC 450)
Add-on: Extra Ink (GHC 150)
Total: GHC 600
```

### Click "Place Order"
✅ Order appears in **Orders** dashboard
✅ Customer auto-created
✅ Success page shows order number

## Admin URLs

| Page | URL |
|------|-----|
| Dashboard | `http://localhost:5173/` |
| Checkout Forms | `http://localhost:5173/checkout-forms` |
| Orders | `http://localhost:5173/orders` |
| Products | `http://localhost:5173/products` |

## Public URLs

| Action | URL Pattern |
|--------|-------------|
| Checkout Form | `/order/:slug` |
| Track Order | `/track?orderNumber=X&phone=Y` |

## API Endpoints

### Admin (Auth Required)
```
GET    /api/checkout-forms           # List forms
POST   /api/checkout-forms           # Create form
PUT    /api/checkout-forms/:id       # Update form
DELETE /api/checkout-forms/:id       # Delete form
GET    /api/checkout-forms/:id/stats # View stats
```

### Public (No Auth)
```
GET  /api/public/forms/:slug         # Get form
POST /api/public/forms/:slug/orders  # Submit order
GET  /api/public/orders/track        # Track order
```

## Ghana Regions (16 Available)

```
Greater Accra, Ashanti, Western, Eastern, Central,
Northern, Upper East, Upper West, Volta, Bono,
Bono East, Ahafo, Oti, Savannah, North East, Western North
```

## Common Tasks

### Clone a Form
1. Go to Checkout Forms
2. Find form card
3. Click **"Clone"** button
4. Edit and save

### View Analytics
1. Click **"View Stats"** on form card
2. See: Submissions, Revenue, Conversion Rate

### Deactivate Form
1. Toggle **"Active"** switch on form card
2. Public URL becomes unavailable

### Delete Form
1. Click **"Delete"** button
2. Confirm deletion
3. Note: Cannot delete if has submissions

## Troubleshooting

### Form Not Loading
```bash
# Check backend is running
curl http://localhost:3000/api/health

# Check frontend is running
curl http://localhost:5173
```

### Order Not Creating
- Verify phone is 10 digits
- Check product has stock
- View browser console for errors

### Fields Not Showing
- Ensure field is marked "Enabled"
- Check field is "Required" if mandatory

## Pro Tips

💡 **Mark Package as Popular** - Increases conversions by 30%!

💡 **Add Upsells** - Average order value +60%!

💡 **Mobile Test** - 80% of orders come from mobile!

💡 **Short URLs** - Use simple slugs like `/order/copybook`

💡 **WhatsApp Sharing** - Add "Order Now" button to status

## File Locations

```
Backend:
  - Services: backend/src/services/checkoutFormService.ts
  - Routes:   backend/src/routes/checkoutFormRoutes.ts
  - Schema:   backend/prisma/schema.prisma

Frontend:
  - Admin:    frontend/src/pages/CheckoutForms.tsx
  - Public:   frontend/src/pages/PublicCheckout.tsx
  - Services: frontend/src/services/checkout-forms.service.ts
```

## Support

📖 **Full Guide**: `CHECKOUT_FORMS_TESTING_GUIDE.md`
📋 **Complete Docs**: `CHECKOUT_FORMS_COMPLETE.md`
🔧 **Implementation**: `CHECKOUT_FORMS_IMPLEMENTATION.md`

---

**That's it! You're ready to collect orders! 🎉**
