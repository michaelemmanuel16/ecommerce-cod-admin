# Backend Developer Research Plan - Upsell Description & Image Upload

**Agent:** backend-developer  
**Task:** Research backend implementation for adding description and image upload to upsells  
**Status:** Research Complete  
**Date:** 2025-10-28

## Executive Summary

**Complexity:** Medium  
**Estimated Implementation Time:** 3-4 hours  
**Key Finding:** Upload infrastructure already exists! Just need to extend it for upsells.

### Infrastructure Status

✅ **Already Implemented:**
- Multer configuration for image uploads (5MB limit, MIME validation)
- Upload endpoint `/api/upload` with authentication
- Static file serving at `/uploads`
- Description field in database schema and code

❌ **Needs Implementation:**
- Add `imageUrl` field to database schema
- Update TypeScript interfaces with imageUrl
- Pass imageUrl through service/controller layers
- Add validation rules for imageUrl
- Implement image cleanup on upsell deletion (optional but recommended)

## Existing Upload Infrastructure

### Multer Configuration (`backend/src/config/multer.ts`)

**Current setup (lines 1-60):**
```typescript
- Storage: Local filesystem at `backend/uploads/`
- File naming: `{nameWithoutExt}-{timestamp}-{random}{ext}`
- Allowed MIME types: image/jpeg, image/jpg, image/png, image/gif, image/webp
- File size limit: 5MB (configurable at line 42)
- File filter validates MIME types (lines 27-35)
```

**✅ No changes needed** - Perfect for upsell images

### Upload Endpoint (`backend/src/controllers/uploadController.ts`)

**Endpoint:** `POST /api/upload`  
**Authentication:** Required (line 9 of uploadRoutes.ts)  
**Request:** `multipart/form-data` with `image` field  

**Response format:**
```json
{
  "success": true,
  "message": "Image uploaded successfully",
  "imageUrl": "http://localhost:3000/uploads/image-1234567890-abc123.jpg",
  "url": "http://localhost:3000/uploads/image-1234567890-abc123.jpg",
  "file": {
    "filename": "image-1234567890-abc123.jpg",
    "originalName": "original.jpg",
    "mimetype": "image/jpeg",
    "size": 45678
  }
}
```

**✅ No changes needed** - Frontend will use imageUrl from response

### Static File Serving (`backend/src/server.ts:74`)

```typescript
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
```

Files accessible at: `http://localhost:3000/uploads/{filename}`

**✅ No changes needed**

## Current Upsell Data Flow

### Database Schema

**FormUpsell model (backend/prisma/schema.prisma:463-477):**
```prisma
model FormUpsell {
  id          Int      @id @default(autoincrement())
  formId      Int      @map("form_id")
  name        String
  description String?  // ✅ ALREADY EXISTS!
  price       Float
  items       Json
  sortOrder   Int      @default(0)
  createdAt   DateTime @default(now())
  
  form CheckoutForm @relation(...)
}
```

**Need to add:** `imageUrl String? @map("image_url")`

### Service Layer (`backend/src/services/checkoutFormService.ts`)

**CreateCheckoutFormData interface (lines 23-29):**
```typescript
upsells?: Array<{
  name: string;
  description?: string;  // ✅ Already has description
  price: number;
  items: any;
  sortOrder?: number;
  // ⭐ ADD: imageUrl?: string;
}>;
```

**UpdateCheckoutFormData interface (lines 51-58):**
```typescript
upsells?: Array<{
  id?: string;
  name: string;
  description?: string;  // ✅ Already has description
  price: number;
  items: any;
  sortOrder?: number;
  // ⭐ ADD: imageUrl?: string;
}>;
```

**Create method (lines 108-114):**
```typescript
// Current code
FormUpsell.create({
  name: upsell.name,
  description: upsell.description,  // ✅ Already passes description
  price: upsell.price,
  items: upsell.items,
  sortOrder: upsell.sortOrder !== undefined ? upsell.sortOrder : index
  // ⭐ ADD: imageUrl: upsell.imageUrl
})
```

**Update method (lines 407-429):**
```typescript
// Uses delete-and-recreate pattern
// Need to add imageUrl to recreate operations
```

### Controller Layer (`backend/src/controllers/checkoutFormController.ts`)

**Create handler (lines 149-156):**
```typescript
upsells.map((upsell: any, index: number) => ({
  name: upsell.name,
  description: upsell.description,  // ✅ Already passes description
  price: upsell.price,
  items: upsell.items,
  sortOrder: upsell.sortOrder !== undefined ? upsell.sortOrder : index
  // ⭐ ADD: imageUrl: upsell.imageUrl
}))
```

**Update handler (lines 274-282):**
```typescript
// Same pattern - add imageUrl to mapping
```

### Public API (`backend/src/controllers/publicOrderController.ts`)

**Get form endpoint (lines 27-30):**
```typescript
upsells: {
  where: {},
  orderBy: { sortOrder: 'asc' }
  // ✅ Will auto-include imageUrl after Prisma regeneration
}
```

**Current response includes:** id, name, description, price, items  
**After migration:** Will automatically include imageUrl

## Implementation Plan

### Phase 1: Database Schema Migration ⭐ BLOCKING

**File:** `backend/prisma/schema.prisma`  
**Action:** Add imageUrl field to FormUpsell model

**Changes:**
```prisma
model FormUpsell {
  id          Int      @id @default(autoincrement())
  formId      Int      @map("form_id")
  name        String
  description String?
  imageUrl    String?  @map("image_url")  // ⭐ ADD THIS
  price       Float
  items       Json
  sortOrder   Int      @default(0)
  createdAt   DateTime @default(now())
  
  form CheckoutForm @relation(fields: [formId], references: [id], onDelete: Cascade)
  
  @@index([formId])
  @@map("form_upsells")
}
```

**Steps:**
1. Edit schema.prisma
2. Run `npm run prisma:generate`
3. Run `npm run prisma:migrate -- --name add_upsell_image_url`

**Why blocking:** All other changes depend on Prisma types being updated

### Phase 2: Service Layer Types

**File:** `backend/src/services/checkoutFormService.ts`  
**Lines to modify:** 23-29, 51-58, 108-114, 407-429

**Changes needed:**

```typescript
// 1. Add to CreateCheckoutFormData interface (line ~26)
upsells?: Array<{
  name: string;
  description?: string;
  imageUrl?: string;  // ⭐ ADD
  price: number;
  items: any;
  sortOrder?: number;
}>;

// 2. Add to UpdateCheckoutFormData interface (line ~54)
upsells?: Array<{
  id?: string;
  name: string;
  description?: string;
  imageUrl?: string;  // ⭐ ADD
  price: number;
  items: any;
  sortOrder?: number;
}>;

// 3. Update createCheckoutForm method (line ~111)
upsells: {
  create: data.upsells.map((upsell, index) => ({
    name: upsell.name,
    description: upsell.description,
    imageUrl: upsell.imageUrl,  // ⭐ ADD
    price: upsell.price,
    items: upsell.items,
    sortOrder: upsell.sortOrder !== undefined ? upsell.sortOrder : index
  }))
}

// 4. Update updateCheckoutForm method (line ~410)
// In the upsell creation part
const newUpsell = await tx.formUpsell.create({
  data: {
    formId,
    name: upsell.name,
    description: upsell.description,
    imageUrl: upsell.imageUrl,  // ⭐ ADD
    price: upsell.price,
    items: upsell.items,
    sortOrder: upsell.sortOrder !== undefined ? upsell.sortOrder : index
  }
});
```

**Estimated time:** 30 minutes

### Phase 3: Controller Layer

**File:** `backend/src/controllers/checkoutFormController.ts`  
**Lines to modify:** 149-156, 274-282

**Changes needed:**

```typescript
// In createCheckoutForm handler (line ~152)
upsells: upsells.map((upsell: any, index: number) => ({
  name: upsell.name,
  description: upsell.description,
  imageUrl: upsell.imageUrl,  // ⭐ ADD
  price: upsell.price,
  items: upsell.items,
  sortOrder: upsell.sortOrder !== undefined ? upsell.sortOrder : index
}))

// In updateCheckoutForm handler (line ~277)
upsells: upsells.map((upsell: any, index: number) => ({
  id: upsell.id,
  name: upsell.name,
  description: upsell.description,
  imageUrl: upsell.imageUrl,  // ⭐ ADD
  price: upsell.price,
  items: upsell.items,
  sortOrder: upsell.sortOrder !== undefined ? upsell.sortOrder : index
}))
```

**Estimated time:** 20 minutes

### Phase 4: Validation Rules

**File:** `backend/src/routes/checkoutFormRoutes.ts`  
**Lines to modify:** 25-28

**Changes needed:**

```typescript
// Add after description validation (line ~27)
body('upsells.*.imageUrl')
  .optional()
  .matches(/^(https?:\/\/.+|\/uploads\/.+)$/)
  .withMessage('Image URL must be a valid URL or upload path'),
```

**Alternative validation (more strict):**
```typescript
body('upsells.*.imageUrl')
  .optional()
  .custom((value) => {
    if (!value) return true; // Optional field
    
    // Prevent directory traversal
    if (value.includes('..')) {
      throw new Error('Invalid image URL (directory traversal attempt)');
    }
    
    // Must be upload path or http(s) URL
    if (!value.match(/^(https?:\/\/.+|\/uploads\/.+)$/)) {
      throw new Error('Image URL must be a valid URL or upload path');
    }
    
    return true;
  })
```

**Also add description validation (currently missing):**
```typescript
body('upsells.*.description')
  .optional()
  .trim()
  .escape()  // Prevent XSS
  .isLength({ max: 500 })
  .withMessage('Description must be less than 500 characters')
```

**Estimated time:** 15 minutes

### Phase 5: Image Cleanup (Optional but Recommended)

**Purpose:** Delete image files when upsells are removed

**Create utility file:** `backend/src/utils/fileCleanup.ts`

```typescript
import fs from 'fs';
import path from 'path';
import logger from './logger';

export const deleteUploadedFile = (imageUrl: string): void => {
  try {
    if (!imageUrl || !imageUrl.includes('/uploads/')) {
      return; // Not a local upload, skip
    }
    
    const filename = path.basename(imageUrl);
    const filePath = path.join(__dirname, '../../uploads', filename);
    
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      logger.info('Deleted file', { filename });
    }
  } catch (error) {
    logger.error('Failed to delete file', { imageUrl, error });
    // Don't throw - file deletion failures shouldn't break operations
  }
};
```

**Update service:** `backend/src/services/checkoutFormService.ts`

```typescript
import { deleteUploadedFile } from '../utils/fileCleanup';

// In updateCheckoutForm method (before deleting upsells)
const upsellsToDelete = await tx.formUpsell.findMany({
  where: {
    formId,
    id: upsellIdsToKeep.length > 0 ? { notIn: upsellIdsToKeep } : undefined
  },
  select: { imageUrl: true }
});

// Delete from database
await tx.formUpsell.deleteMany({
  where: {
    formId,
    id: upsellIdsToKeep.length > 0 ? { notIn: upsellIdsToKeep } : undefined
  }
});

// Clean up files after transaction commits
upsellsToDelete.forEach(u => {
  if (u.imageUrl) deleteUploadedFile(u.imageUrl);
});
```

**Estimated time:** 45 minutes

## API Workflow

### Frontend Upload Flow

1. **User selects image in checkout form builder**
2. **Frontend uploads to /api/upload:**
   ```typescript
   const formData = new FormData();
   formData.append('image', file);
   
   const response = await apiClient.post('/upload', formData);
   // Returns: { imageUrl: "/uploads/image-123.jpg" }
   ```

3. **Frontend stores imageUrl in upsell object:**
   ```typescript
   const upsell = {
     name: "Extra Battery",
     description: "Add an extra battery pack",
     imageUrl: response.data.imageUrl,  // From upload response
     price: 25.00,
     items: { quantity: 1 }
   };
   ```

4. **Frontend submits checkout form with upsells:**
   ```typescript
   await checkoutFormsService.create({
     ...formData,
     upsells: [upsell]  // Includes imageUrl
   });
   ```

5. **Backend saves imageUrl to database**

6. **Public checkout page fetches form with upsells including imageUrl**

### Updated API Responses

**Create/Update Checkout Form:**
```json
POST /api/checkout-forms
PUT /api/checkout-forms/:id

Request Body:
{
  "name": "Magic Copybook Order Form",
  "slug": "magic-copybook",
  "upsells": [
    {
      "name": "Extra Ink Refill Packs",
      "description": "Keep practicing for months without re-ordering.\n• 1 Extra Pen\n• 10 Extra Refill Disappearing Ink\n• 1 Extra Pen Holder",
      "imageUrl": "/uploads/refill-pack-1730123456789-abc123.jpg",
      "price": 150.00,
      "items": { "quantity": 1 },
      "sortOrder": 0
    }
  ]
}
```

**Get Public Form:**
```json
GET /api/public/forms/:slug

Response:
{
  "form": {
    "id": 1,
    "name": "Magic Copybook Order Form",
    "slug": "magic-copybook",
    "upsells": [
      {
        "id": 123,
        "name": "Extra Ink Refill Packs",
        "description": "Keep practicing for months...",
        "imageUrl": "/uploads/refill-pack-1730123456789-abc123.jpg",
        "price": 150.00,
        "items": { "quantity": 1 }
      }
    ]
  }
}
```

## Security Considerations

### Authentication & Authorization

✅ **Already secured:**
- Upload endpoint requires authentication (`authenticate` middleware)
- Form CRUD requires admin/super_admin role
- Public form endpoint is read-only (no auth required)

### File Upload Security

✅ **Already implemented:**
- MIME type validation (only images allowed)
- File size limit (5MB max)
- Random filename generation (prevents overwrites)

⚠️ **Need to add:**
- Description XSS validation (escape HTML)
- ImageUrl directory traversal prevention
- ImageUrl format validation

### Recommended Validation

```typescript
// In checkoutFormRoutes.ts
body('upsells.*.description')
  .optional()
  .trim()
  .escape()  // ⭐ CRITICAL: Prevents XSS attacks
  .isLength({ max: 500 }),

body('upsells.*.imageUrl')
  .optional()
  .custom((value) => {
    if (value && value.includes('..')) {
      throw new Error('Directory traversal attempt detected');
    }
    return true;
  })
```

## Testing Strategy

### Unit Tests

**File:** `backend/src/__tests__/unit/checkoutFormService.test.ts`

**Test cases:**
```typescript
describe('Upsells with imageUrl', () => {
  it('should create upsell with imageUrl', async () => {
    const data = {
      name: 'Test Form',
      upsells: [{
        name: 'Test Upsell',
        description: 'Test description',
        imageUrl: '/uploads/test.jpg',
        price: 10,
        items: {}
      }]
    };
    
    const form = await checkoutFormService.createCheckoutForm(data);
    expect(form.upsells[0].imageUrl).toBe('/uploads/test.jpg');
  });
  
  it('should handle missing imageUrl', async () => {
    const data = {
      name: 'Test Form',
      upsells: [{
        name: 'Test Upsell',
        price: 10,
        items: {}
        // No imageUrl
      }]
    };
    
    const form = await checkoutFormService.createCheckoutForm(data);
    expect(form.upsells[0].imageUrl).toBeNull();
  });
  
  it('should update upsell imageUrl', async () => {
    // Create with imageUrl1
    // Update to imageUrl2
    // Verify changed
  });
  
  it('should remove imageUrl when set to null', async () => {
    // Create with imageUrl
    // Update to null
    // Verify removed
  });
});
```

### Integration Tests

**File:** `backend/src/__tests__/integration/checkoutForm.test.ts`

**Test scenarios:**
```typescript
describe('Upsell Image Upload Integration', () => {
  it('should upload image and create form with upsell', async () => {
    // 1. Upload image via POST /api/upload
    // 2. Extract imageUrl from response
    // 3. Create form with upsell containing imageUrl
    // 4. Verify imageUrl in database
    // 5. Verify file exists in uploads directory
  });
  
  it('should delete image when upsell is removed', async () => {
    // 1. Create form with upsell + image
    // 2. Update form to remove upsell
    // 3. Verify file deleted from filesystem
  });
  
  it('should return imageUrl in public API', async () => {
    // 1. Create form with upsell + imageUrl
    // 2. GET /api/public/forms/:slug
    // 3. Verify imageUrl in response
  });
});
```

### Manual Testing Checklist

- [ ] Upload image via POST /api/upload, verify file saved
- [ ] Create checkout form with upsell containing imageUrl
- [ ] Verify image accessible at /uploads/{filename}
- [ ] Update upsell with new imageUrl
- [ ] Verify old image deleted (if cleanup implemented)
- [ ] Remove imageUrl from upsell, verify image deleted
- [ ] Delete entire form, verify all upsell images deleted
- [ ] GET /api/public/forms/:slug, verify imageUrl in response
- [ ] Test with various image formats (JPG, PNG, WebP, GIF)
- [ ] Test file size limit (upload >5MB, expect 400 error)
- [ ] Test invalid MIME type (upload PDF, expect 400 error)
- [ ] Test directory traversal (imageUrl with `..`, expect validation error)

## Performance Considerations

### Current Performance

✅ **Efficient:**
- Static file serving via express.static (fast)
- Single database query for upsells (Prisma include)
- Synchronous file I/O acceptable for <5MB files

### Future Optimizations

**For production:**
1. **CDN integration:**
   - Migrate from local filesystem to S3 + CloudFront
   - Update uploadController to upload to S3
   - Return CDN URL instead of local path
   - See existing TODO at uploadController.ts:16-17

2. **Image optimization:**
   - Add Sharp library for resizing/compression
   - Generate thumbnails for faster loading
   - Convert to WebP for better compression

3. **Caching:**
   - Add Cache-Control headers to /uploads routes
   - Browser caching reduces bandwidth

**For MVP:** Current setup is sufficient

## Summary of Changes

### Files to Modify

1. ✅ `backend/prisma/schema.prisma` - Add imageUrl field
2. ✅ `backend/src/services/checkoutFormService.ts` - Update interfaces and CRUD
3. ✅ `backend/src/controllers/checkoutFormController.ts` - Pass imageUrl through
4. ✅ `backend/src/routes/checkoutFormRoutes.ts` - Add validation
5. ⭐ `backend/src/utils/fileCleanup.ts` - Create utility (optional)

### Files That Don't Need Changes

- ❌ `backend/src/config/multer.ts` - Already configured
- ❌ `backend/src/controllers/uploadController.ts` - Already works
- ❌ `backend/src/routes/uploadRoutes.ts` - Already configured
- ❌ `backend/src/server.ts` - Static file serving already set up

### Estimated Implementation Time

- Phase 1 (Database): 15 minutes
- Phase 2 (Service layer): 30 minutes
- Phase 3 (Controller): 20 minutes
- Phase 4 (Validation): 15 minutes
- Phase 5 (Cleanup - optional): 45 minutes
- Testing: 1-2 hours

**Total: 3-4 hours**

## Next Steps for Parent Agent

1. ✅ Execute database migration (Phase 1 - BLOCKING)
2. ✅ Update service layer (Phase 2)
3. ✅ Update controller layer (Phase 3)
4. ✅ Add validation rules (Phase 4)
5. ⭐ Implement file cleanup (Phase 5 - recommended)
6. ✅ Write unit/integration tests
7. ✅ Manual testing with frontend integration

**Key Insight:** Infrastructure is 90% complete. Just need to wire up imageUrl field through the stack and add cleanup logic.
