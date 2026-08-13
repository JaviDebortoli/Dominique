import type { Config } from "tailwindcss";

// Brand tokens sourced from ejemplo/DESIGN.md ("Editorial Realist" /
// Editorial Minimalist design system). Loaded into Tailwind v4's CSS-first
// theme via `@config` in src/app/globals.css.
//
// Key rules from DESIGN.md:
// - Shapes are strictly Sharp (0px) — every element gets 90-degree corners.
// - Thin 1px solid black outlines define sections/buttons (no shadows).
// - Nude Pink (#EBCFC4) is reserved exclusively for intent-driven CTAs
//   ("Add to Cart", primary/active state) — never a general-purpose color.
const config: Config = {
  theme: {
    extend: {
      colors: {
        // Prose "Colors" section — the four functional brand colors.
        ink: "#000000", // Primary Black: typography, borders, structure
        nude: "#EBCFC4", // Nude Pink: CTA-only, "Active"/"Primary"/"New"
        paper: "#FFFFFF", // Pure White: dominant background/canvas
        // Frontmatter `colors` — supporting neutrals/utility tones used
        // across secondary surfaces, text, and system states.
        surface: "#F9F9F9",
        "surface-dim": "#DADADA",
        "surface-container": "#EEEEEE",
        "on-surface": "#1A1C1C",
        "on-surface-variant": "#4C4546",
        outline: "#7E7576",
        "outline-variant": "#CFC4C5",
        "muted-gray": "#F5F5F5",
        "deep-ink": "#1A1A1A",
        error: "#BA1A1A",
      },
      fontFamily: {
        serif: ["var(--font-serif)"], // Bodoni Moda — headlines/editorial
        sans: ["var(--font-sans)"], // Hanken Grotesk — body/functional text
      },
      fontSize: {
        // Named type scale from DESIGN.md frontmatter `typography`.
        "display-lg": [
          "64px",
          { lineHeight: "72px", letterSpacing: "-0.02em", fontWeight: "700" },
        ],
        "headline-lg": ["40px", { lineHeight: "48px", fontWeight: "600" }],
        "headline-lg-mobile": [
          "32px",
          { lineHeight: "38px", fontWeight: "600" },
        ],
        "headline-md": ["24px", { lineHeight: "32px", fontWeight: "500" }],
        "body-lg": ["18px", { lineHeight: "28px", fontWeight: "400" }],
        "body-md": ["16px", { lineHeight: "24px", fontWeight: "400" }],
        "label-caps": [
          "12px",
          { lineHeight: "16px", letterSpacing: "0.1em", fontWeight: "600" },
        ],
        "price-display": ["20px", { lineHeight: "24px", fontWeight: "500" }],
      },
      borderRadius: {
        none: "0px",
        DEFAULT: "0px",
        sm: "0px",
        md: "0px",
        lg: "0px",
        xl: "0px",
        "2xl": "0px",
        "3xl": "0px",
      },
      borderWidth: {
        DEFAULT: "1px",
      },
      spacing: {
        unit: "8px",
        gutter: "24px",
        "margin-mobile": "16px",
        section: "80px",
      },
      maxWidth: {
        container: "1280px",
      },
    },
  },
};

export default config;
