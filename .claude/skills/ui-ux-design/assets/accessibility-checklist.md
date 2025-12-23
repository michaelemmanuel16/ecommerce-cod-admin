# Web Accessibility Checklist (WCAG 2.1 AA)

**Page/Feature:** ___________________________
**Date:** ___________________________
**Reviewer:** ___________________________
**Target Compliance:** WCAG 2.1 Level AA

## Perceivable

### 1.1 Text Alternatives

- [ ] All images have alt text
- [ ] Decorative images have empty alt (`alt=""`) or `role="presentation"`
- [ ] Complex images (charts, diagrams) have detailed descriptions
- [ ] Icon buttons have `aria-label`
- [ ] Form inputs have associated labels

**Notes:**

---

### 1.2 Time-based Media

- [ ] Pre-recorded video has captions
- [ ] Pre-recorded audio has transcripts
- [ ] Live video has captions (if applicable)
- [ ] Audio descriptions provided for video (if applicable)

**Notes:**

---

### 1.3 Adaptable

- [ ] Heading hierarchy is logical (h1 → h2 → h3, no skips)
- [ ] Semantic HTML used (`<nav>`, `<main>`, `<aside>`, etc.)
- [ ] Data tables have proper headers (`<th>` with `scope`)
- [ ] Content order makes sense when CSS disabled
- [ ] Form labels properly associated with inputs
- [ ] Reading order matches visual order
- [ ] Input fields have `autocomplete` attributes

**Notes:**

---

### 1.4 Distinguishable

- [ ] **Color contrast (text):** Normal text has 4.5:1 ratio
- [ ] **Color contrast (large text):** Large text (18pt+/14pt+ bold) has 3:1 ratio
- [ ] **Color contrast (UI):** UI components have 3:1 ratio
- [ ] Color not used as only visual indicator
- [ ] Text can be resized to 200% without loss of content
- [ ] No images of text (use real text with CSS)
- [ ] Content reflows at 320px width (no horizontal scroll)
- [ ] Text spacing can be adjusted without content loss
- [ ] Content on hover/focus is dismissible, hoverable, and persistent

**Tools used:** ___________________________

**Notes:**

---

## Operable

### 2.1 Keyboard Accessible

- [ ] **All functionality available via keyboard**
- [ ] No keyboard traps
- [ ] Skip-to-main-content link present
- [ ] Keyboard shortcuts don't interfere with assistive tech
- [ ] Tab order is logical
- [ ] Custom interactive elements have proper keyboard handlers

**Notes:**

---

### 2.2 Enough Time

- [ ] Time limits can be extended or disabled
- [ ] Auto-updating content can be paused
- [ ] No content flashes more than 3 times per second

**Notes:**

---

### 2.4 Navigable

- [ ] Page has unique, descriptive `<title>`
- [ ] Focus order follows logical sequence
- [ ] Link text describes destination (no "click here")
- [ ] Multiple navigation methods available (nav, search, sitemap)
- [ ] Headings and labels are descriptive
- [ ] **Keyboard focus is visible**
- [ ] Breadcrumbs provided (if applicable)

**Notes:**

---

### 2.5 Input Modalities

- [ ] Multi-point gestures have single-pointer alternative
- [ ] Pointer gestures can be cancelled
- [ ] Visible labels match accessible names
- [ ] Motion-triggered functions can be disabled

**Notes:**

---

## Understandable

### 3.1 Readable

- [ ] Page language specified (`<html lang="en">`)
- [ ] Language changes marked (`<span lang="fr">`)
- [ ] Content written in clear, simple language

**Notes:**

---

### 3.2 Predictable

- [ ] Focus doesn't trigger unexpected changes
- [ ] Input doesn't cause unexpected context changes
- [ ] Navigation is consistent across pages
- [ ] Components are consistently identified

**Notes:**

---

### 3.3 Input Assistance

- [ ] **Errors are clearly identified**
- [ ] Error messages are descriptive
- [ ] **Form labels and instructions provided**
- [ ] Error suggestions offered
- [ ] Confirmations for important actions (legal, financial, data)
- [ ] Form errors can be reviewed before final submission

**Notes:**

---

## Robust

### 4.1 Compatible

- [ ] Valid HTML (no duplicate IDs, proper nesting)
- [ ] Custom components have name, role, value
- [ ] ARIA used correctly (no invalid attributes)
- [ ] Status messages have proper roles (`role="status"`, `role="alert"`)
- [ ] Live regions implemented correctly

**Tools used:** ___________________________

**Notes:**

---

## Forms

- [ ] All form fields have visible labels
- [ ] Required fields are indicated (asterisk + aria-required)
- [ ] Field instructions provided before form control
- [ ] Validation errors shown inline
- [ ] Error messages are specific and helpful
- [ ] Successful submission confirmed
- [ ] Form can be completed using keyboard only

**Notes:**

---

## Interactive Components

- [ ] Buttons have descriptive text or aria-label
- [ ] Links have descriptive text (no "click here")
- [ ] Modals/dialogs have `role="dialog"` and `aria-modal="true"`
- [ ] Modals trap focus and return focus on close
- [ ] Modals can be closed with Esc key
- [ ] Dropdown menus are keyboard navigable
- [ ] Tooltips are keyboard accessible
- [ ] Tabs have proper ARIA roles and keyboard support

**Notes:**

---

## Navigation & Structure

- [ ] One `<main>` landmark per page
- [ ] Page has clear heading structure
- [ ] Navigation has `<nav>` or `role="navigation"`
- [ ] Skip links provided
- [ ] Breadcrumbs present (if applicable)
- [ ] Search functionality keyboard accessible

**Notes:**

---

## Images & Media

- [ ] All images have alt text
- [ ] Alt text is descriptive and concise
- [ ] Decorative images properly marked
- [ ] SVGs have `<title>` or `aria-label`
- [ ] Videos have captions
- [ ] Audio has transcripts
- [ ] Media players are keyboard accessible

**Notes:**

---

## Tables

- [ ] Data tables have `<caption>` or `aria-label`
- [ ] Column headers use `<th>` with `scope="col"`
- [ ] Row headers use `<th>` with `scope="row"`
- [ ] Complex tables have `id` and `headers` attributes
- [ ] Tables used for data, not layout

**Notes:**

---

## Mobile/Touch

- [ ] Touch targets are at least 44×44px
- [ ] Spacing between touch targets is adequate (8px min)
- [ ] Pinch-to-zoom not disabled
- [ ] Portrait and landscape orientations supported
- [ ] Touch gestures have alternatives

**Notes:**

---

## Testing Performed

### Automated Testing
- [ ] axe DevTools: ___________
- [ ] WAVE: ___________
- [ ] Lighthouse: ___________
- [ ] HTML validator: ___________

### Manual Testing
- [ ] Keyboard navigation (Tab, Enter, Space, Arrows, Esc)
- [ ] Screen reader testing (tool: ___________)
- [ ] Zoom to 200%
- [ ] Browser zoom to 400%
- [ ] High contrast mode (Windows)
- [ ] Color blindness simulation
- [ ] Mobile testing
- [ ] Touch device testing

**Notes:**

---

## Browser/Device Testing

- [ ] Chrome (latest)
- [ ] Firefox (latest)
- [ ] Safari (latest)
- [ ] Edge (latest)
- [ ] Mobile Safari (iOS)
- [ ] Chrome (Android)

**Notes:**

---

## Assistive Technology Testing

- [ ] NVDA (Windows)
- [ ] JAWS (Windows)
- [ ] VoiceOver (Mac/iOS)
- [ ] TalkBack (Android)
- [ ] Dragon NaturallySpeaking (voice control)
- [ ] Switch control

**Screen reader used:** ___________________________

**Notes:**

---

## Critical Issues (Must Fix)

1.
2.
3.

## Major Issues (Should Fix)

1.
2.
3.

## Minor Issues (Nice to Fix)

1.
2.
3.

---

## Overall Assessment

**Compliance Level:**
- [ ] WCAG 2.1 Level A
- [ ] WCAG 2.1 Level AA
- [ ] WCAG 2.1 Level AAA
- [ ] Non-compliant

**Pass/Fail:** ___________

**Summary:**

---

**Reviewed by:** ___________________________
**Date:** ___________________________
**Next review date:** ___________________________
