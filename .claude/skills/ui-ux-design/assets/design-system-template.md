# [Project Name] Design System

**Version:** 1.0
**Last Updated:** [Date]
**Owner:** [Team/Person]

## Introduction

This document defines the design standards, principles, and components for [Project Name]. Use this as a reference when designing and developing features to ensure consistency across the product.

## Design Principles

1. **[Principle 1 Name]**
   - [Description of the principle]
   - [Why it matters]
   - [Example of application]

2. **[Principle 2 Name]**
   - [Description]

3. **[Principle 3 Name]**
   - [Description]

## Colors

### Brand Colors

**Primary**
- **Primary 500** (Main brand color)
  - Hex: `#000000`
  - RGB: `rgb(0, 0, 0)`
  - Usage: Primary buttons, links, key UI elements
  - Accessibility: WCAG AA compliant with white text (contrast ratio: X:1)

**Secondary**
- **Secondary 500**
  - Hex: `#000000`
  - RGB: `rgb(0, 0, 0)`
  - Usage: Secondary actions, accents

### Neutral Colors

- **Neutral 50** (Lightest)
  - Hex: `#F9FAFB`
  - Usage: Page backgrounds, subtle backgrounds

- **Neutral 100**
  - Hex: `#F3F4F6`
  - Usage: Hover states, disabled backgrounds

- **Neutral 200**
  - Hex: `#E5E7EB`
  - Usage: Borders, dividers

- **Neutral 300-600**
  - [Continue with scale]

- **Neutral 900** (Darkest)
  - Hex: `#111827`
  - Usage: Primary text, headings

### Semantic Colors

**Success**
- **Success 500**: `#10B981` (Green)
- Usage: Success messages, completed states
- Accessibility: Pair with success icon, not color alone

**Warning**
- **Warning 500**: `#F59E0B` (Amber)
- Usage: Warning messages, caution states

**Error**
- **Error 500**: `#EF4444` (Red)
- Usage: Error messages, destructive actions

**Info**
- **Info 500**: `#3B82F6` (Blue)
- Usage: Informational messages, helpful tips

### Color Usage Rules

- ✅ **Do**: Use primary color for main CTAs
- ✅ **Do**: Ensure 4.5:1 contrast for text
- ❌ **Don't**: Use color as the only indicator
- ❌ **Don't**: Use too many colors on one screen

## Typography

### Font Families

**Primary Font** (UI/Body)
- Font: [Font Name, e.g., "Inter", sans-serif]
- Weights: 400 (Normal), 500 (Medium), 600 (Semibold), 700 (Bold)
- Usage: All UI text, body copy

**Monospace Font** (Code)
- Font: [Font Name, e.g., "Fira Code", monospace]
- Usage: Code snippets, technical data

### Type Scale

| Name | Size | Line Height | Weight | Usage |
|------|------|-------------|---------|-------|
| Display | 3rem (48px) | 1.1 | 700 | Hero headings |
| H1 | 2.25rem (36px) | 1.25 | 700 | Page titles |
| H2 | 1.875rem (30px) | 1.25 | 600 | Section headings |
| H3 | 1.5rem (24px) | 1.3 | 600 | Subsection headings |
| H4 | 1.25rem (20px) | 1.4 | 600 | Card titles |
| Body Large | 1.125rem (18px) | 1.6 | 400 | Larger body text |
| Body | 1rem (16px) | 1.5 | 400 | Default body text |
| Body Small | 0.875rem (14px) | 1.5 | 400 | Secondary text |
| Caption | 0.75rem (12px) | 1.4 | 400 | Labels, captions |

### Typography Rules

- ✅ **Do**: Use proper heading hierarchy (H1 → H2 → H3)
- ✅ **Do**: Limit line length to 60-80 characters
- ❌ **Don't**: Skip heading levels
- ❌ **Don't**: Use ALL CAPS for long text

## Spacing

### Spacing Scale (4px base unit)

| Token | Size | Pixels | Usage |
|-------|------|--------|-------|
| space-1 | 0.25rem | 4px | Tight spacing |
| space-2 | 0.5rem | 8px | Small gaps |
| space-3 | 0.75rem | 12px | Compact components |
| space-4 | 1rem | 16px | Default spacing |
| space-5 | 1.25rem | 20px | Medium gaps |
| space-6 | 1.5rem | 24px | Component padding |
| space-8 | 2rem | 32px | Section spacing |
| space-10 | 2.5rem | 40px | Large spacing |
| space-12 | 3rem | 48px | Section padding |
| space-16 | 4rem | 64px | Major sections |

### Spacing Rules

- Use spacing scale consistently
- Prefer larger spacing between unrelated elements
- Maintain consistent padding within components

## Components

### Buttons

**Variants:**

1. **Primary Button**
   - Usage: Main call-to-action
   - Style: Filled with primary color
   - States: Default, Hover, Active, Disabled, Loading

2. **Secondary Button**
   - Usage: Secondary actions
   - Style: Outline or subtle background
   - States: Default, Hover, Active, Disabled

3. **Destructive Button**
   - Usage: Delete, remove, cancel actions
   - Style: Red/error color
   - States: Default, Hover, Active, Disabled

**Sizes:**
- Small: 32px height, 12px padding
- Medium: 40px height, 16px padding (default)
- Large: 48px height, 20px padding

**Rules:**
- ✅ One primary button per section
- ✅ Minimum 44×44px touch target
- ✅ Clear, action-oriented text
- ❌ Don't use generic text ("Click here", "Submit")

### Form Inputs

**Input Field**
- Height: 40px (default)
- Padding: 12px horizontal
- Border: 1px solid neutral-300
- Border radius: 6px
- Focus state: Primary color outline

**States:**
- Default
- Focus (primary color outline)
- Error (red border + error message)
- Disabled (gray background, reduced opacity)

**Rules:**
- ✅ Always include label
- ✅ Show validation inline
- ✅ Use appropriate input types
- ❌ Don't use placeholder as label

### Cards

**Anatomy:**
- Container: white background, border or shadow
- Padding: 16-24px
- Border radius: 8-12px
- Shadow: subtle (0 1px 3px rgba(0,0,0,0.1))

**Usage:**
- Grouping related content
- Displaying items in a grid
- Containing forms or actions

### Modals

**Anatomy:**
- Overlay: semi-transparent background (rgba(0,0,0,0.5))
- Container: white, centered, max-width 600px
- Header: Title + close button
- Content: Body text, form, etc.
- Footer: Actions (Cancel left, Primary right)

**Rules:**
- ✅ Close on Esc key
- ✅ Trap focus within modal
- ✅ Provide clear close option
- ❌ Don't nest modals

## Layout

### Grid System

- **Columns**: 12-column grid
- **Gutter**: 24px
- **Max width**: 1200px
- **Breakpoints**:
  - Mobile: < 640px
  - Tablet: 640px - 1023px
  - Desktop: ≥ 1024px

### Responsive Behavior

- **Mobile**: 1 column, full width
- **Tablet**: 2-3 columns
- **Desktop**: 3-4 columns

## Elevation (Shadows)

| Level | Shadow | Usage |
|-------|--------|-------|
| 0 | None | Flat surfaces |
| 1 | 0 1px 2px rgba(0,0,0,0.05) | Cards at rest |
| 2 | 0 1px 3px rgba(0,0,0,0.1) | Hover states |
| 3 | 0 4px 6px rgba(0,0,0,0.1) | Dropdowns |
| 4 | 0 10px 15px rgba(0,0,0,0.1) | Modals |

## Border Radius

| Token | Size | Usage |
|-------|------|-------|
| radius-sm | 4px | Small components |
| radius-md | 6px | Buttons, inputs (default) |
| radius-lg | 8px | Cards |
| radius-xl | 12px | Large cards, modals |
| radius-full | 9999px | Pills, avatars |

## Icons

**Icon Set**: [Heroicons / Lucide / Font Awesome / etc.]

**Sizes:**
- Small: 16px
- Medium: 20px (default)
- Large: 24px
- XL: 32px

**Rules:**
- ✅ Use consistent icon set
- ✅ Pair with text for clarity
- ✅ Add aria-label for icon-only buttons
- ❌ Don't mix icon sets

## Accessibility Standards

### Color Contrast
- Normal text: 4.5:1 minimum
- Large text: 3:1 minimum
- UI components: 3:1 minimum

### Keyboard Navigation
- All interactive elements must be keyboard accessible
- Visible focus indicators required
- Logical tab order

### Screen Readers
- Semantic HTML required
- ARIA labels for custom components
- Alt text for images

### WCAG Compliance
- Target: WCAG 2.1 Level AA

## Animation & Motion

### Duration
- Micro-interactions: 100-200ms
- Component transitions: 200-300ms
- Page transitions: 300-500ms

### Easing
- Default: `ease-out`
- Entrances: `ease-out`
- Exits: `ease-in`

### Accessibility
- Respect `prefers-reduced-motion`
- Keep animations under 500ms
- Don't animate critical actions

## Usage Guidelines

### When to Use This System

- ✅ All new features and pages
- ✅ Component updates and redesigns
- ✅ External tools and integrations

### When to Deviate

Document and get approval for:
- Brand campaigns requiring unique styling
- Experimental features being validated
- Third-party integrations with their own styles

### Contributing

1. Propose changes via [process]
2. Get design review approval
3. Update this document
4. Communicate changes to team

## Resources

- **Design files**: [Link to Figma/Sketch]
- **Component library**: [Link to Storybook/docs]
- **Code repository**: [Link to GitHub]
- **Support**: [Contact/Slack channel]

## Changelog

### Version 1.0 (Date)
- Initial design system documentation
- Defined color palette, typography, spacing
- Documented core components

---

**Last updated:** [Date]
**Contributors:** [Names]
