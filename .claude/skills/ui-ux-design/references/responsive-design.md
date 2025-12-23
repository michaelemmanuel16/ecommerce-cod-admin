# Responsive Design & Mobile-First Patterns

## Mobile-First Philosophy

**Principle:** Design for mobile devices first, then progressively enhance for larger screens.

**Why mobile-first:**
- Forces focus on essential content and features
- Easier to scale up than scale down
- Better performance on mobile devices
- Aligns with majority of web traffic (mobile > desktop)

**Mobile-first CSS approach:**
```css
/* Base styles for mobile */
.container {
  padding: 16px;
  font-size: 16px;
}

/* Tablet and up */
@media (min-width: 768px) {
  .container {
    padding: 24px;
    font-size: 18px;
  }
}

/* Desktop and up */
@media (min-width: 1024px) {
  .container {
    padding: 32px;
    max-width: 1200px;
    margin: 0 auto;
  }
}
```

## Standard Breakpoints

### Common Breakpoint System

```css
/* Mobile-first breakpoints (min-width) */
--screen-sm: 640px;   /* Small devices (landscape phones) */
--screen-md: 768px;   /* Medium devices (tablets) */
--screen-lg: 1024px;  /* Large devices (laptops) */
--screen-xl: 1280px;  /* Extra large (desktops) */
--screen-2xl: 1536px; /* 2X Extra large (large desktops) */
```

### Tailwind CSS Breakpoints (Reference)

```css
sm:  640px  /* @media (min-width: 640px) */
md:  768px  /* @media (min-width: 768px) */
lg:  1024px /* @media (min-width: 1024px) */
xl:  1280px /* @media (min-width: 1280px) */
2xl: 1536px /* @media (min-width: 1536px) */
```

### Bootstrap Breakpoints (Reference)

```css
xs: <576px   /* Extra small (mobile) */
sm: ≥576px   /* Small (landscape phones) */
md: ≥768px   /* Medium (tablets) */
lg: ≥992px   /* Large (desktops) */
xl: ≥1200px  /* Extra large (wide desktops) */
xxl: ≥1400px /* Extra extra large */
```

### Material Design Breakpoints (Reference)

```css
xs: 0-599px
sm: 600-959px
md: 960-1279px
lg: 1280-1919px
xl: 1920px+
```

## Device Targeting

### Target Ranges

```css
/* Mobile only */
@media (max-width: 767px) { }

/* Tablet only */
@media (min-width: 768px) and (max-width: 1023px) { }

/* Desktop only */
@media (min-width: 1024px) { }

/* Touch devices */
@media (hover: none) and (pointer: coarse) { }

/* Mouse/trackpad devices */
@media (hover: hover) and (pointer: fine) { }

/* Portrait orientation */
@media (orientation: portrait) { }

/* Landscape orientation */
@media (orientation: landscape) { }

/* High DPI screens (Retina) */
@media (-webkit-min-device-pixel-ratio: 2),
       (min-resolution: 192dpi) { }
```

## Responsive Layouts

### Fluid Grids

**CSS Grid approach:**
```css
.grid {
  display: grid;
  gap: 1rem;

  /* Mobile: 1 column */
  grid-template-columns: 1fr;
}

@media (min-width: 768px) {
  .grid {
    /* Tablet: 2 columns */
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (min-width: 1024px) {
  .grid {
    /* Desktop: 3-4 columns */
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  }
}
```

**Flexbox approach:**
```css
.flex-container {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}

.flex-item {
  /* Mobile: full width */
  flex: 1 1 100%;
}

@media (min-width: 768px) {
  .flex-item {
    /* Tablet: half width */
    flex: 1 1 calc(50% - 0.5rem);
  }
}

@media (min-width: 1024px) {
  .flex-item {
    /* Desktop: third width */
    flex: 1 1 calc(33.333% - 0.667rem);
  }
}
```

### Container Queries (Modern Approach)

```css
.card-container {
  container-type: inline-size;
}

.card {
  padding: 1rem;
}

/* Adjust based on container width, not viewport */
@container (min-width: 400px) {
  .card {
    padding: 2rem;
  }
}
```

## Responsive Typography

### Fluid Typography

**Using clamp():**
```css
/* Fluid font size: min 16px, preferred 1vw + 12px, max 24px */
h1 {
  font-size: clamp(1.5rem, 4vw + 1rem, 3rem);
}

h2 {
  font-size: clamp(1.25rem, 3vw + 0.5rem, 2.25rem);
}

p {
  font-size: clamp(1rem, 1vw + 0.5rem, 1.125rem);
}
```

**Breakpoint-based:**
```css
body {
  font-size: 16px;
}

@media (min-width: 768px) {
  body {
    font-size: 18px;
  }
}

@media (min-width: 1024px) {
  body {
    font-size: 20px;
  }
}
```

### Responsive Line Height & Spacing

```css
p {
  line-height: 1.6; /* Mobile: tighter */
}

@media (min-width: 768px) {
  p {
    line-height: 1.75; /* Desktop: more spacious */
  }
}
```

## Responsive Images

### Techniques

**1. Flexible Images (basic)**
```css
img {
  max-width: 100%;
  height: auto;
}
```

**2. Picture Element (art direction)**
```html
<picture>
  <!-- Mobile: cropped/portrait image -->
  <source media="(max-width: 767px)" srcset="image-mobile.jpg">

  <!-- Tablet: medium image -->
  <source media="(max-width: 1023px)" srcset="image-tablet.jpg">

  <!-- Desktop: full landscape image -->
  <img src="image-desktop.jpg" alt="Description">
</picture>
```

**3. Srcset (resolution switching)**
```html
<img
  srcset="image-320w.jpg 320w,
          image-640w.jpg 640w,
          image-1024w.jpg 1024w"
  sizes="(max-width: 767px) 100vw,
         (max-width: 1023px) 50vw,
         33vw"
  src="image-640w.jpg"
  alt="Description"
>
```

**4. CSS Background Images**
```css
.hero {
  background-image: url('hero-mobile.jpg');
}

@media (min-width: 768px) {
  .hero {
    background-image: url('hero-tablet.jpg');
  }
}

@media (min-width: 1024px) {
  .hero {
    background-image: url('hero-desktop.jpg');
  }
}
```

## Responsive Navigation

### Mobile Navigation Patterns

**1. Hamburger Menu**
```
Mobile: Collapsed menu (☰ icon)
Desktop: Full horizontal menu
```

**2. Bottom Tab Bar (Mobile Apps)**
```
Mobile: Fixed tabs at bottom
Desktop: Top or side navigation
```

**3. Priority+ Navigation**
```
Mobile: Show 3-4 most important items, rest in "More"
Desktop: Show all items
```

**Implementation example:**
```css
/* Mobile: Hamburger */
.nav-menu {
  position: fixed;
  top: 0;
  left: -100%;
  width: 80%;
  height: 100vh;
  background: white;
  transition: left 0.3s;
}

.nav-menu.open {
  left: 0;
}

.nav-toggle {
  display: block;
}

/* Desktop: Horizontal */
@media (min-width: 1024px) {
  .nav-menu {
    position: static;
    width: auto;
    height: auto;
    display: flex;
    flex-direction: row;
  }

  .nav-toggle {
    display: none;
  }
}
```

## Responsive Tables

### Pattern 1: Horizontal Scroll

```css
.table-container {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

table {
  min-width: 600px; /* Prevent squishing */
}
```

**Best for:** Tables with many columns, data-heavy tables

### Pattern 2: Card Layout (Stacked)

```css
/* Mobile: Stack as cards */
@media (max-width: 767px) {
  table, thead, tbody, th, td, tr {
    display: block;
  }

  thead {
    display: none; /* Hide headers */
  }

  tr {
    margin-bottom: 1rem;
    border: 1px solid #ddd;
    padding: 0.5rem;
  }

  td {
    display: flex;
    justify-content: space-between;
    padding: 0.5rem;
  }

  td::before {
    content: attr(data-label);
    font-weight: bold;
  }
}
```

**HTML:**
```html
<tr>
  <td data-label="Name">John Doe</td>
  <td data-label="Email">john@example.com</td>
  <td data-label="Role">Admin</td>
</tr>
```

**Best for:** Simple tables, few columns

### Pattern 3: Hide Columns

```css
/* Mobile: Hide less important columns */
@media (max-width: 767px) {
  .hide-mobile {
    display: none;
  }
}
```

**Best for:** Tables where some columns are optional

## Responsive Forms

### Mobile-Optimized Forms

```css
/* Mobile: Full-width inputs, larger touch targets */
input, select, textarea {
  width: 100%;
  font-size: 16px; /* Prevents zoom on iOS */
  padding: 12px;
  min-height: 44px;
}

/* Desktop: Inline labels, side-by-side fields */
@media (min-width: 768px) {
  .form-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }
}
```

### Input Type Best Practices

```html
<!-- Mobile keyboards optimize based on type -->
<input type="email"> <!-- Shows @ and .com -->
<input type="tel">   <!-- Shows number pad -->
<input type="url">   <!-- Shows .com -->
<input type="number" inputmode="numeric"> <!-- Number keyboard -->
<input type="search"> <!-- Shows search/go button -->
```

## Touch Optimization

### Touch Target Sizing

**Minimum sizes:**
- iOS: 44×44px
- Android: 48×48dp
- Recommended: 44-48px minimum

```css
button, a {
  min-width: 44px;
  min-height: 44px;
  padding: 12px 16px;
}
```

### Touch Gestures

**Support common gestures:**
- Tap: Primary interaction
- Swipe: Navigate, delete
- Pinch-to-zoom: Images, maps
- Pull-to-refresh: Lists
- Long-press: Context menu

**Prevent unintended interactions:**
```css
/* Prevent double-tap zoom on buttons */
button {
  touch-action: manipulation;
}

/* Prevent text selection during drag */
.draggable {
  user-select: none;
  -webkit-user-select: none;
}
```

## Performance Optimization

### Critical CSS

**Inline critical above-the-fold CSS:**
```html
<head>
  <style>
    /* Critical CSS for initial render */
    body { margin: 0; font-family: sans-serif; }
    .header { height: 60px; background: #333; }
  </style>

  <!-- Load rest of CSS async -->
  <link rel="preload" href="styles.css" as="style" onload="this.rel='stylesheet'">
</head>
```

### Lazy Loading

**Images:**
```html
<img src="image.jpg" loading="lazy" alt="Description">
```

**Iframes:**
```html
<iframe src="video.html" loading="lazy"></iframe>
```

**JavaScript-based (for older browsers):**
```javascript
const images = document.querySelectorAll('img[data-src]');
const imageObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const img = entry.target;
      img.src = img.dataset.src;
      imageObserver.unobserve(img);
    }
  });
});

images.forEach(img => imageObserver.observe(img));
```

### Mobile Performance

**Best practices:**
- Minimize HTTP requests
- Compress images (WebP, AVIF)
- Use system fonts when possible
- Defer non-critical JavaScript
- Enable gzip/brotli compression
- Use CDN for static assets
- Implement service workers for caching

## Responsive Testing Checklist

### Device Testing

- [ ] iPhone SE (375×667)
- [ ] iPhone 12/13/14 (390×844)
- [ ] iPhone 14 Pro Max (430×932)
- [ ] iPad (810×1080)
- [ ] Android phone (360×640 common)
- [ ] Desktop (1920×1080)
- [ ] Large desktop (2560×1440)

### Browser Testing

- [ ] Chrome (desktop & mobile)
- [ ] Safari (iOS)
- [ ] Firefox
- [ ] Edge
- [ ] Samsung Internet (Android)

### Orientation Testing

- [ ] Portrait orientation
- [ ] Landscape orientation
- [ ] Rotation behavior

### Features to Test

- [ ] Navigation works on mobile
- [ ] Forms are easy to fill on mobile
- [ ] Touch targets are large enough (44px min)
- [ ] Text is readable without zoom (16px min)
- [ ] Images scale properly
- [ ] Tables are accessible
- [ ] Modals/overlays work on mobile
- [ ] No horizontal scrolling (except tables)
- [ ] Content reflows at 320px width
- [ ] Page loads quickly on 3G

## Common Responsive Patterns

### Sidebar to Top

```css
.container {
  display: grid;
  gap: 1rem;
}

/* Mobile: Stack vertically */
@media (max-width: 767px) {
  .container {
    grid-template-columns: 1fr;
  }
}

/* Desktop: Sidebar + main */
@media (min-width: 768px) {
  .container {
    grid-template-columns: 250px 1fr;
  }
}
```

### Column Drop

```css
.grid {
  display: grid;
  gap: 1rem;
}

/* Mobile: 1 column */
.grid {
  grid-template-columns: 1fr;
}

/* Tablet: 2 columns */
@media (min-width: 768px) {
  .grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

/* Desktop: 3 columns */
@media (min-width: 1024px) {
  .grid {
    grid-template-columns: repeat(3, 1fr);
  }
}
```

### Layout Shifter

```css
/* Mobile: Stacked */
.layout {
  display: flex;
  flex-direction: column;
}

/* Desktop: Complex grid */
@media (min-width: 1024px) {
  .layout {
    display: grid;
    grid-template-areas:
      "header header header"
      "sidebar main aside"
      "footer footer footer";
    grid-template-columns: 200px 1fr 200px;
  }
}
```

### Tiny Tweaks

Small adjustments at different breakpoints:
- Increase padding on larger screens
- Adjust font sizes
- Change number of columns
- Hide/show elements
- Adjust spacing

```css
.card {
  padding: 1rem;
  font-size: 14px;
}

@media (min-width: 768px) {
  .card {
    padding: 1.5rem;
    font-size: 16px;
  }
}

@media (min-width: 1024px) {
  .card {
    padding: 2rem;
    font-size: 18px;
  }
}
```

## Dark Mode & Themes

### CSS Custom Properties Approach

```css
:root {
  --bg-primary: #ffffff;
  --text-primary: #000000;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg-primary: #1a1a1a;
    --text-primary: #ffffff;
  }
}

body {
  background-color: var(--bg-primary);
  color: var(--text-primary);
}
```

### JavaScript Toggle

```javascript
// Allow user to override system preference
const toggleDarkMode = () => {
  document.documentElement.classList.toggle('dark-mode');
  localStorage.setItem('theme',
    document.documentElement.classList.contains('dark-mode') ? 'dark' : 'light'
  );
};

// Respect user preference on load
const savedTheme = localStorage.getItem('theme');
if (savedTheme === 'dark' ||
    (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
  document.documentElement.classList.add('dark-mode');
}
```
