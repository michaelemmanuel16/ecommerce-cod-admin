# UI Component Patterns & Best Practices

## Buttons

### Button Hierarchy

**Primary button:**
- One per section/page
- Main call-to-action
- Highest visual emphasis
- Example: Submit, Save, Confirm

**Secondary button:**
- Supporting actions
- Medium visual emphasis
- Example: Cancel, Back, Skip

**Tertiary/Ghost button:**
- Low-priority actions
- Minimal visual weight
- Example: Learn More, View Details

**Destructive button:**
- Dangerous/irreversible actions
- Use red/warning color
- Example: Delete, Remove, Unsubscribe

### Button States

```
Normal → Hover → Active → Disabled → Loading
```

**Implementation checklist:**
- [ ] Visual feedback on hover
- [ ] Active/pressed state
- [ ] Disabled state (reduced opacity, no pointer events)
- [ ] Loading state (spinner, disabled interaction)
- [ ] Focus state (visible outline)
- [ ] Keyboard support (Enter/Space)

### Button Sizing

**Touch target minimum:** 44×44px (iOS), 48×48px (Material)

```css
/* Small */
height: 32px; padding: 0 12px; font-size: 14px;

/* Medium (default) */
height: 40px; padding: 0 16px; font-size: 16px;

/* Large */
height: 48px; padding: 0 20px; font-size: 18px;
```

### Button Best Practices

✅ **Do:**
- Use action-oriented text ("Add Product" not "Click here")
- Place primary action on the right in dialogs
- Provide loading feedback for async actions
- Make destructive actions require confirmation
- Use icons for clarity (with text)

❌ **Don't:**
- Use more than one primary button per section
- Make buttons too small (minimum 44px height)
- Remove hover/focus states for aesthetics
- Use generic text ("OK", "Submit")

## Forms

### Form Structure

**Recommended layout:**
1. Form title/description
2. Field groups (related inputs together)
3. Clear labels above inputs
4. Optional helper text below inputs
5. Error messages inline
6. Actions at the bottom (Cancel left, Submit right)

### Input Fields

**Label positioning:**
- **Top-aligned** (recommended): Best for scanning, mobile-friendly
- **Left-aligned**: Compact, but harder to scan
- **Placeholder only**: Avoid (accessibility issues)

**Field anatomy:**
```
[Label] (Optional badge) (Required indicator *)
[Input field]
[Helper text / character count]
[Error message]
```

### Form Validation

**When to validate:**
- **On blur**: Check individual fields after user leaves
- **On submit**: Validate entire form
- **Real-time**: For password strength, username availability
- **On keystroke**: For search, filters (with debounce)

**Error message best practices:**
- Place error below the field
- Use red color + icon (not color alone)
- Explain the problem and solution
- Focus first error field on submit
- Keep error message after fixing (remove on next blur)

**Example validation states:**
```html
<!-- Invalid state -->
<div class="field-group">
  <label for="email">Email *</label>
  <input
    type="email"
    id="email"
    aria-invalid="true"
    aria-describedby="email-error"
  >
  <span id="email-error" class="error-message" role="alert">
    <svg aria-hidden="true"><!-- error icon --></svg>
    Please enter a valid email address
  </span>
</div>

<!-- Valid state -->
<div class="field-group">
  <label for="username">Username *</label>
  <input
    type="text"
    id="username"
    aria-invalid="false"
  >
  <span class="success-message">
    <svg aria-hidden="true"><!-- checkmark icon --></svg>
    Username is available
  </span>
</div>
```

### Required Fields

**Indicate required fields:**
- **Option 1**: Mark required with `*` (most common)
- **Option 2**: Mark optional with "(optional)"
- **Accessibility**: Use `aria-required="true"`

### Form Best Practices

✅ **Do:**
- Group related fields together
- Provide clear, specific error messages
- Preserve user input when errors occur
- Auto-focus first field on page load
- Use appropriate input types (email, tel, number)
- Provide autocomplete attributes
- Show password strength indicators
- Allow password visibility toggle

❌ **Don't:**
- Use placeholder as label
- Clear form on error
- Validate on every keystroke (use debounce)
- Hide password requirements until error
- Make all fields required
- Use CAPTCHA unless necessary

## Modals & Dialogs

### Modal Anatomy

```
[Overlay - semi-transparent background]
  [Modal Container]
    [Header]
      [Title]
      [Close button (X)]
    [Content]
      [Body text, form, etc.]
    [Footer]
      [Secondary action] [Primary action]
```

### Modal Types

**1. Alert Dialog**
- Purpose: Important information requiring acknowledgment
- Actions: Single "OK" or "Got it" button
- Example: "Your changes have been saved"

**2. Confirmation Dialog**
- Purpose: Confirm destructive/important actions
- Actions: Cancel (left) + Confirm (right)
- Example: "Are you sure you want to delete this item?"

**3. Form Dialog**
- Purpose: Collect user input
- Actions: Cancel (left) + Submit (right)
- Example: "Create new project"

**4. Info/Help Dialog**
- Purpose: Provide additional information
- Actions: Close button or click outside
- Example: Help documentation

### Modal Best Practices

✅ **Do:**
- Trap focus within modal (Tab cycles through modal)
- Close on Esc key press
- Disable scroll on background content
- Return focus to trigger element on close
- Prevent background interaction (overlay click closes)
- Use ARIA roles (`role="dialog"`, `aria-modal="true"`)
- Provide descriptive title (`aria-labelledby`)

❌ **Don't:**
- Nest modals (avoid modal-within-modal)
- Use for non-critical content
- Make content too long (use page instead)
- Hide close button (always provide escape)

**Accessibility implementation:**
```html
<div
  role="dialog"
  aria-modal="true"
  aria-labelledby="dialog-title"
  aria-describedby="dialog-description"
>
  <h2 id="dialog-title">Delete confirmation</h2>
  <p id="dialog-description">
    Are you sure you want to delete this item? This action cannot be undone.
  </p>
  <div class="actions">
    <button type="button">Cancel</button>
    <button type="button" class="destructive">Delete</button>
  </div>
</div>
```

## Tables & Data Grids

### Table Structure

```
[Table controls: search, filters, actions]
[Table]
  [Header row]
    [Column headers with sort indicators]
  [Body rows]
    [Data cells]
[Pagination]
```

### Column Design

**Column types:**
- **Text**: Left-aligned
- **Numbers**: Right-aligned
- **Dates**: Left or right-aligned (be consistent)
- **Status badges**: Centered or left-aligned
- **Actions**: Right-aligned (last column)

**Column headers:**
- Clearly describe content
- Add sort indicators (↑↓)
- Provide filters where appropriate
- Make clickable for sorting

### Table Features

**Essential features:**
- [ ] Sortable columns (click header to sort)
- [ ] Pagination or infinite scroll
- [ ] Loading state (skeleton or spinner)
- [ ] Empty state ("No results found")
- [ ] Row selection (checkbox in first column)
- [ ] Row actions (kebab menu or action buttons)
- [ ] Responsive design (stack on mobile or horizontal scroll)

**Advanced features:**
- [ ] Column resizing
- [ ] Column reordering
- [ ] Filtering per column
- [ ] Bulk actions (for selected rows)
- [ ] Export functionality
- [ ] Saved views

### Responsive Tables

**Option 1: Horizontal scroll**
```css
.table-container {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
```

**Option 2: Card layout (mobile)**
```
Desktop: Traditional table
Mobile: Each row becomes a card with stacked label-value pairs
```

**Option 3: Hide columns**
- Show essential columns on mobile
- Provide "View details" to see full row

### Table Best Practices

✅ **Do:**
- Use zebra striping for long tables
- Highlight row on hover
- Sticky header for long tables
- Provide clear empty states
- Show loading skeletons
- Use monospace fonts for numbers
- Align numbers by decimal point

❌ **Don't:**
- Put too many columns (>8 on desktop)
- Use tables for layout
- Remove horizontal lines (harder to scan)
- Make rows too tall (30-40px is ideal)

## Navigation

### Primary Navigation Patterns

**1. Top Navigation Bar**
- Best for: 5-7 main sections
- Horizontal menu at top
- Works well for simple site structures

**2. Sidebar Navigation**
- Best for: Many sections, complex hierarchies
- Vertical menu on left or right
- Collapsible for more space

**3. Hamburger Menu**
- Best for: Mobile, minimal desktop UI
- Hidden menu revealed on click
- Use for secondary actions or mobile

**4. Tabs**
- Best for: Switching views within a page
- Horizontal tabs at top of content area
- 3-6 tabs maximum

### Navigation Best Practices

✅ **Do:**
- Highlight current page/section
- Provide visual feedback on hover
- Use clear, concise labels
- Maintain consistent position
- Include skip-to-content link (accessibility)
- Use breadcrumbs for deep hierarchies
- Make logo link to homepage

❌ **Don't:**
- Use more than two levels in top nav
- Rely solely on icons (add labels)
- Remove active state indicators
- Change navigation structure between pages

### Breadcrumbs

**When to use:**
- Deep site hierarchies (3+ levels)
- E-commerce product categories
- Documentation with nested sections

**Pattern:**
```
Home > Category > Subcategory > Current Page
```

**Implementation:**
```html
<nav aria-label="Breadcrumb">
  <ol>
    <li><a href="/">Home</a></li>
    <li><a href="/products">Products</a></li>
    <li aria-current="page">Product Name</li>
  </ol>
</nav>
```

## Cards

### Card Anatomy

```
[Card container]
  [Optional: Image/thumbnail]
  [Content area]
    [Optional: Badge/tag]
    [Title]
    [Description/metadata]
  [Optional: Actions]
```

### Card Types

**1. Content Card**
- Purpose: Display article, product, item
- Contains: Image, title, description, metadata
- Action: Click anywhere to navigate

**2. Action Card**
- Purpose: Perform a specific action
- Contains: Icon, title, description
- Action: Explicit button or entire card clickable

**3. Info Card / Stats Card**
- Purpose: Display key metrics or summary
- Contains: Number, label, trend indicator
- Action: Often not clickable

### Card Best Practices

✅ **Do:**
- Use consistent card height in grids
- Provide hover state for clickable cards
- Limit content (cards should be scannable)
- Use images with consistent aspect ratio
- Group related information

❌ **Don't:**
- Put too much content in a card
- Use cards for everything (consider lists)
- Make entire card clickable with buttons inside (confusing)
- Vary card sizes too much in a grid

## Notifications & Alerts

### Types

**1. Toast/Snackbar**
- Purpose: Brief, non-intrusive feedback
- Duration: Auto-dismiss (3-5 seconds)
- Position: Top-right or bottom-center
- Example: "Changes saved successfully"

**2. Banner**
- Purpose: Important persistent information
- Duration: User dismisses
- Position: Top of page
- Example: "You're using an old browser"

**3. Inline Alert**
- Purpose: Contextual information within content
- Duration: Persistent until dismissed
- Position: Near relevant content
- Example: Form validation summary

**4. Modal Alert**
- Purpose: Critical information requiring action
- Duration: User acknowledges
- Position: Center overlay
- Example: "Session expired, please log in"

### Notification Variants

**Success** (Green)
- Confirmation of completed action
- "Your order has been placed"

**Error** (Red)
- Something went wrong
- "Payment failed. Please try again"

**Warning** (Yellow/Orange)
- Caution or important notice
- "Your subscription expires in 3 days"

**Info** (Blue)
- General information
- "New features are now available"

### Best Practices

✅ **Do:**
- Use appropriate severity level
- Provide clear, actionable message
- Include icon + color (not color alone)
- Allow dismissal
- Stack multiple toasts vertically
- Use ARIA live regions (`role="alert"`)

❌ **Don't:**
- Show too many notifications at once
- Make toast duration too short
- Use modals for non-critical info
- Auto-dismiss errors (let user dismiss)

**Accessibility implementation:**
```html
<!-- Toast notification -->
<div role="status" aria-live="polite" aria-atomic="true" class="toast success">
  <svg aria-hidden="true"><!-- success icon --></svg>
  <span>Changes saved successfully</span>
  <button aria-label="Close notification">×</button>
</div>

<!-- Error alert -->
<div role="alert" aria-live="assertive" class="alert error">
  <svg aria-hidden="true"><!-- error icon --></svg>
  <span>Payment failed. Please try again.</span>
  <button aria-label="Close alert">×</button>
</div>
```

## Dropdowns & Menus

### Dropdown Patterns

**1. Select Dropdown**
- Purpose: Choose one option from list
- Use native `<select>` when possible
- Custom dropdown for complex options (with images, icons)

**2. Action Menu (Kebab/Overflow)**
- Purpose: Additional actions for an item
- Triggered by ⋮ or ⋯ button
- Contains: Edit, Delete, Share, etc.

**3. Context Menu**
- Purpose: Right-click menu
- Use sparingly (not discoverable)
- Provide alternative access method

**4. Mega Menu**
- Purpose: Large dropdown with grouped options
- Common in e-commerce navigation
- Contains: Categories, featured items, images

### Menu Best Practices

✅ **Do:**
- Close on click outside
- Close on Esc key
- Highlight current selection
- Support keyboard navigation (Arrow keys)
- Position dynamically (flip if off-screen)
- Use `role="menu"` for action menus
- Provide clear labels

❌ **Don't:**
- Make menus too long (>10 items, use search or grouping)
- Nest menus too deep (2 levels max)
- Use dropdown for 2-3 options (use radio buttons)
- Hide critical actions in overflow menu

## Loading States

### Loading Patterns

**1. Spinner**
- Use for: Short waits (<2 seconds)
- Placement: Button, card, or center of container
- Size: Match context (small in button, large in page)

**2. Progress Bar**
- Use for: Long operations with known duration
- Shows: Percentage complete
- Example: File upload, multi-step process

**3. Skeleton Screens**
- Use for: Content loading (preferred over spinners)
- Shows: Gray placeholder matching content layout
- Benefits: Perceived performance, no layout shift

**4. Optimistic Updates**
- Use for: Instant feedback while saving
- Shows: Update immediately, revert on error
- Example: Like button, toggle settings

### Loading Best Practices

✅ **Do:**
- Match skeleton to actual content layout
- Animate skeletons (shimmer effect)
- Disable interaction during loading
- Show progress for long operations
- Provide cancel option for long operations

❌ **Don't:**
- Show spinner for every action
- Use spinners for >5 second waits
- Block entire page for partial updates
- Forget to handle loading errors

## Empty States

### Empty State Elements

```
[Illustration or icon]
[Heading: Explain why it's empty]
[Description: Guide user on what to do]
[Call-to-action button]
```

### Types of Empty States

**1. First-time/Onboarding**
- "No items yet. Create your first project!"
- Encouraging, action-oriented

**2. No Results**
- "No results found for 'search term'"
- Suggest: Check spelling, try different keywords, clear filters

**3. Error State**
- "Unable to load items. Please try again."
- Provide: Retry button, help link

**4. Permission Denied**
- "You don't have access to this content"
- Explain: Why and how to get access

### Best Practices

✅ **Do:**
- Use friendly, helpful tone
- Provide clear action (create, search, refresh)
- Include visual (illustration, icon)
- Explain why it's empty
- Offer help or suggestions

❌ **Don't:**
- Show technical error messages
- Leave users stuck (always provide action)
- Use generic "No data" message
- Blame the user ("You haven't...")

## Search

### Search Patterns

**1. Basic Search**
- Simple input with search button
- Full-page results

**2. Autocomplete/Suggestions**
- Show suggestions as user types
- Highlight matching text
- Group by type (products, pages, etc.)

**3. Instant Search**
- Results update live as user types
- Filter existing list
- Common in tables, lists

**4. Advanced Search**
- Multiple filters and criteria
- Boolean operators (AND, OR, NOT)
- Save searches

### Search Best Practices

✅ **Do:**
- Place search in top-right (convention)
- Show recent searches
- Highlight search terms in results
- Provide filters for large result sets
- Handle typos (fuzzy matching)
- Show "no results" with suggestions
- Support keyboard shortcuts (/ to focus)

❌ **Don't:**
- Require exact matches
- Hide advanced filters completely
- Clear search input after search
- Return results without context

## Tooltips & Popovers

### Tooltip

**Purpose:** Brief supplementary information
**Trigger:** Hover or focus
**Content:** 1-2 lines max, plain text
**Dismissal:** Mouse out or blur

**When to use:**
- Icon button labels
- Truncated text (show full on hover)
- Definitions or explanations
- Keyboard shortcuts

### Popover

**Purpose:** Richer content with formatting
**Trigger:** Click
**Content:** Text, links, images, small forms
**Dismissal:** Click outside, close button, or Esc

**When to use:**
- Additional details that don't fit inline
- Quick actions
- Mini forms
- Rich help content

### Best Practices

✅ **Do:**
- Keep tooltips brief (<10 words)
- Position dynamically (flip if off-screen)
- Add arrow pointing to trigger
- Use `aria-describedby` for tooltips
- Ensure keyboard accessible
- Add delay before showing (300ms)

❌ **Don't:**
- Put critical information in tooltips
- Use tooltips on mobile (no hover)
- Include interactive elements in tooltips
- Hide keyboard shortcuts only in tooltips
- Nest popovers

**Implementation:**
```html
<button aria-describedby="tooltip-1">
  <svg aria-hidden="true"><!-- icon --></svg>
</button>
<div id="tooltip-1" role="tooltip" class="tooltip">
  Save changes
</div>
```
