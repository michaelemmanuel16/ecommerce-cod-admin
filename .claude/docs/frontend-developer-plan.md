# Frontend Developer Research Plan - Upsell Description & Image Upload

**Agent:** frontend-developer  
**Task:** Research frontend implementation for adding description and image upload to upsells  
**Status:** Research Complete  
**Date:** 2025-10-28

## Executive Summary

**Complexity:** Medium  
**Estimated Implementation Time:** 4-5 hours  
**Key Pattern:** Follow ProductForm.tsx image upload implementation exactly

### Quick Wins

✅ **Already exists:**
- Textarea component (`frontend/src/components/ui/Textarea.tsx`)
- Upload endpoint `/api/upload` (backend)
- Image upload pattern in ProductForm.tsx (lines 101-325)
- API client handles multipart/form-data

❌ **Needs implementation:**
- Add description and imageUrl to frontend types
- Add description textarea to checkout form builder
- Add image upload component to checkout form builder
- Update public checkout page to display images and descriptions
- Manage image upload state in parent component

## Current Codebase Analysis

### Type Definitions

**File:** `frontend/src/types/checkout-form.ts`

**Current Upsell type (lines 54-60):**
```typescript
export interface Upsell {
  id?: number;
  name: string;
  // ❌ MISSING: description?: string;
  // ❌ MISSING: imageUrl?: string;
  price: number;
  minPrice?: number;
  maxPrice?: number;
  quantity?: number;
  items: {
    quantity?: number;
    minQuantity?: number;
    maxQuantity?: number;
  };
  sortOrder?: number;
  popular?: boolean;
}
```

**Needs to add:**
```typescript
export interface Upsell {
  id?: number;
  name: string;
  description?: string;  // ⭐ ADD
  imageUrl?: string;     // ⭐ ADD
  price: number;
  minPrice?: number;
  maxPrice?: number;
  quantity?: number;
  items: {
    quantity?: number;
    minQuantity?: number;
    maxQuantity?: number;
  };
  sortOrder?: number;
  popular?: boolean;
}
```

### Checkout Form Builder UI

**File:** `frontend/src/pages/CheckoutForms.tsx`

**Current UpsellEditor component (lines 96-202):**
```typescript
const UpsellEditor = ({ upsell, index, onUpdate, onDelete }: UpsellEditorProps) => {
  return (
    <div className="grid grid-cols-[1fr_120px_100px_80px_40px] gap-2 items-start">
      {/* Name input */}
      <Input
        type="text"
        value={upsell.name}
        onChange={(e) => onUpdate(index, { ...upsell, name: e.target.value })}
        placeholder="Upsell Name"
      />
      
      {/* Price inputs (min/max) */}
      <div className="space-y-1">
        <Input type="number" placeholder="Min Price" />
        <Input type="number" placeholder="Max Price" />
      </div>
      
      {/* Quantity inputs */}
      <div className="space-y-1">
        <Input type="number" placeholder="Min Qty" />
        <Input type="number" placeholder="Max Qty" />
      </div>
      
      {/* Popular checkbox */}
      <div className="flex items-center justify-center h-10">
        <input type="checkbox" checked={upsell.popular} />
      </div>
      
      {/* Delete button */}
      <Button variant="ghost" onClick={() => onDelete(index)}>
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
};
```

**Problems:**
- Single row grid layout - no room for description or image
- No description textarea
- No image upload component

**Recommended new layout:**
```
Row 1: [Name] [Min/Max Price] [Min/Max Qty] [Popular] [Delete]
Row 2: [Description Textarea - full width]
Row 3: [Image Upload Area - centered or left-aligned]
```

### Public Checkout Page

**File:** `frontend/src/pages/PublicCheckout.tsx`

**Current AddOnSelector component (lines 450-490):**
```typescript
const AddOnSelector = ({ upsell, selected, onToggle, onIncrement, onDecrement, count }: AddOnSelectorProps) => {
  const [expanded, setExpanded] = React.useState(false);
  
  return (
    <div className={`border rounded-lg p-4 ${selected ? 'border-blue-500 bg-blue-50' : ''}`}>
      {/* Header with checkbox, name, price */}
      <div className="flex items-start gap-3">
        <input type="checkbox" checked={selected} onChange={onToggle} />
        <div className="flex-1">
          <div className="font-medium">{upsell.name}</div>
          <div className="text-sm text-gray-600">
            +GH₵{upsell.price.toFixed(2)}
          </div>
        </div>
        {upsell.popular && <Badge variant="secondary">Most Popular</Badge>}
      </div>
      
      {/* Expandable content */}
      {expanded && (
        <div className="mt-3 text-sm text-gray-600">
          Details about this add-on will appear here.
        </div>
      )}
      
      {/* Expand/Collapse button */}
      <button onClick={() => setExpanded(!expanded)} className="text-blue-600 text-sm mt-2">
        {expanded ? 'Less Info' : 'More Info'}
      </button>
      
      {/* Quantity controls (if selected) */}
      {selected && (
        <div className="mt-3 flex items-center gap-2">
          <Button onClick={onDecrement}>-</Button>
          <span>{count}</span>
          <Button onClick={onIncrement}>+</Button>
        </div>
      )}
    </div>
  );
};
```

**Needs update:**
- Replace "Details about this add-on..." with actual description
- Add image display above or beside description
- Handle missing description/image gracefully

## Recommended Implementation Plan

### Phase 1: Update Frontend Types

**File:** `frontend/src/types/checkout-form.ts`  
**Line:** 54-60

**Changes:**
```typescript
export interface Upsell {
  id?: number;
  name: string;
  description?: string;  // ⭐ ADD
  imageUrl?: string;     // ⭐ ADD
  price: number;
  minPrice?: number;
  maxPrice?: number;
  quantity?: number;
  items: {
    quantity?: number;
    minQuantity?: number;
    maxQuantity?: number;
  };
  sortOrder?: number;
  popular?: boolean;
}
```

**File:** `frontend/src/services/public-orders.service.ts`  
**Line:** ~15-25 (PublicCheckoutForm type)

**Add to upsells type:**
```typescript
upsells: Array<{
  id: number;
  name: string;
  description?: string;  // ⭐ ADD
  imageUrl?: string;     // ⭐ ADD
  price: number;
  items: any;
}>;
```

**Estimated time:** 10 minutes

### Phase 2: Update Checkout Form Builder - Description

**File:** `frontend/src/pages/CheckoutForms.tsx`

**Import Textarea component:**
```typescript
import { Textarea } from '@/components/ui/Textarea';
```

**Update UpsellEditor layout (lines 96-202):**
```typescript
const UpsellEditor = ({ upsell, index, onUpdate, onDelete }: UpsellEditorProps) => {
  return (
    <div className="border rounded-lg p-4 space-y-3">
      {/* Row 1: Name, Price, Quantity, Popular, Delete */}
      <div className="grid grid-cols-[1fr_120px_100px_80px_40px] gap-2 items-start">
        <Input
          type="text"
          value={upsell.name}
          onChange={(e) => onUpdate(index, { ...upsell, name: e.target.value })}
          placeholder="Upsell Name"
        />
        
        {/* Price inputs */}
        <div className="space-y-1">
          <Input
            type="number"
            value={upsell.minPrice || ''}
            onChange={(e) => onUpdate(index, { 
              ...upsell, 
              minPrice: parseFloat(e.target.value) || undefined 
            })}
            placeholder="Min Price"
          />
          <Input
            type="number"
            value={upsell.maxPrice || ''}
            onChange={(e) => onUpdate(index, { 
              ...upsell, 
              maxPrice: parseFloat(e.target.value) || undefined 
            })}
            placeholder="Max Price"
          />
        </div>
        
        {/* Quantity inputs */}
        <div className="space-y-1">
          <Input
            type="number"
            value={upsell.items.minQuantity || ''}
            onChange={(e) => onUpdate(index, { 
              ...upsell, 
              items: { 
                ...upsell.items, 
                minQuantity: parseInt(e.target.value) || undefined 
              }
            })}
            placeholder="Min Qty"
          />
          <Input
            type="number"
            value={upsell.items.maxQuantity || ''}
            onChange={(e) => onUpdate(index, { 
              ...upsell, 
              items: { 
                ...upsell.items, 
                maxQuantity: parseInt(e.target.value) || undefined 
              }
            })}
            placeholder="Max Qty"
          />
        </div>
        
        {/* Popular checkbox */}
        <div className="flex items-center justify-center h-10">
          <input
            type="checkbox"
            checked={upsell.popular || false}
            onChange={(e) => onUpdate(index, { 
              ...upsell, 
              popular: e.target.checked 
            })}
          />
        </div>
        
        {/* Delete button */}
        <Button 
          variant="ghost" 
          size="icon"
          onClick={() => onDelete(index)}
        >
          <Trash2 className="h-4 w-4 text-red-500" />
        </Button>
      </div>
      
      {/* Row 2: Description - Full Width ⭐ ADD */}
      <div>
        <label className="text-sm font-medium text-gray-700 mb-1 block">
          Description (optional)
        </label>
        <Textarea
          value={upsell.description || ''}
          onChange={(e) => onUpdate(index, { 
            ...upsell, 
            description: e.target.value 
          })}
          placeholder="Describe what's included in this add-on..."
          rows={3}
          className="resize-none"
        />
        <p className="text-xs text-gray-500 mt-1">
          Use bullet points (•) or line breaks for better readability
        </p>
      </div>
      
      {/* Row 3: Image Upload - Will add in Phase 3 */}
    </div>
  );
};
```

**Key changes:**
- Wrap in `<div className="border rounded-lg p-4 space-y-3">` for better visual separation
- Keep row 1 as grid for compact layout
- Add row 2 with full-width Textarea for description
- Add helpful placeholder and hint text

**Estimated time:** 45 minutes

### Phase 3: Update Checkout Form Builder - Image Upload

**Pattern to follow:** `frontend/src/pages/ProductForm.tsx` (lines 101-325)

**Add state for image uploads:**
```typescript
const CheckoutFormBuilder = () => {
  const [formData, setFormData] = useState<CheckoutFormData>({...});
  
  // ⭐ ADD: Track pending image uploads for each upsell
  const [upsellImages, setUpsellImages] = useState<Map<number, {
    file: File | null;
    preview: string;
  }>>(new Map());
  
  // ... rest of component
};
```

**Add image upload handlers:**
```typescript
const handleUpsellImageSelect = (index: number, file: File | null) => {
  if (!file) {
    // Remove image
    const newMap = new Map(upsellImages);
    const existing = newMap.get(index);
    if (existing?.preview) {
      URL.revokeObjectURL(existing.preview);
    }
    newMap.delete(index);
    setUpsellImages(newMap);
    
    // Clear imageUrl from upsell
    updateUpsell(index, { ...formData.upsells[index], imageUrl: undefined });
    return;
  }
  
  // Validate file
  const maxSize = 5 * 1024 * 1024; // 5MB
  if (file.size > maxSize) {
    toast.error('Image must be less than 5MB');
    return;
  }
  
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowedTypes.includes(file.type)) {
    toast.error('Invalid image format. Use JPG, PNG, WebP, or GIF');
    return;
  }
  
  // Create preview
  const preview = URL.createObjectURL(file);
  
  // Store file and preview
  const newMap = new Map(upsellImages);
  const existing = newMap.get(index);
  if (existing?.preview) {
    URL.revokeObjectURL(existing.preview); // Clean up old preview
  }
  newMap.set(index, { file, preview });
  setUpsellImages(newMap);
};

const handleRemoveUpsellImage = (index: number) => {
  const newMap = new Map(upsellImages);
  const existing = newMap.get(index);
  if (existing?.preview) {
    URL.revokeObjectURL(existing.preview);
  }
  newMap.delete(index);
  setUpsellImages(newMap);
  
  // Clear imageUrl from upsell
  updateUpsell(index, { ...formData.upsells[index], imageUrl: undefined });
};
```

**Update UpsellEditor to accept image handlers:**
```typescript
interface UpsellEditorProps {
  upsell: Upsell;
  index: number;
  onUpdate: (index: number, upsell: Upsell) => void;
  onDelete: (index: number) => void;
  imagePreview?: string;  // ⭐ ADD
  onImageSelect: (index: number, file: File | null) => void;  // ⭐ ADD
  onImageRemove: (index: number) => void;  // ⭐ ADD
}

const UpsellEditor = ({ 
  upsell, 
  index, 
  onUpdate, 
  onDelete,
  imagePreview,
  onImageSelect,
  onImageRemove
}: UpsellEditorProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  return (
    <div className="border rounded-lg p-4 space-y-3">
      {/* Row 1 & 2: Existing fields */}
      {/* ... */}
      
      {/* Row 3: Image Upload ⭐ ADD */}
      <div>
        <label className="text-sm font-medium text-gray-700 mb-1 block">
          Image (optional)
        </label>
        
        {!imagePreview && !upsell.imageUrl ? (
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/webp,image/gif"
              onChange={(e) => {
                const file = e.target.files?.[0] || null;
                onImageSelect(index, file);
              }}
              className="hidden"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-4 w-4 mr-2" />
              Upload Image
            </Button>
            <p className="text-xs text-gray-500">
              JPG, PNG, WebP, or GIF (max 5MB)
            </p>
          </div>
        ) : (
          <div className="relative inline-block">
            <img
              src={imagePreview || upsell.imageUrl}
              alt={upsell.name}
              className="h-32 w-32 object-cover rounded border"
            />
            <Button
              type="button"
              variant="destructive"
              size="icon"
              className="absolute -top-2 -right-2 h-6 w-6"
              onClick={() => onImageRemove(index)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};
```

**Update parent component to pass image props:**
```typescript
<UpsellEditor
  upsell={upsell}
  index={i}
  onUpdate={updateUpsell}
  onDelete={deleteUpsell}
  imagePreview={upsellImages.get(i)?.preview}  // ⭐ ADD
  onImageSelect={handleUpsellImageSelect}      // ⭐ ADD
  onImageRemove={handleRemoveUpsellImage}      // ⭐ ADD
/>
```

**Update form submission to upload images:**
```typescript
const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  setSubmitting(true);
  
  try {
    // ⭐ Upload all pending images first
    const uploadedUpsells = await Promise.all(
      formData.upsells.map(async (upsell, index) => {
        const imageData = upsellImages.get(index);
        
        if (imageData?.file) {
          // Upload image
          const formData = new FormData();
          formData.append('image', imageData.file);
          
          const response = await apiClient.post('/upload', formData);
          
          // Return upsell with imageUrl
          return {
            ...upsell,
            imageUrl: response.data.imageUrl
          };
        }
        
        // No new image, keep existing imageUrl
        return upsell;
      })
    );
    
    // Submit form with uploaded imageUrls
    const dataToSubmit = {
      ...formData,
      upsells: uploadedUpsells
    };
    
    if (isEditing) {
      await checkoutFormsService.update(formId, dataToSubmit);
      toast.success('Checkout form updated successfully');
    } else {
      await checkoutFormsService.create(dataToSubmit);
      toast.success('Checkout form created successfully');
    }
    
    // Clean up previews
    upsellImages.forEach(({ preview }) => {
      if (preview) URL.revokeObjectURL(preview);
    });
    setUpsellImages(new Map());
    
    navigate('/checkout-forms');
  } catch (error) {
    console.error('Failed to save checkout form:', error);
    toast.error('Failed to save checkout form');
  } finally {
    setSubmitting(false);
  }
};
```

**Clean up on unmount:**
```typescript
useEffect(() => {
  return () => {
    // Clean up all preview URLs
    upsellImages.forEach(({ preview }) => {
      if (preview) URL.revokeObjectURL(preview);
    });
  };
}, []);
```

**Estimated time:** 2 hours

### Phase 4: Update Public Checkout Page

**File:** `frontend/src/pages/PublicCheckout.tsx`

**Update AddOnSelector component (lines 450-490):**
```typescript
const AddOnSelector = ({ 
  upsell, 
  selected, 
  onToggle, 
  onIncrement, 
  onDecrement, 
  count 
}: AddOnSelectorProps) => {
  const [expanded, setExpanded] = React.useState(false);
  
  // Show expanded content if description or image exists
  const hasExpandableContent = upsell.description || upsell.imageUrl;
  
  return (
    <div className={cn(
      "border rounded-lg p-4",
      selected && "border-blue-500 bg-blue-50"
    )}>
      {/* Header */}
      <div className="flex items-start gap-3">
        <input 
          type="checkbox" 
          checked={selected} 
          onChange={onToggle}
          className="mt-1"
        />
        
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <div className="font-medium">{upsell.name}</div>
            {upsell.popular && (
              <Badge variant="secondary" className="text-xs">
                Most Popular
              </Badge>
            )}
          </div>
          <div className="text-sm text-gray-600 mt-1">
            +GH₵{upsell.price.toFixed(2)}
          </div>
        </div>
      </div>
      
      {/* Expandable content ⭐ UPDATE */}
      {hasExpandableContent && expanded && (
        <div className="mt-4 space-y-3 border-t pt-3">
          {/* Image */}
          {upsell.imageUrl && (
            <div className="flex justify-center">
              <img
                src={upsell.imageUrl}
                alt={upsell.name}
                className="max-w-full h-auto max-h-48 rounded-lg border"
                loading="lazy"
              />
            </div>
          )}
          
          {/* Description */}
          {upsell.description && (
            <div className="text-sm text-gray-700 whitespace-pre-wrap">
              {upsell.description}
            </div>
          )}
        </div>
      )}
      
      {/* Expand/Collapse button - Only show if has content ⭐ UPDATE */}
      {hasExpandableContent && (
        <button 
          onClick={() => setExpanded(!expanded)} 
          className="text-blue-600 text-sm mt-3 hover:underline"
        >
          {expanded ? 'Less Info' : 'More Info'}
        </button>
      )}
      
      {/* Quantity controls */}
      {selected && (
        <div className="mt-3 flex items-center gap-3">
          <span className="text-sm text-gray-600">Quantity:</span>
          <div className="flex items-center gap-2">
            <Button 
              type="button"
              variant="outline" 
              size="sm"
              onClick={onDecrement}
              disabled={count <= 1}
            >
              <Minus className="h-3 w-3" />
            </Button>
            <span className="w-8 text-center font-medium">{count}</span>
            <Button 
              type="button"
              variant="outline" 
              size="sm"
              onClick={onIncrement}
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
```

**Key changes:**
- Conditionally render expanded section if description or imageUrl exists
- Display image with responsive sizing and lazy loading
- Preserve line breaks in description with `whitespace-pre-wrap`
- Only show "More Info" button if content exists
- Improve quantity controls styling

**Estimated time:** 45 minutes

### Phase 5: Testing & Polish

**Manual testing:**
- [ ] Create new checkout form with upsell (description + image)
- [ ] Verify image preview shows correctly before saving
- [ ] Submit form and verify image uploaded successfully
- [ ] Edit existing form, verify existing image displays
- [ ] Replace existing image with new one
- [ ] Remove image from upsell
- [ ] Test description with line breaks and bullet points
- [ ] View public checkout page, verify image and description display
- [ ] Test responsive layout on mobile
- [ ] Verify image lazy loading works
- [ ] Test file size validation (>5MB should fail)
- [ ] Test invalid file type (PDF should fail)

**Edge cases:**
- [ ] Upsell with description but no image
- [ ] Upsell with image but no description
- [ ] Upsell with neither (should work as before)
- [ ] Very long description (ensure doesn't break layout)
- [ ] Very large image dimensions (ensure responsive)

**Performance:**
- [ ] Verify image previews don't cause memory leaks
- [ ] Confirm URL.revokeObjectURL called on cleanup
- [ ] Test with multiple upsells (each with image)

**Estimated time:** 1-2 hours

## UI Component Recommendations

### Textarea Component

**File:** `frontend/src/components/ui/Textarea.tsx` (already exists)

✅ **Use as-is** - No modifications needed

**Usage:**
```typescript
import { Textarea } from '@/components/ui/Textarea';

<Textarea
  value={upsell.description || ''}
  onChange={(e) => onUpdate(index, { ...upsell, description: e.target.value })}
  placeholder="Describe this add-on..."
  rows={3}
  className="resize-none"
/>
```

### Image Upload Component

**Recommendation:** Build inline (don't create separate component)

**Why:**
- Simple upload logic (ProductForm pattern)
- Only used in one place (UpsellEditor)
- State managed in parent (CheckoutFormBuilder)

**Pattern:**
```typescript
<div>
  <input
    ref={fileInputRef}
    type="file"
    accept="image/*"
    onChange={handleFileChange}
    className="hidden"
  />
  
  {!preview ? (
    <Button onClick={() => fileInputRef.current?.click()}>
      <Upload className="mr-2" />
      Upload Image
    </Button>
  ) : (
    <div className="relative">
      <img src={preview} className="h-32 w-32 object-cover" />
      <Button onClick={handleRemove} className="absolute -top-2 -right-2">
        <X className="h-4 w-4" />
      </Button>
    </div>
  )}
</div>
```

## State Management

### Upsell State

**Current:** Managed in CheckoutFormBuilder component state

```typescript
const [formData, setFormData] = useState<CheckoutFormData>({
  name: '',
  slug: '',
  upsells: []
});
```

**Recommended addition:**
```typescript
// Track pending image uploads (not yet uploaded to server)
const [upsellImages, setUpsellImages] = useState<Map<number, {
  file: File | null;
  preview: string;
}>>(new Map());
```

**Why Map?**
- Key by upsell index (stable during editing)
- Easy to add/remove/update images
- Efficient lookups

### Upload Flow

1. **User selects image** → Store in `upsellImages` Map, create preview
2. **User submits form** → Upload all images via `/api/upload`
3. **Get imageUrls** → Update upsells with imageUrls
4. **Submit form** → Send upsells with imageUrls to backend
5. **Cleanup** → Revoke preview URLs

**Key advantage:** Batch upload all images in parallel using `Promise.all()`

## API Integration

### Upload Endpoint

**Endpoint:** `POST /api/upload`  
**Content-Type:** `multipart/form-data`  
**Authentication:** Required (Bearer token)

**Request:**
```typescript
const formData = new FormData();
formData.append('image', file);

const response = await apiClient.post('/upload', formData);
```

**Response:**
```json
{
  "success": true,
  "message": "Image uploaded successfully",
  "imageUrl": "http://localhost:3000/uploads/image-1730123456789-abc123.jpg",
  "file": {
    "filename": "image-1730123456789-abc123.jpg",
    "originalName": "refill-pack.jpg",
    "mimetype": "image/jpeg",
    "size": 245678
  }
}
```

**Error handling:**
```typescript
try {
  const response = await apiClient.post('/upload', formData);
  return response.data.imageUrl;
} catch (error) {
  if (error.response?.status === 413) {
    toast.error('Image too large (max 5MB)');
  } else if (error.response?.status === 400) {
    toast.error('Invalid image format');
  } else {
    toast.error('Failed to upload image');
  }
  throw error;
}
```

### Checkout Form Endpoints

**No changes needed** - Backend automatically handles new fields

**Create:**
```typescript
await checkoutFormsService.create({
  name: 'Magic Copybook',
  slug: 'magic-copybook',
  upsells: [
    {
      name: 'Extra Ink Refills',
      description: 'Keep practicing...',
      imageUrl: '/uploads/refills-123.jpg',  // From upload response
      price: 150.00,
      items: { quantity: 1 }
    }
  ]
});
```

**Update:**
```typescript
await checkoutFormsService.update(formId, {
  ...formData,
  upsells: uploadedUpsells  // With imageUrls
});
```

## Performance Considerations

### Image Previews

**Memory management:**
```typescript
// Create preview
const preview = URL.createObjectURL(file);

// ALWAYS revoke when done
URL.revokeObjectURL(preview);
```

**When to revoke:**
- When replacing image
- When removing image
- On component unmount
- After successful upload

**Pattern:**
```typescript
useEffect(() => {
  return () => {
    // Cleanup on unmount
    upsellImages.forEach(({ preview }) => {
      if (preview) URL.revokeObjectURL(preview);
    });
  };
}, []);
```

### Lazy Loading

**Public checkout page:**
```typescript
<img
  src={upsell.imageUrl}
  alt={upsell.name}
  loading="lazy"  // ⭐ Browser-native lazy loading
  className="max-w-full h-auto"
/>
```

**Benefits:**
- Images only load when scrolled into view
- Faster initial page load
- Reduced bandwidth for users

### Batch Uploads

**Upload all images in parallel:**
```typescript
const uploadedUpsells = await Promise.all(
  formData.upsells.map(async (upsell, index) => {
    const imageData = upsellImages.get(index);
    if (imageData?.file) {
      const uploaded = await uploadImage(imageData.file);
      return { ...upsell, imageUrl: uploaded.imageUrl };
    }
    return upsell;
  })
);
```

**Advantage:** Faster than sequential uploads

## Accessibility

### Image Upload

**Keyboard accessibility:**
```typescript
<input
  type="file"
  accept="image/*"
  onChange={handleFileChange}
  aria-label="Upload upsell image"
  className="hidden"
/>

<Button onClick={() => fileInputRef.current?.click()}>
  Upload Image
</Button>
```

### Image Display

**Alt text:**
```typescript
<img
  src={upsell.imageUrl}
  alt={`${upsell.name} product image`}  // Descriptive alt
  loading="lazy"
/>
```

### Expandable Content

**Aria attributes:**
```typescript
<button
  onClick={() => setExpanded(!expanded)}
  aria-expanded={expanded}
  aria-controls={`upsell-content-${upsell.id}`}
>
  {expanded ? 'Less Info' : 'More Info'}
</button>

<div
  id={`upsell-content-${upsell.id}`}
  hidden={!expanded}
>
  {/* Content */}
</div>
```

## Error Handling

### File Upload Errors

```typescript
const handleImageUpload = async (file: File) => {
  // Validate file size
  const maxSize = 5 * 1024 * 1024; // 5MB
  if (file.size > maxSize) {
    toast.error('Image must be less than 5MB');
    return null;
  }
  
  // Validate file type
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowedTypes.includes(file.type)) {
    toast.error('Invalid image format. Use JPG, PNG, WebP, or GIF');
    return null;
  }
  
  // Upload
  try {
    const formData = new FormData();
    formData.append('image', file);
    
    const response = await apiClient.post('/upload', formData);
    return response.data.imageUrl;
  } catch (error) {
    if (error.response?.status === 413) {
      toast.error('Image too large (max 5MB)');
    } else if (error.response?.status === 400) {
      toast.error('Invalid image format');
    } else {
      toast.error('Failed to upload image');
    }
    return null;
  }
};
```

### Image Loading Errors

**Public checkout page:**
```typescript
<img
  src={upsell.imageUrl}
  alt={upsell.name}
  onError={(e) => {
    // Hide broken image
    e.currentTarget.style.display = 'none';
  }}
  loading="lazy"
/>
```

## Summary of Changes

### Files to Modify

1. ✅ `frontend/src/types/checkout-form.ts` - Add description and imageUrl
2. ✅ `frontend/src/services/public-orders.service.ts` - Update API types
3. ✅ `frontend/src/pages/CheckoutForms.tsx` - Add description and image upload UI
4. ✅ `frontend/src/pages/PublicCheckout.tsx` - Display description and image

### Files That Don't Need Changes

- ❌ `frontend/src/components/ui/Textarea.tsx` - Already exists
- ❌ `frontend/src/services/api.ts` - Already handles multipart/form-data
- ❌ Backend upload endpoint - Already configured

### New Components/Files

**None needed** - Use existing components and inline implementations

### Estimated Implementation Time

- Phase 1 (Types): 10 minutes
- Phase 2 (Description UI): 45 minutes
- Phase 3 (Image upload): 2 hours
- Phase 4 (Public display): 45 minutes
- Phase 5 (Testing): 1-2 hours

**Total: 4-5 hours**

## Next Steps for Parent Agent

1. ✅ Update frontend types (Phase 1)
2. ✅ Add description textarea to checkout form builder (Phase 2)
3. ✅ Add image upload to checkout form builder (Phase 3)
4. ✅ Update public checkout page display (Phase 4)
5. ✅ Test end-to-end functionality (Phase 5)

**Key Pattern:** Follow `ProductForm.tsx` image upload implementation exactly - it's battle-tested and works well.
