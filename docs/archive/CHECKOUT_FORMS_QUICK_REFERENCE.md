# Checkout Forms - Quick Reference

## Access the Feature
- **URL**: `/checkout-forms`
- **Menu**: Click "Checkout Forms" in the left sidebar (after Products)

## Files Created

### Core Components (5 files)
```
frontend/src/
├── pages/CheckoutForms.tsx              # Main page with forms list
├── components/forms/
│   ├── CheckoutFormBuilder.tsx          # Form builder modal (11KB)
│   ├── FormFieldEditor.tsx              # Field config row (3.2KB)
│   ├── PackageEditor.tsx                # Package config row (2KB)
│   └── UpsellEditor.tsx                 # Upsell config row (2KB)
├── components/ui/Textarea.tsx           # Textarea component
└── types/checkout-form.ts               # TypeScript types
```

### Updated Files (4 files)
```
frontend/src/
├── App.tsx                              # Added route
├── types/index.ts                       # Re-exported types
├── components/layout/Sidebar.tsx        # Added menu item
└── components/ui/Badge.tsx              # Added variants
```

## Features

### Checkout Form Builder Sections
1. **Basic Info**
   - Product selection dropdown
   - Description textarea

2. **Form Fields**
   - Default: Full Name, Phone, Alt Phone, Country, Region, Address
   - Add custom fields
   - Types: Text, Phone, Textarea, Select
   - Required/Enabled toggles
   - Drag-and-drop ordering (UI ready)

3. **Product Packages**
   - Name, Price, Quantity, Popular flag
   - Add custom or from existing products

4. **Upsells/Add-ons**
   - Name, Price, Quantity, Popular flag
   - Add custom or from existing products

5. **Settings**
   - Default country (Ghana, Nigeria, Kenya)

6. **Styling**
   - Button color (default: #0f172a)
   - Accent color (default: #f97316)
   - Native color pickers + hex inputs

### Form Management
- ✅ Create new forms
- ✅ Edit existing forms
- ✅ Delete forms
- ✅ Clone/duplicate forms
- ✅ Toggle active/inactive
- ✅ View statistics (field/package/upsell counts)
- ✅ Preview (opens in new tab)

## Next Steps (Backend Integration)

### 1. Create Database Schema
Add to `backend/prisma/schema.prisma`:
```prisma
model CheckoutForm {
  id          String   @id @default(cuid())
  productId   String
  description String
  fields      Json     // FormField[]
  packages    Json     // ProductPackage[]
  upsells     Json     // Upsell[]
  settings    Json     // CheckoutFormSettings
  styling     Json     // CheckoutFormStyling
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  product     Product  @relation(fields: [productId], references: [id])
}
```

### 2. Create Backend API
Create `backend/src/routes/checkoutFormRoutes.ts`:
- GET    /api/checkout-forms
- POST   /api/checkout-forms
- GET    /api/checkout-forms/:id
- PUT    /api/checkout-forms/:id
- DELETE /api/checkout-forms/:id
- POST   /api/checkout-forms/:id/duplicate
- PATCH  /api/checkout-forms/:id/status

### 3. Create Frontend Service
Create `frontend/src/services/checkout-forms.service.ts`:
```typescript
import { apiClient } from './api';
import { CheckoutForm } from '../types';

export const checkoutFormsService = {
  getForms: () => 
    apiClient.get<CheckoutForm[]>('/checkout-forms'),
  getForm: (id: string) => 
    apiClient.get<CheckoutForm>(`/checkout-forms/${id}`),
  createForm: (data: Partial<CheckoutForm>) => 
    apiClient.post<CheckoutForm>('/checkout-forms', data),
  updateForm: (id: string, data: Partial<CheckoutForm>) => 
    apiClient.put<CheckoutForm>(`/checkout-forms/${id}`, data),
  deleteForm: (id: string) => 
    apiClient.delete(`/checkout-forms/${id}`),
  duplicateForm: (id: string) => 
    apiClient.post<CheckoutForm>(`/checkout-forms/${id}/duplicate`),
  toggleStatus: (id: string, isActive: boolean) => 
    apiClient.patch<CheckoutForm>(`/checkout-forms/${id}/status`, { isActive }),
};
```

### 4. Update CheckoutForms.tsx
Replace TODO comments with actual service calls:
```typescript
import { checkoutFormsService } from '../services/checkout-forms.service';

// In fetchForms()
const response = await checkoutFormsService.getForms();
setForms(response.data);

// In handleSaveForm()
if (selectedForm) {
  await checkoutFormsService.updateForm(selectedForm.id, formData);
} else {
  await checkoutFormsService.createForm(formData);
}
```

## Default Form Fields
The builder pre-populates with these fields:
1. Full Name (text, required)
2. Phone (phone, required)
3. Alt Phone (phone, optional)
4. Country/Region (select, required) - Ghana/Nigeria/Kenya
5. Region/State (text, required)
6. Street Address (textarea, required)

## Styling Defaults
- Button Color: `#0f172a` (dark slate)
- Accent Color: `#f97316` (orange)
- Both support color picker + manual hex input

## Testing Checklist
- [ ] Navigate to /checkout-forms
- [ ] Click "Create Form" button
- [ ] Select a product from dropdown
- [ ] Add description
- [ ] Modify default fields
- [ ] Add custom field
- [ ] Add package
- [ ] Add upsell
- [ ] Change colors
- [ ] Save form
- [ ] Verify form appears in list
- [ ] Edit form
- [ ] Clone form
- [ ] Toggle active/inactive
- [ ] Delete form

## Documentation Files
1. `CHECKOUT_FORMS_IMPLEMENTATION.md` - Detailed implementation guide
2. `CHECKOUT_FORMS_STRUCTURE.txt` - Component tree visualization
3. `CHECKOUT_FORMS_QUICK_REFERENCE.md` - This file

