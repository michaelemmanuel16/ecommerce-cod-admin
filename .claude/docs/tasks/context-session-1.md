# Context Session 1 - Upsell Description and Image Upload

> **🔒 MANDATORY FIELDS MARKED WITH (REQUIRED)**
> This file is the single source of truth for this feature development session.
> All sub-agents MUST read this file before starting research.

## Project Overview (REQUIRED)
**Feature/Task:** Add description and image upload fields to checkout form upsells/add-ons
**Started:** 2025-10-28
**Status:** Planning
**Session Number:** 1

## Current State (REQUIRED)
- **What has been done:**
  - Checkout form builder exists with upsell/add-on functionality
  - Upsells currently support: name, price (min/max), quantity, and "Popular" flag
  - Public checkout page displays upsells, but lacks description and images

- **Current architecture:**
  - Backend: Node.js/Express with Prisma ORM (PostgreSQL)
  - Frontend: React/Vite with Shadcn UI components
  - File uploads: Currently used for delivery proofs and product images (multer middleware exists)
  - Checkout forms stored in `CheckoutForm` model with JSON field for form configuration

- **Existing files involved:**
  - `backend/src/controllers/checkoutFormController.ts` - Checkout form CRUD
  - `backend/src/services/checkoutFormService.ts` - Business logic
  - `backend/src/routes/checkoutFormRoutes.ts` - API routes
  - `frontend/src/pages/CheckoutForms.tsx` - Checkout form builder UI
  - `frontend/src/pages/PublicCheckout.tsx` - Public-facing checkout page
  - `frontend/src/services/checkout-forms.service.ts` - API client
  - `backend/prisma/schema.prisma` - Database schema
  - `backend/src/config/multer.ts` - File upload configuration (existing)

- **Dependencies:**
  - Multer (already installed for file uploads)
  - Shadcn UI Textarea component (may need to add)
  - Image storage location (currently using local filesystem for other uploads)

## Goals (REQUIRED)
- [ ] Add description field to upsells (multiline text, optional)
- [ ] Add image upload capability to upsells (single image, optional)
- [ ] Display description and image on public checkout page
- [ ] Store uploaded images securely with proper validation
- [ ] Update checkout form builder UI with description textarea and image upload

## Sub-Agent Research Tasks

### Research Phase (REQUIRED - Track all delegated research)
- [x] **database-architect** → `.claude/docs/database-architect-plan.md` - [Status: Complete]
  - Analyze current CheckoutForm schema structure
  - Recommend how to add description and imageUrl fields to upsells
  - Consider data validation and constraints

- [x] **backend-developer** → `.claude/docs/backend-developer-plan.md` - [Status: Complete]
  - Review existing file upload implementation (multer config, routes)
  - Recommend API endpoints for upsell image uploads
  - Analyze checkoutFormController/Service for needed changes
  - Suggest validation rules for description and images

- [x] **frontend-developer** → `.claude/docs/frontend-developer-plan.md` - [Status: Complete]
  - Review checkout form builder UI structure
  - Recommend Shadcn components for description and image upload
  - Analyze how upsells are rendered on public checkout page
  - Suggest state management approach for new fields

### Research Summary (REQUIRED - Fill after reading all plans)
**Plans Read:**
- `.claude/docs/database-architect-plan.md`
- `.claude/docs/backend-developer-plan.md`
- `.claude/docs/frontend-developer-plan.md`

**Key Recommendations:**

**From database-architect:**
- **CRITICAL FINDING:** `description` field ALREADY EXISTS in FormUpsell schema (line 467 of schema.prisma)!
- Backend already handles description in service and controller layers
- Frontend types are missing description field (out of sync)
- Only need to add `imageUrl String? @map("image_url")` to database
- Follow existing pattern from Product model which also has imageUrl
- Low-risk migration: nullable column, backward compatible, simple ALTER TABLE
- Estimated time: 20 minutes for database changes

**From backend-developer:**
- **INFRASTRUCTURE READY:** Multer config, /api/upload endpoint, and static file serving already exist
- Upload endpoint configured with 5MB limit and MIME type validation
- Description field already passed through service/controller layers
- Only need to add imageUrl to TypeScript interfaces and CRUD operations
- Recommend implementing image cleanup utility when upsells are deleted
- Add validation rules for imageUrl format and description XSS prevention
- Estimated time: 3-4 hours for backend changes

**From frontend-developer:**
- **PATTERN EXISTS:** ProductForm.tsx (lines 101-325) has complete image upload implementation to copy
- Textarea component already exists at `frontend/src/components/ui/Textarea.tsx`
- Current UpsellEditor uses single-row grid - need multi-row layout for new fields
- Recommend: Row 1 (name/price/qty/popular/delete), Row 2 (description), Row 3 (image)
- Use Map<number, {file, preview}> to track pending uploads in parent component
- Upload all images with Promise.all() in onSubmit before saving form
- Public checkout page needs conditional rendering for image and description
- Estimated time: 4-5 hours for frontend changes

## Implementation Plan (REQUIRED - Based on research)

### Phase 1: Database Migration (BLOCKING)
**Source:** database-architect-plan.md
**Files:** `backend/prisma/schema.prisma`
**Complexity:** Low

1. Add `imageUrl String? @map("image_url")` to FormUpsell model (line 467)
2. Run `npm run prisma:generate`
3. Run `npm run prisma:migrate -- --name add_upsell_image_url`
4. Verify migration successful

**Why blocking:** All other changes depend on Prisma types being updated

### Phase 2: Backend Service Layer
**Source:** backend-developer-plan.md
**Files:** `backend/src/services/checkoutFormService.ts`
**Complexity:** Low

1. Add `imageUrl?: string` to CreateCheckoutFormData interface (line ~26)
2. Add `imageUrl?: string` to UpdateCheckoutFormData interface (line ~54)
3. Update createCheckoutForm to include imageUrl in upsell creation (line ~111)
4. Update updateCheckoutForm to include imageUrl in upsell update (line ~410)

### Phase 3: Backend Controller & Validation
**Source:** backend-developer-plan.md
**Files:** `backend/src/controllers/checkoutFormController.ts`, `backend/src/routes/checkoutFormRoutes.ts`
**Complexity:** Low

1. Add imageUrl to upsell mapping in createCheckoutForm (line ~152)
2. Add imageUrl to upsell mapping in updateCheckoutForm (line ~277)
3. Add description validation with XSS prevention (escape HTML)
4. Add imageUrl validation (URL format, no directory traversal)

### Phase 4: Frontend Types
**Source:** frontend-developer-plan.md
**Files:** `frontend/src/types/checkout-form.ts`, `frontend/src/services/public-orders.service.ts`
**Complexity:** Low

1. Add `description?: string` to Upsell interface
2. Add `imageUrl?: string` to Upsell interface
3. Update PublicCheckoutForm upsells type with description and imageUrl

### Phase 5: Frontend Checkout Builder - Description
**Source:** frontend-developer-plan.md
**Files:** `frontend/src/pages/CheckoutForms.tsx`
**Complexity:** Medium

1. Import Textarea component
2. Restructure UpsellEditor from single-row to multi-row layout
3. Add description textarea (full-width, row 2)
4. Update state handlers to include description

### Phase 6: Frontend Checkout Builder - Image Upload
**Source:** frontend-developer-plan.md
**Files:** `frontend/src/pages/CheckoutForms.tsx`
**Complexity:** High

1. Add upsellImages Map state to track pending uploads
2. Add handleUpsellImageSelect handler (file validation, preview creation)
3. Add handleRemoveUpsellImage handler (cleanup preview URLs)
4. Add image upload UI to UpsellEditor (row 3)
5. Update form submission to upload all images via Promise.all()
6. Add cleanup on unmount (revoke all preview URLs)

### Phase 7: Frontend Public Checkout Display
**Source:** frontend-developer-plan.md
**Files:** `frontend/src/pages/PublicCheckout.tsx`
**Complexity:** Medium

1. Update AddOnSelector to conditionally show expanded content
2. Add image display (responsive, lazy loading)
3. Add description display (preserve line breaks)
4. Only show "More Info" button if description or image exists

### Phase 8: Testing & Validation
**Source:** All plans
**Complexity:** Medium

1. Manual testing of all workflows
2. Test edge cases (large files, invalid formats, etc.)
3. Verify cleanup logic works (no orphaned files)
4. Test public checkout page rendering

## Decisions Made (REQUIRED)

**Decision 1:** Reuse existing /api/upload endpoint
**Rationale:** Already configured with proper validation (MIME types, file size limits)
**Source:** backend-developer-plan.md

**Decision 2:** Use Map<number, {file, preview}> for pending uploads
**Rationale:** Efficient lookups by index, easy to manage multiple upsells
**Source:** frontend-developer-plan.md

**Decision 3:** Upload images in parallel with Promise.all()
**Rationale:** Faster than sequential uploads, better UX
**Source:** frontend-developer-plan.md

**Decision 4:** Multi-row layout for UpsellEditor
**Rationale:** Single-row grid cannot fit new fields without becoming cluttered
**Source:** frontend-developer-plan.md

**Decision 5:** Defer image cleanup utility to optional enhancement
**Rationale:** Focus on MVP functionality first, cleanup can be added later if needed
**Source:** backend-developer-plan.md (marked as optional)

## Implementation Progress
- [x] Database migration
- [x] Backend service layer
- [x] Backend controller and validation
- [x] Frontend types
- [x] Frontend description UI
- [x] Frontend image upload
- [x] Public checkout display
- [ ] Testing and validation

## Technical Constraints (REQUIRED)
- **Technology stack:**
  - Backend: Node.js 18+, Express, Prisma, PostgreSQL
  - Frontend: React 18, Vite, TypeScript, Shadcn UI
  - File uploads: Multer (already configured)

- **Performance requirements:**
  - Image file size limits (recommend max 5MB)
  - Supported formats: JPG, PNG, WebP

- **Security requirements:**
  - File upload validation (MIME type, file size)
  - Sanitize description text (XSS prevention)
  - Authenticated endpoints for admin operations

- **Browser/environment support:**
  - Modern browsers (Chrome, Firefox, Safari, Edge)
  - Mobile-responsive image uploads

## Deviations from Research Plans
*Document any times you deviate from sub-agent recommendations and why*

## Issues & Blockers
*Track issues as they arise*

## Testing Notes
- Unit tests: Backend services and controllers
- Integration tests: API endpoints with file uploads
- E2E tests: Checkout form builder with image upload workflow
- Manual testing: Public checkout page rendering

## Next Actions
- [ ] Delegate research to database-architect
- [ ] Delegate research to backend-developer
- [ ] Delegate research to frontend-developer
- [ ] Read all research plans
- [ ] Create implementation plan based on research
- [ ] Execute implementation
- [ ] Test and verify

## Notes & Lessons Learned
*To be filled during implementation*

---
**Last Updated:** 2025-10-28 (Research Complete, Starting Implementation)
**Updated By:** Parent Agent (Main Claude Session)
**Session Status:** Active - Implementation Phase
