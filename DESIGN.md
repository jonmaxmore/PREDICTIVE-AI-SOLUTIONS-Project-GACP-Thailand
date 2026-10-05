---
name: GACP Certification Platform
description: The official Thai government register for GACP herbal certification — clean, accountable, accessible.
colors:
  forest-green: "#006633"
  forest-green-pressed: "#004d27"
  forest-mist: "#e6f5ec"
  civil-service-gold: "#c0a359"
  government-navy: "#0b1f3a"
  government-navy-deep: "#091529"
  service-link-blue: "#1d4ed8"
  seal-gold: "#f5a623"
  paper-white: "#f4f6f5"
  card-white: "#ffffff"
  ink: "#0e1b14"
  muted-sage: "#4f6459"
  hairline: "#d4ddd9"
  surface-alt: "#f8fafc"
  approved-green: "#29a36c"
  pending-amber: "#f59f0a"
  rejected-red: "#dc2828"
  info-blue: "#1a80e6"
typography:
  display:
    fontFamily: "Sarabun, 'Noto Sans Thai', Prompt, Tahoma, system-ui, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "normal"
  headline:
    fontFamily: "Sarabun, 'Noto Sans Thai', Prompt, Tahoma, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "normal"
  title:
    fontFamily: "Sarabun, 'Noto Sans Thai', Prompt, Tahoma, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "normal"
  body:
    fontFamily: "Sarabun, 'Noto Sans Thai', Prompt, Tahoma, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  label:
    fontFamily: "Sarabun, 'Noto Sans Thai', Prompt, Tahoma, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "normal"
rounded:
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.5rem"
spacing:
  xs: "0.5rem"
  sm: "0.75rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "2rem"
components:
  button-primary:
    backgroundColor: "{colors.forest-green}"
    textColor: "{colors.card-white}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0.625rem 1.25rem"
  button-primary-hover:
    backgroundColor: "{colors.forest-green-pressed}"
    textColor: "{colors.card-white}"
  button-secondary:
    backgroundColor: "{colors.card-white}"
    textColor: "{colors.forest-green}"
    rounded: "{rounded.md}"
    padding: "0.625rem 1.25rem"
  card:
    backgroundColor: "{colors.card-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "1.5rem"
  input:
    backgroundColor: "{colors.card-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0.625rem 0.875rem"
  badge-approved:
    backgroundColor: "{colors.forest-mist}"
    textColor: "{colors.forest-green-pressed}"
    rounded: "{rounded.sm}"
    padding: "0.125rem 0.625rem"
---

# Design System: GACP Certification Platform

## 1. Overview

**Creative North Star: "The Official Green Register"**

This is the digital counter of a Thai government certification authority, not a
product launch. Three ideas hold it together. *Official* — it issues legally
valid GACP certificates under ISO/IEC 17065, so it must carry the calm
authority of a public register: a system of record, not a marketing surface.
*Green* — the literal subject is Thai medicinal herbs, and the platform's
deep forest green (`#006633`) is the one saturated voice on an otherwise quiet
page. *Register* — the interface exists to make a long, multi-hand process
(apply → pay → review → schedule → audit → approve → issue) legible to a farmer
on a cheap phone and to the officer reviewing them. Clarity is the entire job.

The density is generous and unhurried. Surfaces are flat white on a barely
green-tinted paper field, separated by hairline borders and the softest of
ambient shadows — never by competing colors or boxes-inside-boxes. Type is one
family, Sarabun, the SIL OFL face used across the Thai civil service; weight and
size carry the whole hierarchy. The aim is gov.uk's plain-spoken legibility and
the credibility of the ทางรัฐ / ThaID apps: a citizen should feel the system is
legitimate and on their side, and an officer should feel it is rigorous and
accountable.

What this system explicitly rejects: the generic AI/SaaS dashboard look
(purple-blue gradients, glassmorphism, hero-metric tiles, grids of identical
cards); the cluttered legacy Thai government page (cramped, tiny type, no
hierarchy); and the dark fintech/crypto aesthetic (neon-on-black, dark-by-default,
flashy motion). None of those carry the right trust signal for a public herbal
certification authority.

**Key Characteristics:**
- One saturated voice (forest green), everything else quiet neutral.
- One typeface (Sarabun), hierarchy by weight and size, never by decoration.
- Flat surfaces, hairline separation, motion only to convey state.
- Every status is shown by color *and* by text/icon — never color alone.
- Designed for the worst device and the least confident user first.

## 2. Colors

A restrained palette: one forest-green primary, a single Thai civil-service gold
accent, government navy for structure, and a quiet green-tinted neutral set.
Color is rationed so that when it appears, it means something.

### Primary
- **Deep Forest Green** (`#006633`, HSL 153 100% 20%): The platform's single
  brand voice — the literal color of the medicinal plants it certifies and the
  DTAM authority green. Used for primary buttons, active states, focus rings,
  links inside the app shell, and the certified-status signal. Pressed/hover
  deepens to **Deep Forest (Pressed)** (`#004d27`). **Forest Mist** (`#e6f5ec`)
  is the soft fill behind approved badges and selected rows.

### Secondary
- **Civil-Service Gold** (`#c0a359`, HSL 43 45% 55%): The Thai-traditional gold
  of formal government documents. A sparing accent for seals, certificate
  ornaments, and emphasis on official artifacts — never a second button color.

### Tertiary
- **Government Navy** (`#0b1f3a`): The header and footer authority bar; the
  structural dark that frames the app. Deepens to `#091529` on hover/active.
- **Service Link Blue** (`#1d4ed8`): gov.uk-style body-link blue for
  long-form/footer links, distinct from the in-app forest-green actions.
- **Seal Gold** (`#f5a623`): The brighter document seal/badge gold, reserved for
  certificate and document artifacts.

### Neutral
- **Ink** (`#0e1b14`, HSL 150 30% 8%): Primary text. A green-black, not a true
  black, so it sits in the same family as the brand.
- **Muted Sage** (`#4f6459`, HSL 150 12% 35%): Secondary text, captions, helper
  copy. Holds 4.5:1 on white.
- **Paper White** (`#f4f6f5`, HSL 150 12% 96%): The page field — a barely
  green-tinted off-white, *not* a cream or sand.
- **Card White** (`#ffffff`): Every raised surface and input.
- **Hairline** (`#d4ddd9`, HSL 150 12% 85%): Borders, dividers, table rules.
- **Surface Alt** (`#f8fafc`): Zebra rows and muted document surfaces (the slate
  neutral carried over from the finance/PDF system).

### Semantic (status)
- **Approved Green** (`#29a36c`), **Pending Amber** (`#f59f0a`), **Rejected Red**
  (`#dc2828`), **Info Blue** (`#1a80e6`): The workflow status vocabulary —
  draft, submitted, reviewing, approved, rejected, expired — each rendered as a
  tinted badge with same-hue text *and* a word.

### Named Rules
**The One Voice Rule.** Forest green is the only saturated color on a working
screen, and it covers ≤10% of it. If two colors are competing for attention,
one of them is wrong. Gold is for official artifacts, never for a second button.

**The No-Cream Rule.** The background is Paper White (`#f4f6f5`), a cool
green-tinted near-white. It is forbidden to drift toward cream, sand, or beige
(`#f5efe6` is a *document-paper* color only, never an app background).

## 3. Typography

**Display Font:** Sarabun (with Noto Sans Thai, Prompt, Tahoma, system-ui)
**Body Font:** Sarabun (same family — one voice)
**Label/Mono Font:** Sarabun; tabular figures for numeric columns

**Character:** Sarabun is the SIL OFL typeface adopted as the Thai government
standard — open, even, and unmistakably civil-service. It renders Thai glyph
clusters cleanly and pairs them with restrained Latin. One family does the whole
job; hierarchy comes from weight (400 → 800) and size, never from a second
display face. Weights load 300–800.

### Hierarchy
- **Display** (700, 2.25rem, line-height 1.2): Page titles and the single H1 per
  view. Never a marketing-scale hero.
- **Headline** (700, 1.5rem, line-height 1.3): Section headers, card titles.
- **Title** (600, 1.25rem, line-height 1.4): Sub-sections, dialog titles.
- **Body** (400, 1rem, line-height 1.6): All running text. Hold prose to a
  65–75ch measure; never let a paragraph run the full width of a wide screen.
- **Label** (600, 0.8125rem, line-height 1.4): Form labels, table headers,
  chips, status badges.

### Named Rules
**The No-Tracking-On-Thai Rule.** Never apply positive letter-spacing to Thai
text — it breaks vowel and tone-mark positioning (sara/วรรณยุกต์) and reads as
broken to a Thai user. Tracking is permitted only on short uppercase Latin
labels, and even there kept minimal. This overrides any generic "add letter-
spacing to headings" instinct.

**The Weight-Not-Face Rule.** Hierarchy is built from Sarabun's weights and
sizes alone. Introducing a second display or "premium" font is prohibited — it
reads as SaaS marketing, not public service.

## 4. Elevation

The system is flat by default with the softest ambient shadows. Surfaces rest on
the page separated by Hairline borders; a shadow is a quiet response to
elevation (a card, a popover), not a permanent decoration. Depth is conveyed by
tonal layering (Paper White field → Card White surface) far more than by shadow.

### Shadow Vocabulary
- **Soft** (`box-shadow: 0 8px 24px -12px rgba(15,23,42,0.24)`): The default
  raised surface — cards, panels at rest.
- **Card** (`box-shadow: 0 16px 44px -20px rgba(15,23,42,0.22)`): Higher
  elevation — popovers, dialogs, the hover state of an interactive card.
- **Hairline ring** (`0 0 0 1px rgba(0,0,0,0.03)` paired with the above): The
  near-invisible edge that keeps white-on-white surfaces from dissolving.

### Named Rules
**The Flat-By-Default Rule.** Surfaces are flat at rest. A shadow appears only as
a response to state — elevation, hover, focus — and lifts at most 2px. If a card
has a heavy drop shadow while sitting still, the shadow is wrong.

**The No-Glass Rule.** Glassmorphism is forbidden: no `backdrop-filter: blur()`,
no translucent frosted panels, no glow. (The legacy `.glass-card` / `.glass-panel`
utilities are slop to be removed, not a pattern to extend.) Opaque surfaces only.

## 5. Components

### Buttons
- **Shape:** Gently rounded (0.75rem / 12px radius, the `--radius` default).
- **Primary:** Deep Forest Green fill (`#006633`), Card White text, Label
  typography, padding `0.625rem 1.25rem`. The single high-emphasis action per
  view. Label is verb + object ("ส่งใบสมัคร" / "Submit application"), never bare
  "Submit" or "OK".
- **Hover / Focus:** Background deepens to `#004d27`; press scales to 0.97
  (`.btn-press`, 100ms ease-out). Focus shows a 2px Forest Green outline at 2px
  offset (`:focus-visible`), never removed.
- **Secondary / Ghost:** Card White (or transparent) background, Forest Green
  text, Hairline border. Exactly one primary button per view; everything else is
  secondary or ghost.

### Cards / Containers
- **Corner Style:** 0.75rem (12px); larger panels 1rem (16px).
- **Background:** Card White on the Paper White field.
- **Shadow Strategy:** Flat at rest (Hairline border only) or the **Soft** shadow;
  the **Card** shadow on hover with at most a 2px lift (`.card-hover`).
- **Border:** 1px Hairline (`#d4ddd9`).
- **Internal Padding:** 1.5rem (md cards).
- **Forbidden:** a card inside a card. Nested card surfaces are always wrong —
  use spacing and a hairline, not a second box.

### Inputs / Fields
- **Style:** Card White background, 1px Hairline border, 0.75rem radius
  (enforced globally on inputs/selects/textareas), padding `0.625rem 0.875rem`.
- **Focus:** 2px Forest Green ring (`--ring`) at 2px offset; border shifts to
  Forest Green. Transition 150ms.
- **Error / Disabled:** Error border + helper text in Rejected Red with an icon
  and a plain-Thai recovery message; disabled drops to Muted Sage on Surface Alt.
- Labels are always visible (never placeholder-only) — a low-digital-literacy
  and accessibility requirement.

### Navigation
- **Style:** Government Navy (`#0b1f3a`) top bar / sidebar; Card White content.
  Active item carries a Forest Green indicator and a weight bump, not a colored
  background stripe. Default → hover → active states are explicit.
- **Mobile:** Collapses to a single-column drawer; tap targets ≥44px; works
  without hover.

### Status Badge (signature component)
- The workflow's legibility depends on this. Each application state renders as a
  tinted pill with same-hue text **and** the status word: draft (Muted/Sage),
  submitted (Info Blue tint), reviewing (Pending Amber tint), approved (Approved
  Green tint), rejected (Rejected Red tint), expired (gray). 8px radius — a
  tinted chip, never a saturated 9999px pill. Color is always backed by the word.

## 6. Do's and Don'ts

### Do:
- **Do** keep Forest Green (`#006633`) as the single saturated voice, ≤10% of any
  screen (The One Voice Rule).
- **Do** build all hierarchy from Sarabun's weight and size — one family only.
- **Do** keep surfaces flat at rest; reserve the Soft/Card shadows for elevation
  and hover, lifting at most 2px.
- **Do** pair every status color with a word and/or icon (WCAG 1.4.1) — the
  workflow must be readable in grayscale and to color-blind users.
- **Do** design the mobile, slow-connection, low-literacy path first: visible
  labels, ≥44px targets, plain Thai, recoverable errors.
- **Do** honor `prefers-reduced-motion`; keep product motion to 150–250ms and
  only to convey state.
- **Do** hold body prose to a 65–75ch measure.

### Don't:
- **Don't** use glassmorphism — no `backdrop-filter: blur()`, no frosted
  translucent panels, no glow. (Explicit PRODUCT.md anti-reference; the legacy
  `.glass-card`/`.glass-panel` utilities are slop to delete.)
- **Don't** reach for the generic AI/SaaS dashboard look: purple-blue gradients,
  gradient text, hero-metric tiles, or grids of identical cards (PRODUCT.md
  anti-reference, verbatim).
- **Don't** let the background drift to cream, sand, or beige; the app field is
  cool Paper White `#f4f6f5` (The No-Cream Rule). `#f5efe6` is document paper only.
- **Don't** nest a card inside a card, or separate content with a colored
  side-stripe border thicker than 1px (the 3px `.card-accent-left` is a slop
  pattern to retire).
- **Don't** add positive letter-spacing to Thai text — it breaks the script.
- **Don't** introduce a second/"premium"/display font, or the dead Mantine
  legacy palette (`mantine-*` tokens are frozen and must not gain new uses).
- **Don't** ship the cluttered-legacy-gov look (cramped, tiny type, no hierarchy)
  or the dark fintech/crypto look (neon-on-black, dark-by-default, flashy motion)
  — both are PRODUCT.md anti-references.
- **Don't** run infinite decorative animation (pulsing badges, perpetual
  shimmer) on a working screen; motion must start, convey state, and stop.
