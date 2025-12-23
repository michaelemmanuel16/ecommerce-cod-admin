---
name: ui-ux-design
description: Use this skill when designing user interfaces, improving UX, creating design systems, auditing accessibility, wireframing pages, conducting user research, or when the user requests "better UI/UX", "design a page/dashboard", "accessibility audit", or mentions design thinking, usability, or user experience. Covers design systems, accessibility (WCAG 2.1), responsive design, component patterns, and user research methods.
---

# UI/UX Design Skill

## Overview

Provide comprehensive UI/UX design guidance covering design systems, accessibility, responsive design, component patterns, user research, and wireframing. Use this skill when asked to design interfaces, improve user experience, audit accessibility, or create better pages/dashboards.

## When to Use This Skill

Invoke this skill when the user requests:
- "Design a better [page/dashboard/interface]"
- "Improve the UX of [feature]"
- "Create a design system"
- "Audit accessibility" or "check WCAG compliance"
- "Create wireframes for [feature]"
- "Design [component/pattern]"
- User research, personas, or journey maps
- Responsive design or mobile-first layouts
- Component design patterns
- Color, typography, or spacing systems

## Design Workflow

Follow this design thinking process for all design tasks:

### Step 1: Understand (Empathize)
- Ask clarifying questions about user needs
- Reference `references/user-research.md` for research methods
- Understand business goals and constraints
- Identify target users and their context

### Step 2: Define the Problem
- Create problem statements
- Define success criteria
- Identify key user flows
- Prioritize features and requirements

### Step 3: Ideate Solutions
- Reference design patterns from `references/component-patterns.md`
- Consider accessibility requirements from `references/accessibility-wcag.md`
- Review responsive design patterns from `references/responsive-design.md`
- Generate multiple solution options

### Step 4: Prototype
- Create text-based wireframes using `assets/wireframe-templates.md`
- Document design decisions
- Reference `references/shadcn-components.md` for available UI components
- Apply design system principles from `references/design-systems.md`

### Step 5: Validate
- Check accessibility with `scripts/html_a11y_validator.py`
- Verify color contrast with `scripts/color_contrast_checker.py`
- Review against UX heuristics from `references/ux-principles.md`
- Consider responsive behavior

### Step 6: Document
- Document design patterns
- Create implementation guidance
- Provide accessibility notes
- Include responsive breakpoints

## Core Capabilities

### 1. Design System Creation

Create comprehensive design systems covering colors, typography, spacing, and components.

**When to use:**
- User asks to "create a design system"
- Inconsistent design needs standardization
- Starting a new project

**How to use:**
1. Use `assets/design-system-template.md` as starting point
2. Reference `references/design-systems.md` for guidance on:
   - Color palette structure (50-900 scales)
   - Typography scales and pairing
   - Spacing systems (4px or 8px base)
   - Component tokens
   - Shadow/elevation systems
3. Document semantic colors (success, warning, error, info)
4. Define component variants and sizes
5. Validate color contrast with `scripts/color_contrast_checker.py`

**Example output:**
```
# Project Design System

## Colors
Primary 500: #3B82F6 (WCAG AA compliant with white: 4.8:1)
Neutral 900: #0F172A (for text)
Success 500: #10B981

## Typography
Base: 16px (1rem)
H1: 36px (2.25rem), weight 700, line-height 1.25
Body: 16px, weight 400, line-height 1.5

## Spacing (4px base)
space-4: 16px (default padding)
space-8: 32px (section spacing)
```

### 2. Accessibility Auditing

Audit designs and implementations for WCAG 2.1 AA compliance.

**When to use:**
- User requests "accessibility audit" or "check WCAG compliance"
- Reviewing existing pages/components
- Before launching new features

**How to use:**
1. Reference `references/accessibility-wcag.md` for WCAG standards
2. Use `assets/accessibility-checklist.md` for systematic review
3. Run `scripts/color_contrast_checker.py` to verify color combinations:
   ```bash
   python3 scripts/color_contrast_checker.py "#000000" "#FFFFFF"
   ```
4. Run `scripts/html_a11y_validator.py` on HTML files:
   ```bash
   python3 scripts/html_a11y_validator.py index.html
   ```
5. Check against common issues:
   - Missing alt text on images
   - Form inputs without labels
   - Insufficient color contrast (4.5:1 for text, 3:1 for UI)
   - Missing keyboard navigation
   - No focus indicators
   - Poor heading hierarchy

**Key compliance requirements:**
- Normal text: 4.5:1 contrast minimum
- Large text (18pt+ or 14pt+ bold): 3:1 minimum
- UI components: 3:1 minimum
- Keyboard accessible
- Screen reader compatible (proper ARIA, semantic HTML)
- Visible focus indicators

### 3. Wireframing & Prototyping

Create text-based wireframes for rapid ideation.

**When to use:**
- Planning new pages or features
- User requests mockups or wireframes
- Communicating design concepts

**How to use:**
1. Use templates from `assets/wireframe-templates.md`:
   - Landing pages
   - Dashboards / admin panels
   - E-commerce product listings
   - Forms and modals
   - Data tables
   - Mobile app screens
   - Kanban boards
   - Settings pages
2. Customize templates to match requirements
3. Annotate with interactions and states
4. Include responsive behavior notes

**Example wireframe:**
```
┌─────────────────────────────────────┐
│ Dashboard                     [⚙]   │
├─────────────────────────────────────┤
│  ┌──────┐  ┌──────┐  ┌──────┐     │
│  │1,234 │  │ 567  │  │ 89%  │     │
│  │Orders│  │Users │  │Conv. │     │
│  └──────┘  └──────┘  └──────┘     │
├─────────────────────────────────────┤
│  Recent Orders          [View All]  │
│  ┌───────────────────────────────┐ │
│  │ #123  Customer  $45  Pending  │ │
│  │ #124  Another   $67  Shipped  │ │
│  └───────────────────────────────┘ │
└─────────────────────────────────────┘
```

### 4. Component Design Patterns

Apply proven UI component patterns and best practices.

**When to use:**
- Designing specific components (buttons, forms, tables, etc.)
- User asks "how should I design [component]"
- Reviewing component implementations

**How to use:**
1. Reference `references/component-patterns.md` for patterns on:
   - Buttons (hierarchy, states, sizing)
   - Forms (layout, validation, labels)
   - Modals/dialogs (anatomy, types, accessibility)
   - Tables (structure, sorting, responsive)
   - Navigation (patterns, accessibility)
   - Cards, notifications, dropdowns, tooltips, etc.
2. For this project specifically, consult `references/shadcn-components.md` for:
   - Available Shadcn UI components
   - Component usage patterns
   - Accessibility features
   - Customization examples
3. Apply component-specific best practices
4. Ensure accessibility compliance

**Example: Button hierarchy**
- **Primary**: One per section, main CTA (filled, primary color)
- **Secondary**: Supporting actions (outline or subtle)
- **Tertiary**: Low-priority (ghost/text only)
- **Destructive**: Dangerous actions (red color)

### 5. Responsive Design

Design mobile-first, responsive interfaces.

**When to use:**
- Designing new pages/features
- User mentions "mobile" or "responsive"
- Reviewing desktop-only designs

**How to use:**
1. Reference `references/responsive-design.md` for:
   - Standard breakpoints (640px, 768px, 1024px, 1280px)
   - Mobile-first approach
   - Responsive patterns (column drop, layout shifter, etc.)
   - Touch optimization (44px minimum targets)
   - Responsive images and typography
2. Design mobile first, then enhance for larger screens
3. Use flexible layouts (CSS Grid, Flexbox)
4. Test at multiple breakpoints
5. Ensure touch targets are 44×44px minimum

**Breakpoint strategy:**
```css
/* Mobile first */
.container { padding: 16px; }

@media (min-width: 768px) {
  .container { padding: 24px; }
}

@media (min-width: 1024px) {
  .container { padding: 32px; max-width: 1200px; }
}
```

### 6. User Research & Personas

Create user personas and conduct research to inform design decisions.

**When to use:**
- Starting new projects
- User asks about target users
- Need to validate design decisions
- Creating user-centered designs

**How to use:**
1. Reference `references/user-research.md` for:
   - User interview methods
   - Persona creation
   - Journey mapping
   - User stories and JTBD
   - Research methods (qualitative and quantitative)
2. Use `assets/user-persona-template.md` to create personas
3. Create user journey maps for key workflows
4. Write user stories in format:
   ```
   As a [type of user],
   I want [goal/desire],
   So that [benefit/value].
   ```
5. Validate designs against user needs

**Example persona snippet:**
```
Sarah Chen - Operations Manager
Age: 35 • Tech-savvy • Goal: Monitor team performance
Pain points: Manual reports, delayed data, system switching
Quote: "I need one dashboard that shows everything."
```

### 7. UX Principles & Heuristics

Apply established UX principles to designs.

**When to use:**
- Evaluating designs
- User asks "is this good UX?"
- Design reviews

**How to use:**
1. Reference `references/ux-principles.md` for:
   - Nielsen's 10 Usability Heuristics
   - Laws of UX (Fitts's Law, Hick's Law, Jakob's Law)
   - Design thinking process
   - Information architecture principles
   - Interaction design patterns
2. Evaluate designs against heuristics:
   - Visibility of system status
   - Match between system and real world
   - User control and freedom
   - Consistency and standards
   - Error prevention
   - Recognition over recall
   - Flexibility and efficiency
   - Aesthetic and minimalist design
   - Help users with errors
   - Help and documentation
3. Apply UX laws to optimize interactions
4. Follow design thinking process (Empathize → Define → Ideate → Prototype → Test)

## Workflow Examples

### Example 1: Designing a New Dashboard

**User request:** "Design a better admin dashboard for viewing orders"

**Workflow:**
1. **Understand:**
   - Ask: "What are the key metrics you need to see? Who uses this? How often?"
   - Review user personas (Operations Manager, Admin)
   - Identify primary goals: Monitor orders, spot issues, take action

2. **Define:**
   - Problem: Need quick overview of order status and ability to drill down
   - Success: Can see critical metrics at a glance, take action in < 3 clicks

3. **Ideate:**
   - Reference `references/component-patterns.md` for dashboard patterns
   - Consider: Stats cards, recent orders table, charts
   - Review `references/shadcn-components.md` for available components

4. **Prototype:**
   - Use `assets/wireframe-templates.md` Dashboard template
   - Create wireframe with:
     - Stats cards (total orders, pending, delivered, revenue)
     - Recent orders table with actions
     - Filtering and search
     - Real-time updates indication

5. **Validate:**
   - Check responsive behavior (mobile: stack cards, desktop: grid)
   - Verify touch targets (44px minimum)
   - Ensure keyboard navigation
   - Check color contrast for status badges

6. **Document:**
   - Provide implementation notes
   - Reference Shadcn components to use (Card, Table, Badge, Button)
   - Include responsive breakpoints
   - Note accessibility requirements

### Example 2: Accessibility Audit

**User request:** "Audit this page for accessibility"

**Workflow:**
1. Use `assets/accessibility-checklist.md` for systematic review
2. Run `scripts/html_a11y_validator.py` on HTML file
3. Check color contrast with `scripts/color_contrast_checker.py`
4. Manual checks:
   - Keyboard navigation (Tab through all interactive elements)
   - Focus indicators visible
   - Alt text on images
   - Form labels present
   - Heading hierarchy logical
   - ARIA attributes correct
5. Document issues by severity:
   - **Critical**: Missing alt text, inaccessible forms, < 3:1 contrast
   - **Major**: Poor focus indicators, keyboard traps, confusing labels
   - **Minor**: Suboptimal heading hierarchy, missing ARIA landmarks
6. Provide specific fixes with code examples

### Example 3: Creating a Form

**User request:** "Design a user registration form"

**Workflow:**
1. **Reference patterns:**
   - `references/component-patterns.md` → Forms section
   - `references/shadcn-components.md` → Form, Input, Button components
   - `references/accessibility-wcag.md` → Form accessibility

2. **Design decisions:**
   - Top-aligned labels (best for scanning)
   - Inline validation (on blur)
   - Clear required indicators (*)
   - Helpful error messages
   - Password strength indicator

3. **Create wireframe:**
   - Use `assets/wireframe-templates.md` → Form/Modal template
   - Customize for registration fields

4. **Accessibility:**
   - All inputs have labels
   - Use `autocomplete` attributes
   - Error messages linked with `aria-describedby`
   - Form validation with clear feedback

5. **Implementation guidance:**
   - Use Shadcn Form component with React Hook Form + Zod
   - Provide code example
   - Note responsive behavior

## Reference Materials

### Comprehensive Guides (in `references/`)
- `ux-principles.md` - Nielsen's heuristics, UX laws, design thinking
- `accessibility-wcag.md` - WCAG 2.1 AA standards and implementation
- `design-systems.md` - Color, typography, spacing, tokens
- `component-patterns.md` - Button, forms, modals, tables, navigation patterns
- `responsive-design.md` - Breakpoints, mobile-first, patterns
- `shadcn-components.md` - Project-specific Shadcn UI components
- `user-research.md` - Personas, journey maps, research methods

### Templates (in `assets/`)
- `design-system-template.md` - Complete design system documentation template
- `accessibility-checklist.md` - WCAG 2.1 AA audit checklist
- `wireframe-templates.md` - Text-based wireframes for common layouts
- `user-persona-template.md` - User persona documentation template

### Utilities (in `scripts/`)
- `color_contrast_checker.py` - Calculate WCAG contrast ratios
- `html_a11y_validator.py` - Basic HTML accessibility validation

## Common Tasks Quick Reference

**Check color contrast:**
```bash
python3 scripts/color_contrast_checker.py "#3B82F6" "#FFFFFF"
```

**Validate HTML accessibility:**
```bash
python3 scripts/html_a11y_validator.py index.html
```

**Create wireframe:**
1. Copy template from `assets/wireframe-templates.md`
2. Customize for your needs
3. Annotate with interactions

**Design system:**
1. Use `assets/design-system-template.md`
2. Reference `references/design-systems.md` for guidance
3. Validate colors with contrast checker

**Accessibility audit:**
1. Use `assets/accessibility-checklist.md`
2. Run validation scripts
3. Manual keyboard and screen reader testing

**User persona:**
1. Use `assets/user-persona-template.md`
2. Reference `references/user-research.md` for research methods
3. Base on real user data when possible

## Best Practices

✅ **Always:**
- Start with user needs
- Design mobile-first
- Check accessibility (WCAG 2.1 AA minimum)
- Use established patterns before inventing new ones
- Validate color contrast
- Test with keyboard
- Provide clear labels and instructions
- Use semantic HTML
- Document design decisions

❌ **Never:**
- Design without understanding users
- Skip accessibility considerations
- Use color as the only indicator
- Remove focus indicators
- Create overly complex interactions
- Ignore responsive design
- Make assumptions about user behavior
- Skip usability testing

## Integration with This Project

When working on the e-commerce COD admin dashboard:
- Reference `references/shadcn-components.md` for available components
- Follow existing design patterns in the project
- Use Shadcn UI components (Button, Form, Table, Card, Dialog, etc.)
- Maintain consistency with current color scheme and typography
- Consider user personas: Operations Manager, Delivery Agent, Sales Rep
- Apply accessibility standards (WCAG 2.1 AA)
- Design for both desktop (primary) and mobile (secondary) use

---

**Remember:** Good UI/UX design is user-centered, accessible, consistent, and validated with real users. Always prioritize user needs over aesthetics, and ensure all designs are accessible to everyone.
