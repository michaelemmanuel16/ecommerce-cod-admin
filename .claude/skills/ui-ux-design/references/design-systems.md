# Design Systems

A design system is a comprehensive set of standards, components, and guidelines that ensure consistency across a product.

## Color Systems

### Color Theory Fundamentals

**Primary Color Categories:**
- **Primary**: Main brand colors (1-2 colors)
- **Secondary**: Supporting colors for variety (1-3 colors)
- **Neutral**: Grays for text, backgrounds, borders (8-10 shades)
- **Semantic**: Status colors (success, warning, error, info)

### Color Palette Structure

**Recommended approach:** 10-shade scale per color (50-900)

```
Primary Blue Scale Example:
50:  #EFF6FF (very light)
100: #DBEAFE
200: #BFDBFE
300: #93C5FD
400: #60A5FA
500: #3B82F6 ← Base color
600: #2563EB
700: #1D4ED8
800: #1E40AF
900: #1E3A8A (very dark)
```

**Generator tools:**
- Tailwind CSS color palette generator
- Material Design color tool
- Coolors.co
- Adobe Color

### Color Accessibility

**Contrast Requirements (WCAG AA):**
- Normal text: 4.5:1 minimum
- Large text (18pt+ or 14pt+ bold): 3:1 minimum
- UI components: 3:1 minimum

**Best Practices:**
- Don't rely on color alone to convey information
- Test with color blindness simulators
- Provide sufficient contrast for all text
- Use semantic colors consistently (green = success, red = error)

### Semantic Color System

```css
/* Success */
--color-success-50: #F0FDF4;
--color-success-500: #22C55E;
--color-success-700: #15803D;

/* Warning */
--color-warning-50: #FFFBEB;
--color-warning-500: #F59E0B;
--color-warning-700: #B45309;

/* Error */
--color-error-50: #FEF2F2;
--color-error-500: #EF4444;
--color-error-700: #B91C1C;

/* Info */
--color-info-50: #EFF6FF;
--color-info-500: #3B82F6;
--color-info-700: #1D4ED8;
```

### Dark Mode Considerations

**Approach 1: Separate palettes**
```css
/* Light mode */
--background: #FFFFFF;
--foreground: #0F172A;
--muted: #F1F5F9;

/* Dark mode */
@media (prefers-color-scheme: dark) {
  --background: #0F172A;
  --foreground: #F8FAFC;
  --muted: #1E293B;
}
```

**Approach 2: Inverted scales**
- Light mode uses 50-500 range
- Dark mode uses 500-900 range

**Best practices:**
- Reduce contrast slightly in dark mode (pure white is harsh)
- Adjust saturation (colors appear more vibrant on dark backgrounds)
- Test legibility in both modes
- Consider user preference with toggle

## Typography

### Type Scale

**Recommended scale:** Modular scale with 1.25 ratio (major third)

```css
/* Example type scale */
--text-xs: 0.75rem;   /* 12px */
--text-sm: 0.875rem;  /* 14px */
--text-base: 1rem;    /* 16px */
--text-lg: 1.25rem;   /* 20px */
--text-xl: 1.5rem;    /* 24px */
--text-2xl: 1.875rem; /* 30px */
--text-3xl: 2.25rem;  /* 36px */
--text-4xl: 3rem;     /* 48px */
--text-5xl: 3.75rem;  /* 60px */
--text-6xl: 4.5rem;   /* 72px */
```

**Common ratios:**
- 1.125 (Major Second) - Subtle
- 1.200 (Minor Third) - Balanced
- 1.250 (Major Third) - Recommended
- 1.333 (Perfect Fourth) - Dramatic
- 1.414 (Augmented Fourth) - Bold
- 1.618 (Golden Ratio) - Classic

### Font Selection

**Typeface Categories:**
- **Serif**: Traditional, formal, trustworthy (Georgia, Times)
- **Sans-serif**: Modern, clean, readable (Inter, Roboto, Open Sans)
- **Monospace**: Code, technical (Fira Code, JetBrains Mono)
- **Display**: Headlines, branding (custom display fonts)

**Pairing Guidelines:**
- Use 1-2 font families maximum
- Pair serif with sans-serif for contrast
- Ensure sufficient distinction between weights
- Consider web font performance (variable fonts)

**Recommended web fonts:**
- Inter (versatile sans-serif)
- Roboto (clean, modern)
- Poppins (friendly, rounded)
- Lato (professional)
- Merriweather (readable serif)

### Font Weights

```css
--font-thin: 100;
--font-extralight: 200;
--font-light: 300;
--font-normal: 400;
--font-medium: 500;
--font-semibold: 600;
--font-bold: 700;
--font-extrabold: 800;
--font-black: 900;
```

**Usage:**
- Normal (400): Body text
- Medium (500): Subtle emphasis
- Semibold (600): Buttons, labels
- Bold (700): Headings, important text

### Line Height & Letter Spacing

**Line Height (leading):**
```css
--leading-none: 1;      /* Headings */
--leading-tight: 1.25;  /* Headings */
--leading-snug: 1.375;  /* Short paragraphs */
--leading-normal: 1.5;  /* Body text */
--leading-relaxed: 1.625; /* Long-form content */
--leading-loose: 2;     /* Special cases */
```

**Letter Spacing (tracking):**
```css
--tracking-tighter: -0.05em;
--tracking-tight: -0.025em;
--tracking-normal: 0;
--tracking-wide: 0.025em;
--tracking-wider: 0.05em;
--tracking-widest: 0.1em;
```

**Best practices:**
- Body text: 1.5-1.75 line height
- Headings: 1.1-1.3 line height
- Increase line height for longer line lengths
- Reduce tracking for large headings
- Increase tracking for uppercase text

### Text Hierarchy

```css
/* Heading styles */
h1 {
  font-size: var(--text-4xl);
  font-weight: var(--font-bold);
  line-height: var(--leading-tight);
  letter-spacing: var(--tracking-tight);
}

h2 {
  font-size: var(--text-3xl);
  font-weight: var(--font-bold);
  line-height: var(--leading-tight);
}

h3 {
  font-size: var(--text-2xl);
  font-weight: var(--font-semibold);
  line-height: var(--leading-snug);
}

/* Body text */
body {
  font-size: var(--text-base);
  font-weight: var(--font-normal);
  line-height: var(--leading-normal);
}

/* Small text */
.text-small {
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
}
```

## Spacing System

### Spatial Scale

**Recommended: 4px base unit (or 8px for larger designs)**

```css
/* 4px base unit scale */
--space-0: 0;
--space-1: 0.25rem;  /* 4px */
--space-2: 0.5rem;   /* 8px */
--space-3: 0.75rem;  /* 12px */
--space-4: 1rem;     /* 16px */
--space-5: 1.25rem;  /* 20px */
--space-6: 1.5rem;   /* 24px */
--space-8: 2rem;     /* 32px */
--space-10: 2.5rem;  /* 40px */
--space-12: 3rem;    /* 48px */
--space-16: 4rem;    /* 64px */
--space-20: 5rem;    /* 80px */
--space-24: 6rem;    /* 96px */
--space-32: 8rem;    /* 128px */
```

**8px base unit scale (alternative):**
```css
--space-1: 0.5rem;   /* 8px */
--space-2: 1rem;     /* 16px */
--space-3: 1.5rem;   /* 24px */
--space-4: 2rem;     /* 32px */
--space-5: 2.5rem;   /* 40px */
--space-6: 3rem;     /* 48px */
--space-8: 4rem;     /* 64px */
--space-10: 5rem;    /* 80px */
--space-12: 6rem;    /* 96px */
```

### Spacing Usage Guidelines

**Internal component spacing:**
- Buttons: 12px (vertical) × 20px (horizontal)
- Input fields: 10px (vertical) × 12px (horizontal)
- Cards: 16px-24px padding

**Layout spacing:**
- Section padding: 48px-96px
- Grid gaps: 16px-32px
- Stack spacing: 8px-16px

**Density levels:**
- Compact: space-2 to space-4
- Normal: space-4 to space-6
- Comfortable: space-6 to space-8

### Vertical Rhythm

Maintain consistent vertical spacing throughout the page.

```css
/* Example vertical rhythm */
.section {
  margin-bottom: var(--space-16);
}

.heading {
  margin-bottom: var(--space-4);
}

.paragraph {
  margin-bottom: var(--space-6);
}

.list-item {
  margin-bottom: var(--space-2);
}
```

## Sizing System

### Component Sizes

**Common size variants:**

```css
/* Button sizes */
.btn-sm {
  height: 32px;
  padding: 0 12px;
  font-size: 0.875rem;
}

.btn-md {
  height: 40px;
  padding: 0 16px;
  font-size: 1rem;
}

.btn-lg {
  height: 48px;
  padding: 0 20px;
  font-size: 1.125rem;
}

/* Input sizes */
.input-sm {
  height: 32px;
  padding: 0 12px;
  font-size: 0.875rem;
}

.input-md {
  height: 40px;
  padding: 0 12px;
  font-size: 1rem;
}

.input-lg {
  height: 48px;
  padding: 0 16px;
  font-size: 1.125rem;
}

/* Avatar sizes */
.avatar-xs { width: 24px; height: 24px; }
.avatar-sm { width: 32px; height: 32px; }
.avatar-md { width: 40px; height: 40px; }
.avatar-lg { width: 48px; height: 48px; }
.avatar-xl { width: 64px; height: 64px; }
```

### Icon Sizes

```css
--icon-xs: 12px;
--icon-sm: 16px;
--icon-md: 20px;
--icon-lg: 24px;
--icon-xl: 32px;
```

## Border System

### Border Width

```css
--border-0: 0;
--border-1: 1px;
--border-2: 2px;
--border-4: 4px;
--border-8: 8px;
```

**Usage:**
- Default borders: 1px
- Focus indicators: 2px
- Emphasis/dividers: 2px
- Thick decorative: 4px+

### Border Radius

```css
--radius-none: 0;
--radius-sm: 0.125rem;  /* 2px */
--radius-md: 0.375rem;  /* 6px */
--radius-lg: 0.5rem;    /* 8px */
--radius-xl: 0.75rem;   /* 12px */
--radius-2xl: 1rem;     /* 16px */
--radius-3xl: 1.5rem;   /* 24px */
--radius-full: 9999px;  /* Pill shape */
```

**Usage:**
- Buttons: 6px-8px
- Cards: 8px-12px
- Modals: 12px-16px
- Inputs: 6px
- Pills/tags: 9999px (full)

### Border Colors

```css
--border-default: rgba(0, 0, 0, 0.1);
--border-muted: rgba(0, 0, 0, 0.05);
--border-strong: rgba(0, 0, 0, 0.2);

/* Dark mode */
@media (prefers-color-scheme: dark) {
  --border-default: rgba(255, 255, 255, 0.1);
  --border-muted: rgba(255, 255, 255, 0.05);
  --border-strong: rgba(255, 255, 255, 0.2);
}
```

## Shadow System

### Elevation Levels

```css
/* Shadow scale */
--shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.05);
--shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.1),
             0 1px 2px rgba(0, 0, 0, 0.06);
--shadow-md: 0 4px 6px rgba(0, 0, 0, 0.07),
             0 2px 4px rgba(0, 0, 0, 0.05);
--shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.1),
             0 4px 6px rgba(0, 0, 0, 0.05);
--shadow-xl: 0 20px 25px rgba(0, 0, 0, 0.1),
             0 10px 10px rgba(0, 0, 0, 0.04);
--shadow-2xl: 0 25px 50px rgba(0, 0, 0, 0.25);
--shadow-inner: inset 0 2px 4px rgba(0, 0, 0, 0.06);
```

**Usage by elevation:**
- Cards at rest: shadow-sm
- Hover states: shadow-md
- Dropdowns/popovers: shadow-lg
- Modals: shadow-xl
- Focus rings: custom outline shadow

### Focus Rings

```css
--ring-width: 2px;
--ring-offset: 2px;

.focus-ring {
  box-shadow: 0 0 0 var(--ring-offset) white,
              0 0 0 calc(var(--ring-offset) + var(--ring-width)) var(--color-primary-500);
}
```

## Animation & Motion

### Duration

```css
--duration-75: 75ms;
--duration-100: 100ms;
--duration-150: 150ms;
--duration-200: 200ms;
--duration-300: 300ms;
--duration-500: 500ms;
--duration-700: 700ms;
--duration-1000: 1000ms;
```

**Usage:**
- Micro-interactions: 75-150ms
- Component transitions: 150-300ms
- Page transitions: 300-500ms
- Animations: 500-1000ms

### Easing Functions

```css
--ease-linear: linear;
--ease-in: cubic-bezier(0.4, 0, 1, 1);
--ease-out: cubic-bezier(0, 0, 0.2, 1);
--ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
```

**Usage:**
- Ease-out: Entrances, openings (most common)
- Ease-in: Exits, closings
- Ease-in-out: State changes
- Linear: Continuous animations (loaders)

### Motion Best Practices

- Reduce motion for accessibility (`prefers-reduced-motion`)
- Keep animations under 500ms for interactions
- Use ease-out for most transitions
- Animate transform and opacity (GPU-accelerated)
- Avoid animating layout properties (width, height, margin)

```css
/* Respect user preference */
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

## Component Tokens

### Button Tokens

```css
--btn-padding-x: 1rem;
--btn-padding-y: 0.5rem;
--btn-font-size: 1rem;
--btn-font-weight: 500;
--btn-line-height: 1.5;
--btn-border-radius: 0.375rem;
--btn-transition: all 150ms ease-out;

/* Variants */
--btn-primary-bg: var(--color-primary-500);
--btn-primary-text: white;
--btn-primary-hover-bg: var(--color-primary-600);

--btn-secondary-bg: var(--color-neutral-100);
--btn-secondary-text: var(--color-neutral-900);
--btn-secondary-hover-bg: var(--color-neutral-200);
```

### Form Input Tokens

```css
--input-padding-x: 0.75rem;
--input-padding-y: 0.5rem;
--input-font-size: 1rem;
--input-line-height: 1.5;
--input-border-width: 1px;
--input-border-color: var(--color-neutral-300);
--input-border-radius: 0.375rem;
--input-focus-border-color: var(--color-primary-500);
--input-focus-ring: 0 0 0 3px rgba(59, 130, 246, 0.1);
```

## Design Tokens Implementation

### CSS Custom Properties

```css
:root {
  /* Colors */
  --color-primary-500: #3B82F6;
  --color-neutral-900: #0F172A;

  /* Spacing */
  --space-4: 1rem;

  /* Typography */
  --text-base: 1rem;
  --font-normal: 400;

  /* Borders */
  --radius-md: 0.375rem;

  /* Shadows */
  --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.07);
}
```

### JavaScript/TypeScript

```typescript
export const tokens = {
  colors: {
    primary: {
      500: '#3B82F6',
    },
    neutral: {
      900: '#0F172A',
    },
  },
  spacing: {
    4: '1rem',
  },
  typography: {
    base: '1rem',
  },
};
```

### Tailwind Config

```javascript
module.exports = {
  theme: {
    extend: {
      colors: {
        primary: {
          500: '#3B82F6',
        },
      },
      spacing: {
        '4': '1rem',
      },
    },
  },
};
```

## Documentation Best Practices

**Essential documentation:**
- Color palette with accessibility notes
- Typography scale with usage examples
- Spacing system with component examples
- Component anatomy and variants
- Usage guidelines and do's/don'ts
- Code examples and snippets

**Tools for documentation:**
- Storybook for component documentation
- Figma for design specs
- Style dictionary for token generation
- Markdown files for guidelines
