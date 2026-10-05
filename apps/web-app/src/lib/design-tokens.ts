/**
 * Design Tokens - GACP Platform
 * Shared color palette and design constants
 * Exact match to Mobile App for consistency
 *
 * ️ LEGACY — DO NOT EXPAND.
 *
 * The canonical design system for new web-app code is the Tailwind theme
 * (`tailwind.config.cjs`) backed by CSS variables in `:root` / `.dark`
 * (see `apps/web-app/src/styles/globals.css`). New code should use
 * Tailwind utility classes (`bg-primary`, `text-foreground`, …) or
 * `hsl(var(--token))` directly.
 *
 * This file remains because `components/feature/system-guard.tsx` still
 * uses inline `style={{ backgroundColor: colors.background }}` on the
 * "server down" screen — a runtime-rendered fallback that runs even when
 * Tailwind hasn't hydrated. Once that screen is migrated, this file can
 * be removed.
 *
 * The previous `apps/web-app/src/styles/design-system.ts` (an orphan
 * parallel definition with no consumers) was deleted on 2026-05-04
 * (Wave A3 in `docs/architecture/2026-05-04-css-architecture-audit.md`).
 */

// Primary Colors - GACP Thai Green Theme
export const colors = {
    // Primary
    primary: "#1B5E20",
    primaryLight: "#1B5E2014",
    primaryDark: "#0D3A12",

    // Backgrounds
    background: "#F5F7FA",
    card: "#FFFFFF",
    inputBg: "#FFFFFF",

    // Text
    text: "#1B5E20",
    textDark: "#1E293B",
    textGray: "#64748B",
    textLight: "#94A3B8",

    // Borders & Dividers
    border: "#E0E0E0",
    borderLight: "#F0F0F0",

    // Status Colors
    success: "#22C55E",
    successBg: "#F0FDF4",
    warning: "#F59E0B",
    warningBg: "#FFFBEB",
    warningLight: "#FEF3C7",
    error: "#EF4444",
    errorBg: "#FEF2F2",
    danger: "#DC2626",
    dangerBg: "#FEE2E2",
    white: "#FFFFFF",
    info: "#3B82F6",
    infoBg: "#E8F5E9",

    // Document Colors
    accent: "#2E7D32",
    secondary: "#4CAF50",

};

// Typography
export const typography = {
    fontFamily: {
        primary: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        thai: "'Sarabun', 'Noto Sans Thai', sans-serif",
    },
    fontSize: {
        xs: "12px",
        sm: "14px",
        base: "16px",
        lg: "18px",
        xl: "20px",
        "2xl": "24px",
        "3xl": "30px",
    },
};

// Spacing
export const spacing = {
    xs: "4px",
    sm: "8px",
    md: "16px",
    lg: "24px",
    xl: "32px",
    "2xl": "48px",
};

// Border Radius
export const borderRadius = {
    sm: "4px",
    md: "8px",
    lg: "12px",
    xl: "16px",
    full: "9999px",
};

// Shadows (Liquid Glass Effect)
export const shadows = {
    sm: "0 1px 2px rgba(0, 0, 0, 0.05)",
    md: "0 4px 6px rgba(0, 0, 0, 0.1)",
    lg: "0 10px 15px rgba(0, 0, 0, 0.1)",
    xl: "0 20px 25px rgba(0, 0, 0, 0.15)",
    glass: "0 8px 32px rgba(27, 94, 32, 0.15)",
};

// Default export for convenience
const designTokens = {
    colors,
    typography,
    spacing,
    borderRadius,
    shadows,
};

export default designTokens;
