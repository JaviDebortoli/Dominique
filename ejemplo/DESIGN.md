---
name: Editorial Realist
colors:
  surface: '#f9f9f9'
  surface-dim: '#dadada'
  surface-bright: '#f9f9f9'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f3f4'
  surface-container: '#eeeeee'
  surface-container-high: '#e8e8e8'
  surface-container-highest: '#e2e2e2'
  on-surface: '#1a1c1c'
  on-surface-variant: '#4c4546'
  inverse-surface: '#2f3131'
  inverse-on-surface: '#f0f1f1'
  outline: '#7e7576'
  outline-variant: '#cfc4c5'
  surface-tint: '#5e5e5e'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#1b1b1b'
  on-primary-container: '#848484'
  inverse-primary: '#c6c6c6'
  secondary: '#6f5a51'
  on-secondary: '#ffffff'
  secondary-container: '#f6dacf'
  on-secondary-container: '#735e55'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#1b1b1b'
  on-tertiary-container: '#848484'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e2e2e2'
  primary-fixed-dim: '#c6c6c6'
  on-primary-fixed: '#1b1b1b'
  on-primary-fixed-variant: '#474747'
  secondary-fixed: '#f9ddd1'
  secondary-fixed-dim: '#dcc1b6'
  on-secondary-fixed: '#271812'
  on-secondary-fixed-variant: '#56433b'
  tertiary-fixed: '#e2e2e2'
  tertiary-fixed-dim: '#c6c6c6'
  on-tertiary-fixed: '#1b1b1b'
  on-tertiary-fixed-variant: '#474747'
  background: '#f9f9f9'
  on-background: '#1a1c1c'
  surface-variant: '#e2e2e2'
  nude-accent: '#EBCFC4'
  muted-gray: '#F5F5F5'
  deep-ink: '#1A1A1A'
typography:
  display-lg:
    fontFamily: Bodoni Moda
    fontSize: 64px
    fontWeight: '700'
    lineHeight: 72px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Bodoni Moda
    fontSize: 40px
    fontWeight: '600'
    lineHeight: 48px
  headline-lg-mobile:
    fontFamily: Bodoni Moda
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 38px
  headline-md:
    fontFamily: Bodoni Moda
    fontSize: 24px
    fontWeight: '500'
    lineHeight: 32px
  body-lg:
    fontFamily: Hanken Grotesk
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Hanken Grotesk
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-caps:
    fontFamily: Hanken Grotesk
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.1em
  price-display:
    fontFamily: Hanken Grotesk
    fontSize: 20px
    fontWeight: '500'
    lineHeight: 24px
spacing:
  unit: 8px
  container-max: 1280px
  gutter: 24px
  margin-mobile: 16px
  section-padding: 80px
---

## Brand & Style

The design system is built on an **Editorial Minimalist** aesthetic, drawing inspiration from high-fashion lookbooks and modern lifestyle magazines. The brand personality is rooted in **Inclusion and Sophistication**, aiming to bridge the gap between premium fashion aesthetics and the "talles reales" (real sizes) movement.

The visual language emphasizes:
- **Generous Whitespace:** Providing products with "room to breathe," moving away from cluttered e-commerce layouts.
- **High Contrast:** A stark black-and-white foundation that feels timeless and authoritative.
- **Soft Accents:** The use of Nude Pink as a functional color to provide a warm, human touch to the high-contrast base.
- **Modern Precision:** Sharp lines and minimal decoration to keep the focus entirely on the garment photography.

## Colors

The palette is intentionally restricted to maintain an upscale magazine feel. 

- **Primary Black (#000000):** Used for primary typography, borders, and structural elements. It conveys authority and elegance.
- **Nude Pink (#EBCFC4):** Reserved exclusively for **intent-driven actions**. It signifies "Active," "Primary CTA," or "New." This color provides a soft, inclusive contrast to the stark black.
- **Pure White (#FFFFFF):** The dominant background color. It serves as the "canvas" for the fashion imagery.
- **Neutral Accents:** Light grays are used sparingly for secondary backgrounds (like product card footers) to maintain depth without breaking the minimalist aesthetic.

## Typography

This design system uses a high-contrast typographic pairing:

- **Serif (Bodoni Moda):** Used for headlines and editorial callouts. Its vertical stress and thin serifs evoke the heritage of Vogue and Harper’s Bazaar.
- **Sans-Serif (Hanken Grotesk):** A clean, modern sans used for all functional text. It ensures maximum readability for sizes, prices, and checkout details.

**Styling Rules:**
- Use **Display-LG** for hero sections with wide tracking.
- Use **Label-Caps** for category badges and small metadata to create a "tag" effect.
- Ensure all body text has ample line height (1.5x minimum) to maintain the "airy" magazine feel.

## Layout & Spacing

The layout follows a **Fixed Grid** philosophy on desktop to mimic the structured columns of a printed magazine.

- **Grid System:** 12-column grid for desktop with wide 24px gutters.
- **Negative Space:** Sections should be separated by large vertical blocks (80px+) to emphasize the premium nature of the brand.
- **Mobile Reflow:** On mobile, move to a single or staggered double-column layout. Product images should remain the focal point, occupying at least 50% of the viewport height.
- **Alignment:** Use asymmetrical layouts for lookbook sections to create visual interest, but maintain strict left-alignment for transactional areas (cart, forms).

## Elevation & Depth

This design system eschews traditional shadows in favor of **Layered Flatness** and **Sharp Borders**.

- **Tonal Layers:** Depth is created through overlapping elements (e.g., a text box slightly overlapping a product image) rather than drop shadows.
- **Thin Outlines:** Use 1px solid black borders to define sections and buttons.
- **No Shadows:** Avoid ambient or blurry shadows. If depth is required, use a solid 2px black "offset" shadow for a more "Pop-Editorial" or "Brutalist-Lite" feel.

## Shapes

The shape language is strictly **Sharp (0px)**. 

Every element—from buttons and input fields to product cards and selection chips—must have 90-degree corners. This reinforces the modern, architectural, and "unfiltered" aesthetic of the brand. Softness is introduced through the photography and the Nude Pink color palette, while the UI framework remains rigid and structural.

## Components

### Buttons
- **Primary (Add to Cart):** Solid Nude Pink (#EBCFC4) background with Black text. Sharp corners. No border.
- **Secondary:** Transparent background with a 1px Black border. Black text.
- **Tertiary:** Underlined text link in Label-Caps style.

### Product Cards
- **Structure:** Large image at the top with a subtle 1:1.5 aspect ratio. 
- **Details:** Product name in Serif (Headline-MD) and price in Sans-Serif. 
- **Hover:** On desktop, the image should slightly zoom or change to a "lookbook" lifestyle shot.

### Input Fields
- **Style:** Minimalist bottom-border only (1px Black). 
- **Focus:** The bottom border thickens to 2px when active. 
- **Labels:** Floating labels using the Sans-Serif Label-Caps style.

### Badges & Chips
- **New/Sale:** Small, sharp-edged rectangles. "New" uses Nude Pink; "Sale" uses Black with White text.
- **Size Selector:** Sharp square boxes. Active state is solid Black with White text.

### Icons
- Use **Ultra-Lightweight line icons** (0.5px or 1px stroke). Icons should be functional and secondary to text labels.

### Local Pick-up Banner
- Since the brand only offers local pickup in Santiago del Estero, a persistent, minimalist top-bar should state "Retiro exclusivo en local físico" in Label-Caps.