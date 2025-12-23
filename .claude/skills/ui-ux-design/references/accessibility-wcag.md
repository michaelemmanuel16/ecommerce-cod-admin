# Web Accessibility & WCAG Guidelines

## WCAG 2.1 Overview

WCAG (Web Content Accessibility Guidelines) 2.1 is organized around four principles: **Perceivable, Operable, Understandable, Robust (POUR)**.

### Conformance Levels
- **Level A**: Minimum level of accessibility
- **Level AA**: Standard target for most organizations (recommended)
- **Level AAA**: Highest level (not always achievable)

**Target for most applications: WCAG 2.1 Level AA**

## Principle 1: Perceivable

Information and UI components must be presentable to users in ways they can perceive.

### 1.1 Text Alternatives

**1.1.1 Non-text Content (A)**
Provide text alternatives for non-text content.

**Implementation:**
```html
<!-- Images -->
<img src="logo.png" alt="Company Name Logo">

<!-- Decorative images -->
<img src="decoration.svg" alt="" role="presentation">

<!-- Complex images -->
<img src="chart.png" alt="Sales chart showing 20% increase"
     longdesc="detailed-description.html">

<!-- Icons with actions -->
<button aria-label="Close dialog">
  <svg aria-hidden="true"><use href="#icon-close" /></svg>
</button>

<!-- Form inputs -->
<label for="email">Email Address</label>
<input type="email" id="email" name="email">
```

### 1.2 Time-based Media

**1.2.1 Audio-only and Video-only (A)**
Provide alternatives for pre-recorded audio and video.

**1.2.2 Captions (A)**
Provide captions for all pre-recorded audio content in video.

**1.2.3 Audio Description (A)**
Provide audio description for pre-recorded video content.

**1.2.4 Captions (Live) (AA)**
Provide captions for all live audio content.

**1.2.5 Audio Description (AA)**
Provide audio description for all pre-recorded video.

### 1.3 Adaptable

**1.3.1 Info and Relationships (A)**
Structure should be programmatically determinable.

**Implementation:**
```html
<!-- Use semantic HTML -->
<header>...</header>
<nav>...</nav>
<main>
  <article>
    <h1>Main Heading</h1>
    <section>
      <h2>Section Heading</h2>
      <p>Content...</p>
    </section>
  </article>
</main>
<aside>...</aside>
<footer>...</footer>

<!-- Proper heading hierarchy -->
<h1>Page Title</h1>
  <h2>Section 1</h2>
    <h3>Subsection 1.1</h3>
  <h2>Section 2</h2>

<!-- Data tables -->
<table>
  <caption>Sales by Region</caption>
  <thead>
    <tr>
      <th scope="col">Region</th>
      <th scope="col">Q1</th>
      <th scope="col">Q2</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <th scope="row">North</th>
      <td>$50k</td>
      <td>$60k</td>
    </tr>
  </tbody>
</table>

<!-- Form labels -->
<label for="username">Username</label>
<input type="text" id="username" name="username">

<!-- ARIA landmarks when HTML5 semantics aren't enough -->
<div role="search">
  <input type="search" aria-label="Search products">
</div>
```

**1.3.2 Meaningful Sequence (A)**
Content order should make sense when linearized.

**1.3.3 Sensory Characteristics (A)**
Don't rely solely on shape, size, position, or sound.

**Bad:** "Click the green button"
**Good:** "Click the 'Submit' button"

**1.3.4 Orientation (AA)**
Don't restrict to a single orientation unless essential.

**1.3.5 Identify Input Purpose (AA)**
Input fields should have autocomplete attributes.

```html
<input type="email" name="email" autocomplete="email">
<input type="tel" name="phone" autocomplete="tel">
<input type="text" name="address" autocomplete="street-address">
```

### 1.4 Distinguishable

**1.4.1 Use of Color (A)**
Don't use color as the only visual means of conveying information.

**Implementation:**
```html
<!-- Bad: Only color -->
<span style="color: red;">Error</span>

<!-- Good: Icon + color -->
<span style="color: red;">
  <svg aria-hidden="true"><use href="#icon-error" /></svg>
  Error
</span>

<!-- Form validation -->
<input aria-invalid="true" aria-describedby="email-error">
<span id="email-error" role="alert">
  <svg aria-hidden="true"><use href="#icon-error" /></svg>
  Please enter a valid email address
</span>
```

**1.4.2 Audio Control (A)**
Provide controls to pause/stop audio that plays automatically for >3 seconds.

**1.4.3 Contrast (Minimum) (AA) ⭐**
**Text contrast ratio:**
- Normal text: 4.5:1 minimum
- Large text (18pt+ or 14pt+ bold): 3:1 minimum

**Tool:** Use color contrast checker script or online tools.

**1.4.4 Resize Text (AA)**
Text can be resized up to 200% without loss of functionality.

**Implementation:**
- Use relative units (rem, em, %)
- Don't use fixed pixel sizes for containers
- Test with browser zoom at 200%

**1.4.5 Images of Text (AA)**
Avoid images of text (use actual text with CSS styling).

**1.4.10 Reflow (AA)**
Content reflows at 320px width without horizontal scrolling.

**1.4.11 Non-text Contrast (AA) ⭐**
UI components and graphics have 3:1 contrast ratio.

**Applies to:**
- Form input borders
- Focus indicators
- Icon buttons
- Graph elements

**1.4.12 Text Spacing (AA)**
No loss of content when users adjust:
- Line height: 1.5×
- Paragraph spacing: 2×
- Letter spacing: 0.12×
- Word spacing: 0.16×

**1.4.13 Content on Hover/Focus (AA)**
Hoverable/focusable content must be:
- Dismissible (without moving pointer)
- Hoverable (can move pointer over it)
- Persistent (doesn't disappear on its own)

## Principle 2: Operable

UI components and navigation must be operable.

### 2.1 Keyboard Accessible

**2.1.1 Keyboard (A) ⭐**
All functionality must be available via keyboard.

**Implementation:**
```html
<!-- Native interactive elements are keyboard accessible by default -->
<button>Click me</button>
<a href="/page">Link</a>
<input type="text">

<!-- Custom interactive elements need tabindex and keyboard handlers -->
<div role="button" tabindex="0"
     onKeyDown={(e) => e.key === 'Enter' && handleClick()}>
  Custom button
</div>

<!-- Skip to main content link -->
<a href="#main-content" class="skip-link">Skip to main content</a>
<main id="main-content">...</main>
```

**2.1.2 No Keyboard Trap (A)**
Keyboard focus should never be trapped.

**2.1.4 Character Key Shortcuts (A)**
If single-key shortcuts exist, provide way to turn off or remap.

### 2.2 Enough Time

**2.2.1 Timing Adjustable (A)**
Give users control over time limits.

**2.2.2 Pause, Stop, Hide (A)**
Allow users to pause auto-updating content.

### 2.3 Seizures

**2.3.1 Three Flashes or Below (A)**
No content flashes more than 3 times per second.

### 2.4 Navigable

**2.4.1 Bypass Blocks (A)**
Provide "skip to main content" link.

**2.4.2 Page Titled (A)**
Pages have descriptive titles.

```html
<title>Order #12345 - Dashboard - MyApp</title>
```

**2.4.3 Focus Order (A)**
Focus order follows meaningful sequence.

**Implementation:**
- DOM order should match visual order
- Use CSS for layout, not DOM reordering
- Tab order should be logical

**2.4.4 Link Purpose (A)**
Link text describes destination.

**Bad:** "Click here"
**Good:** "View order details"

**2.4.5 Multiple Ways (AA)**
Provide multiple ways to find pages (navigation, search, sitemap).

**2.4.6 Headings and Labels (AA)**
Headings and labels are descriptive.

**2.4.7 Focus Visible (AA) ⭐**
Keyboard focus indicator is visible.

**Implementation:**
```css
/* Default focus styles */
:focus {
  outline: 2px solid #4A90E2;
  outline-offset: 2px;
}

/* Custom focus styles */
button:focus-visible {
  box-shadow: 0 0 0 3px rgba(74, 144, 226, 0.5);
  outline: none;
}

/* Don't remove focus styles! */
/* BAD: */
*:focus { outline: none; }
```

### 2.5 Input Modalities

**2.5.1 Pointer Gestures (A)**
All functionality using multi-point or path-based gestures has single-pointer alternative.

**2.5.2 Pointer Cancellation (A)**
For single-pointer interactions, at least one is true:
- No down event
- Abort/undo available
- Up event reverses down event
- Completing on down event is essential

**2.5.3 Label in Name (A)**
Visible label text is included in accessible name.

**2.5.4 Motion Actuation (A)**
Functions triggered by device motion can be operated by UI components.

## Principle 3: Understandable

Information and UI operation must be understandable.

### 3.1 Readable

**3.1.1 Language of Page (A)**
Page language is programmatically determined.

```html
<html lang="en">
```

**3.1.2 Language of Parts (AA)**
Language of passages is programmatically determined.

```html
<p>The French phrase <span lang="fr">bonjour</span> means hello.</p>
```

### 3.2 Predictable

**3.2.1 On Focus (A)**
Focus doesn't trigger unexpected context changes.

**3.2.2 On Input (A)**
Changing settings doesn't cause unexpected context changes.

**Implementation:**
- Don't auto-submit forms on select/blur
- Don't navigate on focus
- Provide submit button for forms

**3.2.3 Consistent Navigation (AA)**
Navigation appears in same order across pages.

**3.2.4 Consistent Identification (AA)**
Components with same functionality are labeled consistently.

### 3.3 Input Assistance

**3.3.1 Error Identification (A) ⭐**
Errors are clearly identified and described.

```html
<input type="email"
       aria-invalid="true"
       aria-describedby="email-error">
<span id="email-error" role="alert">
  Please enter a valid email address
</span>
```

**3.3.2 Labels or Instructions (A) ⭐**
Labels or instructions provided for user input.

```html
<label for="password">
  Password
  <span class="hint">(minimum 8 characters)</span>
</label>
<input type="password" id="password"
       aria-describedby="password-hint">
<span id="password-hint" class="helper-text">
  Must include uppercase, lowercase, and numbers
</span>
```

**3.3.3 Error Suggestion (AA)**
Provide suggestions when errors are detected.

**3.3.4 Error Prevention (AA)**
For legal, financial, or data modifications:
- Reversible, or
- Checked for errors, or
- Confirmed before submission

## Principle 4: Robust

Content must be robust enough for assistive technologies.

### 4.1 Compatible

**4.1.1 Parsing (A)**
No duplicate IDs, proper nesting.

**4.1.2 Name, Role, Value (A)**
UI components have programmatically determined name and role.

```html
<!-- Native elements have built-in roles -->
<button>Submit</button> <!-- role="button" implicit -->

<!-- Custom elements need explicit ARIA -->
<div role="checkbox"
     aria-checked="true"
     aria-labelledby="checkbox-label"
     tabindex="0">
  <span id="checkbox-label">Accept terms</span>
</div>
```

**4.1.3 Status Messages (AA)**
Status messages can be programmatically determined.

```html
<!-- Live regions for dynamic updates -->
<div role="status" aria-live="polite">
  5 items in cart
</div>

<div role="alert" aria-live="assertive">
  Error: Payment failed
</div>
```

## Common ARIA Patterns

### ARIA Roles

```html
<!-- Landmarks -->
<div role="banner">Header</div>
<div role="navigation">Nav</div>
<div role="main">Main content</div>
<div role="complementary">Sidebar</div>
<div role="contentinfo">Footer</div>
<div role="search">Search form</div>

<!-- Widgets -->
<div role="button">Custom button</div>
<div role="tab">Tab</div>
<div role="tabpanel">Tab content</div>
<div role="dialog">Modal dialog</div>
<div role="alertdialog">Alert dialog</div>
<ul role="menu">Dropdown menu</ul>
<div role="tooltip">Tooltip content</div>
```

### ARIA States and Properties

```html
<!-- States (change dynamically) -->
<button aria-pressed="true">Toggle</button>
<div aria-expanded="false">Collapsed</div>
<input aria-invalid="true">
<div aria-hidden="true">Hidden from screen readers</div>
<input aria-disabled="true">

<!-- Properties (usually static) -->
<input aria-label="Search">
<input aria-describedby="hint">
<input aria-labelledby="label">
<div aria-required="true">
<button aria-controls="panel-1">
```

### Live Regions

```html
<!-- Announce changes to screen readers -->
<div aria-live="polite" aria-atomic="true">
  <!-- Updates announced when user is idle -->
</div>

<div aria-live="assertive">
  <!-- Updates announced immediately -->
</div>

<div role="status">
  <!-- Polite live region for status updates -->
</div>

<div role="alert">
  <!-- Assertive live region for critical updates -->
</div>
```

## Testing Checklist

### Automated Testing
- [ ] Run axe DevTools or WAVE browser extension
- [ ] Run Lighthouse accessibility audit
- [ ] Check HTML validation (W3C validator)
- [ ] Use color contrast checker

### Manual Testing
- [ ] Keyboard navigation (Tab, Enter, Space, Arrows, Esc)
- [ ] Screen reader testing (NVDA, JAWS, VoiceOver)
- [ ] Zoom to 200% (content should reflow)
- [ ] Test with Windows High Contrast mode
- [ ] Test form validation and error messages
- [ ] Check focus indicators are visible
- [ ] Verify heading hierarchy (h1-h6)
- [ ] Test with animations disabled

### Keyboard Testing Checklist
- [ ] All interactive elements reachable via Tab
- [ ] Tab order matches visual order
- [ ] Focus indicator clearly visible
- [ ] Enter/Space activates buttons and links
- [ ] Esc closes modals and dropdowns
- [ ] Arrow keys work in menus and tabs
- [ ] No keyboard traps
- [ ] Skip to main content link works

## Quick Reference: Most Common Issues

### Top 10 Accessibility Issues
1. Missing alt text on images
2. Low color contrast
3. Missing form labels
4. Missing focus indicators
5. Non-semantic HTML (divs instead of buttons)
6. Missing heading hierarchy
7. Non-descriptive link text ("click here")
8. Auto-playing media without controls
9. Missing ARIA labels on custom components
10. Keyboard inaccessible interactions

### Quick Wins
- [ ] Add alt text to all images
- [ ] Ensure 4.5:1 contrast for text
- [ ] Use semantic HTML (`<button>`, `<nav>`, `<main>`)
- [ ] Label all form inputs
- [ ] Make focus indicators visible
- [ ] Use proper heading hierarchy (h1 → h2 → h3)
- [ ] Add skip to main content link
- [ ] Avoid color-only indicators
- [ ] Test with keyboard only
- [ ] Add ARIA labels to icon buttons
