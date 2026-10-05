/** @type {import('tailwindcss').Config} */
module.exports = {
  // Class strategy (NOT the default 'media'): dark styles apply only when the
  // `.dark` class is on <html>, which ThemeScript controls (defaults to light,
  // never auto-follows the OS). Without this, `dark:` utilities responded to
  // `@media (prefers-color-scheme: dark)` independently of ThemeScript, so a
  // dark-mode OS forced the public site dark while the class-based CSS vars +
  // fixed-colour auth pages stayed light — a broken half-dark render.
  darkMode: 'class',
  content: [
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/lib/**/*.{js,ts,jsx,tsx,mdx}',
    './src/contexts/**/*.{js,ts,jsx,tsx,mdx}',
    './src/hooks/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        // X1-FIX-B (H-5): static `primary-{50..900}` ramp anchored on the
        // platform brand primary HSL(153 100% 20%) ≈ #006633 (deep forest
        // green per `docs/design/gacp-brand-identity-2026-05-16.md`). Until
        // this fix, `bg-primary-50`, `bg-primary-600`, `from-primary-700`,
        // `shadow-primary-500/40` etc. referenced by HEALTH renewal and
        // success-step pages resolved to nothing in production CSS — a
        // silent visual bug. The 500 weight matches `--primary`; 600/700
        // are deeper (hover/active); 50–400 are tints for soft fills and
        // backgrounds. `DEFAULT` and `foreground` continue to map to the
        // CSS variables so theme-aware components stay reactive.
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
          50: '#e6f5ec',
          100: '#cdebd9',
          200: '#9bd7b3',
          300: '#6ac38d',
          400: '#38af67',
          500: '#006633',
          600: '#005c2e',
          700: '#004d27',
          800: '#003d1f',
          900: '#002e17',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        success: 'hsl(var(--success))',
        warning: 'hsl(var(--warning))',
        info: 'hsl(var(--info))',
        // Friendly UI layer (GACP Thailand Design System ui_kit, 2026-06-08).
        // Fresh-green action + soft mint surfaces used by the redesign
        // primitives. Deep forest `primary` (above) stays for text/depth/links;
        // `leaf` is the action green. Mirrors src/styles/globals.css :root.
        leaf: {
          // W3-B contrast contract: DEFAULT (2.64:1) and 600 (3.57:1) fail
          // WCAG AA with white text — decorative fills/icons/borders only.
          // Text-bearing solid buttons use 700 (5.0:1), hover/pressed 800
          // (7.3:1), disabled 300 (contrast-exempt state). `soft` carries
          // leaf-700 text at 4.6:1.
          DEFAULT: '#34b56a',
          300: '#8ed4ab',
          600: '#229b54',
          700: '#18803f',
          800: '#146333',
          // `soft` and `onSoft` read from CSS variables so they carry a value in
          // BOTH themes — see the surface note in globals.css. The channel form
          // keeps the opacity modifier alive (`bg-leaf-soft/50`, used 21 times).
          soft: 'rgb(var(--leaf-soft) / <alpha-value>)',
          onSoft: 'rgb(var(--leaf-on-soft) / <alpha-value>)',
        },
        // Officer accent (UI-01 login redesign, 2026-08-05) — teal counterpart
        // to `leaf` for the "สำหรับเจ้าหน้าที่" door. Same contrast contract:
        // 700 = text-bearing solid bg (7.3:1 white), 800 = hover/pressed,
        // soft = tint surface (6.3:1 under 700 text). See globals.css :root.
        officer: {
          700: '#0F5F6B',
          800: '#0C4A54',
          soft: 'rgb(var(--officer-soft) / <alpha-value>)',
          onSoft: 'rgb(var(--officer-on-soft) / <alpha-value>)',
        },
        // Caution tint for a required gap (missing slot card). Both themes —
        // see globals.css; stock amber-50 has no dark value.
        caution: {
          soft: 'rgb(var(--caution-soft) / <alpha-value>)',
          edge: 'rgb(var(--caution-edge) / <alpha-value>)',
        },
        lime: {
          DEFAULT: '#cdeb6e',
          soft: 'rgb(var(--lime-soft) / <alpha-value>)',
        },
        mint: {
          bg: 'rgb(var(--mint-bg) / <alpha-value>)',
          soft: 'rgb(var(--mint-soft) / <alpha-value>)',
        },
        avatar: 'rgb(var(--avatar-bg) / <alpha-value>)',
        brand: {
          50: '#eef8f2',
          100: '#d9f0e2',
          200: '#b5e1c6',
          300: '#86cc9f',
          400: '#4bad72',
          500: '#2c9057',
          600: '#1f7345',
          700: '#1c5b39',
          800: '#194830',
          900: '#153c29',
        },
        // Phase A5 §4.3 — gov-* named tokens for the cluster of hex values
        // that were previously used as Tailwind arbitrary values (`bg-[#0b1f3a]`)
        // across Footer, GovLayout prototype, planting page, and document
        // print components. By centralising them here, the
        // `gacp/no-raw-color` ESLint rule can be flipped to `error` (step 8)
        // without losing the design intent.
        gov: {
          navy: '#0b1f3a',         // Footer + header bar — primary dark navy
          'navy-deep': '#091529',  // Hover/active state of navy
          blue: {
            600: '#1d4ed8',        // Body link blue (gov.uk-style)
            700: '#1e40af',        // Hover/active body link
            800: '#1e3a8a',        // Footer logo accent + emphasis
          },
          accent: '#f5a623',       // Gold accent (used by document seal/badge)
          beige: '#f5efe6',        // Document/cert paper bg
          'auth-deep': '#004d2a',  // Provider auth page deep green
          'auth-blue': '#00427A',  // Renewal payment step blue
          green: '#006633',        // DTAM กองกัญชาทางการแพทย์ letterhead green (mirrors quotation.html)
        },
        // ── LEGACY Mantine palette ──
        // Mantine v7 default colors, exposed as Tailwind named tokens so
        // `bg-mantine-green-5`, `text-mantine-teal-9`, `from-mantine-teal-4`
        // etc. work in className. Used by ~14 components that pre-date the
        // Tailwind-only refactor. DO NOT add new references — migrate to
        // Tailwind palette (slate/red/green/blue) or project tokens.
        // See `apps/web-app/src/lib/legacy-mantine-colors.ts` for the JS
        // constants companion. Removal: Wave F per
        // `docs/architecture/2026-05-04-css-architecture-audit.md`.
        mantine: {
          gray:   { 0:'#f8f9fa', 1:'#f1f3f5', 2:'#e9ecef', 3:'#dee2e6', 4:'#ced4da', 5:'#adb5bd', 6:'#868e96', 7:'#495057', 8:'#343a40', 9:'#212529' },
          red:    { 0:'#fff5f5', 1:'#ffe3e3', 2:'#ffc9c9', 3:'#ffa8a8', 4:'#ff8787', 5:'#ff6b6b', 6:'#fa5252', 7:'#f03e3e', 8:'#e03131', 9:'#c92a2a' },
          green:  { 0:'#ebfbee', 1:'#d3f9d8', 2:'#b2f2bb', 3:'#8ce99a', 4:'#69db7c', 5:'#51cf66', 6:'#40c057', 7:'#37b24d', 8:'#2f9e44', 9:'#2b8a3e' },
          blue:   { 0:'#e7f5ff', 1:'#d0ebff', 2:'#a5d8ff', 3:'#74c0fc', 4:'#4dabf7', 5:'#339af0', 6:'#228be6', 7:'#1c7ed6', 8:'#1971c2', 9:'#1864ab' },
          teal:   { 0:'#e6fcf5', 1:'#c3fae8', 2:'#96f2d7', 3:'#63e6be', 4:'#38d9a9', 5:'#20c997', 6:'#12b886', 7:'#0ca678', 8:'#099268', 9:'#087f5b' },
          yellow: { 0:'#fff9db', 1:'#fff3bf', 2:'#ffec99', 3:'#ffe066', 4:'#ffd43b', 5:'#fcc419', 6:'#fab005', 7:'#f59f00', 8:'#f08c00', 9:'#e67700' },
          orange: { 0:'#fff4e6', 1:'#ffe8cc', 2:'#ffd8a8', 3:'#ffc078', 4:'#ffa94d', 5:'#ff922b', 6:'#fd7e14', 7:'#f76707', 8:'#e8590c', 9:'#d9480f' },
          indigo: { 0:'#edf2ff', 1:'#dbe4ff', 2:'#bac8ff', 3:'#91a7ff', 4:'#748ffc', 5:'#5c7cfa', 6:'#4c6ef5', 7:'#4263eb', 8:'#3b5bdb', 9:'#364fc7' },
          violet: { 0:'#f3f0ff' },
          grape:  { 2:'#eebefa' },
        },
      },
      // X1-FIX-B (H-6): formalise font-family utilities so `font-sans`,
      // `font-sarabun`, `font-prompt`, and `font-display` are real Tailwind
      // classes (previously `font-prompt` was a no-op — body font came
      // from globals.css). Sarabun is now the default (`font-sans`) per
      // the brand spec (`docs/design/gacp-brand-identity-2026-05-16.md`
      // §4) — Sarabun is the SIL OFL Thai government standard. Prompt is
      // retained as a fallback family for any component that still wants
      // the previous typeface. Both fonts are self-hosted via @fontsource
      // imports in `app/layout.tsx`, so no network fetch occurs at runtime
      // or during tests.
      // ── Thai-first tracking scale (2026-09-07) ──
      // Tailwind ships `tracking-tight` at -0.025em and `tracking-tighter` at
      // -0.05em. Both are Latin display idioms, and on Thai they pull สระ and
      // วรรณยุกต์ toward the neighbouring glyph — the rule this project already
      // wrote at globals.css:12 and enforces for two stylesheets in
      // src/styles/__tests__/thai-text-keeps-its-marks.test.ts. That test cannot
      // see a utility class, and these two are used at 24 sites across 20 files,
      // almost all of them on Thai headings. Neutralising them here fixes every
      // site at once and leaves the class names in place, so nothing breaks and
      // no sweep is needed. `tracking-wide`/`wider` are untouched: they are used
      // on Latin eyebrows and uppercase labels where they are correct.
      letterSpacing: {
        tighter: '0em',
        tight: '0em',
      },
      fontFamily: {
        // Design-system update (2026-06-04): Sukhumvit Set is the brand face;
        // Sarabun / Noto Sans Thai remain fallbacks. `sarabun` stays an explicit
        // Sarabun alias for any component that deliberately wants it.
        sans: ['Sukhumvit Set', 'Sarabun', 'Noto Sans Thai', 'Prompt', 'Tahoma', 'system-ui', 'sans-serif'],
        sarabun: ['Sarabun', 'Noto Sans Thai', 'Tahoma', 'system-ui', 'sans-serif'],
        prompt: ['Prompt', 'Sarabun', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'Sukhumvit Set', 'Sarabun', 'Prompt', 'sans-serif'],
      },
      boxShadow: {
        soft: '0 8px 24px -12px rgba(15, 23, 42, 0.24)',
        card: '0 16px 44px -20px rgba(15,23,42,0.22)',
        // Friendly UI layer (ui_kit) — green-tinted action + surface shadows.
        'leaf-btn': '0 8px 18px -8px rgba(52,181,106,0.6)',
        'leaf-card': '0 12px 32px -20px rgba(20,60,35,0.18)',
        'leaf-card-hover': '0 22px 50px -24px rgba(20,60,35,0.28)',
        // Officer accent (UI-01) — teal-tinted button glow, mirrors leaf-btn.
        'officer-btn': '0 8px 18px -8px rgba(15,95,107,0.55)',
      },
      borderRadius: {
        lg: 'var(--radius)',
      },
    },
  },
  // The accessibility statement is authored against @tailwindcss/typography —
  // it uses `prose prose-slate` for the document body and `not-prose` (an API
  // that exists only in this plugin) to opt three blocks back out. The plugin
  // was never registered, so every `prose` class was inert and the page
  // rendered as one run-on block: no paragraph spacing, headings ๑.–๗.
  // indistinguishable from body text, and the measure unconstrained at 1440px
  // (visual-QA sweep, 2026-07-26).
  plugins: [require('@tailwindcss/typography')],
};

