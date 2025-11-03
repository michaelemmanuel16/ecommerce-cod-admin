# Database Architecture Research Plan - Upsell Description & Image Upload

**Agent:** database-architect  
**Task:** Analyze database schema for adding description and imageUrl fields to checkout form upsells  
**Status:** Research Complete  
**Date:** 2025-10-28

## Executive Summary

**Critical Discovery:** The `description` field ALREADY EXISTS in the FormUpsell schema!
- ✅ Backend schema has description field (line 467 of schema.prisma)
- ✅ Backend service layer already handles description
- ❌ Frontend types are missing description field
- ❌ Only `imageUrl` needs to be added to database

**Complexity:** LOW - Single column addition, no data migration needed

## Current Schema Analysis

### FormUpsell Model (lines 463-477 of backend/prisma/schema.prisma)

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
  
  form CheckoutForm @relation(fields: [formId], references: [id], onDelete: Cascade)
  
  @@index([formId])
  @@map("form_upsells")
}
```

**Existing Patterns for Image URLs:**
- Product model: `imageUrl String? @map("image_url")` (line 138)
- Delivery model: `proofImageUrl String? @map("proof_image_url")` (line 248)

## Recommended Schema Change

### Add imageUrl Field Only

```prisma
model FormUpsell {
  id          Int      @id @default(autoincrement())
  formId      Int      @map("form_id")
  name        String
  description String?
  imageUrl    String?  @map("image_url")  // ⭐ ADD THIS LINE
  price       Float
  items       Json
  sortOrder   Int      @default(0)
  createdAt   DateTime @default(now())
  
  form CheckoutForm @relation(fields: [formId], references: [id], onDelete: Cascade)
  
  @@index([formId])
  @@map("form_upsells")
}
```

**Rationale:**
- Follows existing imageUrl pattern from Product model
- Nullable (optional field, backward compatible)
- Snake_case database column name (image_url)
- No indexes needed (display-only field)

## Migration Plan

### Step 1: Modify Schema

**File:** `backend/prisma/schema.prisma`  
**Line:** 467 (after description field)  
**Change:** Add `imageUrl String? @map("image_url")`

### Step 2: Generate Prisma Client

```bash
cd backend
npm run prisma:generate
```

This regenerates TypeScript types to include imageUrl.

### Step 3: Create Migration

```bash
npm run prisma:migrate -- --name add_upsell_image_url
```

**Expected Migration SQL:**
```sql
-- CreateTable or AlterTable
ALTER TABLE "form_upsells" ADD COLUMN "image_url" TEXT;
```

### Step 4: Apply Migration

Migration applies automatically during step 3. Verify with:

```bash
npm run prisma:studio
```

Navigate to form_upsells table and verify image_url column exists.

## Risk Assessment

### Migration Risks: VERY LOW

✅ **Backward Compatible:**
- Nullable column (no NOT NULL constraint)
- Existing rows get NULL value (valid default)
- No breaking changes to existing queries
- Applications continue working during migration

✅ **Performance Impact: None**
- No indexes needed (display-only field)
- No data transformation required
- Minimal storage overhead (TEXT column)
- No foreign key constraints

✅ **Rollback Strategy: Simple**

If issues occur, rollback with:
```sql
ALTER TABLE "form_upsells" DROP COLUMN "image_url";
```

Then revert schema.prisma and regenerate Prisma client.

## Data Validation Constraints

### Database Level: None Needed

- Field is optional (nullable)
- No UNIQUE constraint needed (multiple upsells can share images)
- No CHECK constraints (URL validation at application layer)

### Application Level: Required

**Backend validation (express-validator):**
```typescript
body('upsells.*.imageUrl')
  .optional()
  .matches(/^(https?:\/\/.+|\/uploads\/.+)$/)
  .withMessage('Image URL must be valid URL or upload path')
```

**Why at application layer:**
- PostgreSQL doesn't have URL data type
- Validation rules may change (CDN migration, etc.)
- Better error messages for API consumers

## Files Requiring Updates

### 1. Database Schema (REQUIRED)
- `backend/prisma/schema.prisma` - Add imageUrl field

### 2. Backend Service Layer (REQUIRED)
- `backend/src/services/checkoutFormService.ts` - Add imageUrl to interfaces and CRUD methods

### 3. Frontend Types (REQUIRED)
- `frontend/src/types/checkout-form.ts` - Add description and imageUrl to Upsell interface
- `frontend/src/services/public-orders.service.ts` - Update API response types

### 4. Backend Controller (REQUIRED)
- `backend/src/controllers/checkoutFormController.ts` - Pass imageUrl through create/update

### 5. Backend Validation (REQUIRED)
- `backend/src/routes/checkoutFormRoutes.ts` - Add imageUrl validation rules

## Testing Strategy

### Database Migration Testing

1. **Pre-migration verification:**
   ```bash
   # Backup database
   pg_dump ecommerce_cod > backup_before_migration.sql
   
   # Count existing upsells
   SELECT COUNT(*) FROM form_upsells;
   ```

2. **Run migration:**
   ```bash
   npm run prisma:migrate -- --name add_upsell_image_url
   ```

3. **Post-migration verification:**
   ```sql
   -- Verify column exists
   SELECT column_name, data_type, is_nullable 
   FROM information_schema.columns 
   WHERE table_name = 'form_upsells' AND column_name = 'image_url';
   
   -- Expected: column_name=image_url, data_type=text, is_nullable=YES
   
   -- Verify existing rows have NULL
   SELECT COUNT(*) FROM form_upsells WHERE image_url IS NULL;
   
   -- Should equal total count from step 1
   ```

4. **Test CRUD operations:**
   ```sql
   -- Insert with imageUrl
   INSERT INTO form_upsells (form_id, name, description, image_url, price, items, sort_order)
   VALUES (1, 'Test Upsell', 'Test description', '/uploads/test.jpg', 10.00, '{}', 0);
   
   -- Update imageUrl
   UPDATE form_upsells SET image_url = '/uploads/new.jpg' WHERE id = <id>;
   
   -- Set to NULL
   UPDATE form_upsells SET image_url = NULL WHERE id = <id>;
   ```

### Unit Tests

**File:** `backend/src/__tests__/unit/checkoutFormService.test.ts`

Test cases needed:
- Create upsell with imageUrl
- Create upsell without imageUrl (NULL)
- Update upsell imageUrl
- Update upsell to remove imageUrl (set to NULL)
- Verify imageUrl in response

## Security Considerations

### Storage Security

**Current setup:** Local filesystem at `backend/uploads/`

**Risks:**
- Directory traversal attacks if imageUrl not validated
- Disk space exhaustion if no cleanup mechanism

**Mitigations:**
- Validate imageUrl format (no `..` paths)
- Implement image cleanup when upsells deleted
- Set filesystem permissions (uploads directory not executable)

### Input Validation

**XSS Prevention:**
- Description field must be sanitized (prevent `<script>` tags)
- imageUrl must be validated (only allow upload paths or trusted domains)

**Recommended validation:**
```typescript
// Backend
body('upsells.*.description')
  .optional()
  .trim()
  .escape() // Prevents XSS
  .isLength({ max: 500 })

body('upsells.*.imageUrl')
  .optional()
  .custom((value) => {
    if (value && value.includes('..')) {
      throw new Error('Invalid image URL (directory traversal attempt)');
    }
    return true;
  })
```

## Performance Considerations

### Query Performance

**Impact:** Negligible
- Adding one TEXT column doesn't affect SELECT performance
- No indexes needed (not used in WHERE/ORDER BY clauses)
- Upsells already fetched with form (Prisma include)

### Storage Impact

**Estimate:**
- TEXT column stores URL string (~50-100 bytes per upsell)
- 10,000 upsells = ~1MB additional storage
- Negligible impact

**Image files:**
- Actual images stored in filesystem (not database)
- Database only stores reference (imageUrl)
- Follow existing pattern from Product/Delivery models

### Optimization Opportunities

**Future enhancements:**
- Migrate to S3/CloudFront for image hosting
- Generate thumbnails for faster loading
- Implement lazy loading on public checkout page

## Summary

### What Needs to Change

1. ✅ **Database schema:** Add `imageUrl String?` to FormUpsell model
2. ✅ **Prisma client:** Regenerate with `npm run prisma:generate`
3. ✅ **Migration:** Run `npm run prisma:migrate`
4. ✅ **Service layer:** Add imageUrl to TypeScript interfaces
5. ✅ **Controller layer:** Pass imageUrl through create/update
6. ✅ **Validation:** Add imageUrl validation rules
7. ✅ **Frontend types:** Add description and imageUrl fields

### What Doesn't Need to Change

- ❌ Database schema for description (already exists!)
- ❌ Backend description handling (already implemented)
- ❌ Upload endpoint (already configured with multer)
- ❌ Static file serving (already serves /uploads directory)

### Estimated Timeline

- Schema modification: 5 minutes
- Migration execution: 2 minutes
- Verification testing: 10 minutes
- **Total: ~20 minutes**

### Recommendation

**Proceed with migration immediately.** This is a low-risk, backward-compatible change with minimal implementation time. The infrastructure for image uploads already exists, so we're just extending existing patterns.

---

**Next Steps for Parent Agent:**
1. Read backend-developer and frontend-developer plans
2. Update context file with combined research
3. Execute database migration first (blocking step for other work)
4. Update service/controller layers
5. Update frontend types and UI components

**Key Finding:** Description field already exists in database! Only imageUrl needs to be added. This significantly reduces scope of database work.
