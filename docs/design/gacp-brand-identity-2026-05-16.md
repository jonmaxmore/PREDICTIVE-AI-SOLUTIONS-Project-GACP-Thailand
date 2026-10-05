# GACP Brand Identity — Finance & Document System

**Date**: 2026-05-16
**Author**: B22-A (brand designer)
**Scope**: Original visual identity for the 7 financial PDF templates and the `/provider/accounting/*` dashboard, replacing B21-A's FlowAccount-derived tokens.
**Status**: SPEC — for implementation by B22-B. No HTML/TSX/PDF code is modified by this document.

---

## Section 1 — Trade-dress audit of current codebase

B21-A's tokens (2026-05-16, earlier in the day) and B21-B's redesigned PDF templates imitate three signature FlowAccount.com trade-dress elements. Each is documented below with file path and line numbers.

### 1.1 Corner accent triangle (clip-path: polygon(0 0, 100% 0, 100% 100%))

A 70px (60px in print) right-angle triangle in the top-right corner of every document, colored to match the document type and showing the page number in white. This is FlowAccount's most distinctive visual signal and appears unmodified in **all 7 templates**:

| File | CSS rule | Markup |
|------|----------|--------|
| `apps/backend/services/pdf/templates/invoice.html` | line 68-84 | line 394 |
| `apps/backend/services/pdf/templates/quotation.html` | line 48-65 | line 219 |
| `apps/backend/services/pdf/templates/receipt.html` | line 49-66 | line 192 |
| `apps/backend/services/pdf/templates/tax-invoice.html` | line 57-74 | line 198 |
| `apps/backend/services/pdf/templates/credit-note.html` | line 62-79 | line 236 |
| `apps/backend/services/pdf/templates/debit-note.html` | line 59-76 | line 228 |
| `apps/backend/services/pdf/templates/government-revenue-receipt.html` | line 56-73 | line 238 |

The CSS is essentially identical across the 7 files: `position: absolute; top: 0; right: 0; width: 70px; height: 70px; background: var(--accent); clip-path: polygon(0 0, 100% 0, 100% 100%); color: #fff;`.

The tokens file `apps/web-app/src/lib/design/finance-tokens.json` reproduces this for every document type via the `cornerAccent: { size, shape: "right-triangle", background, textColor }` block (lines 65, 85, 106, 128, 150, 170, 191).

This is the single highest-risk trade-dress signal. **Removed.**

### 1.2 Color-per-document-type palette mirroring FlowAccount's brand mapping

FlowAccount's product uses purple for invoices, orange for quotations and green for receipts as a hard brand-distinctive role assignment. B21-A's tokens reproduce that mapping verbatim:

| File line | Document | Color | FlowAccount equivalent |
|-----------|----------|-------|-----------------------|
| `finance-tokens.json:55-65` | INVOICE | `#7E22CE` (purple-700) | matches FlowAccount invoice purple |
| `finance-tokens.json:75-85` | QUOTATION | `#EA580C` (orange-600) | matches FlowAccount quotation orange |
| `finance-tokens.json:95-106` | RECEIPT | `#16A34A` (green-600) | matches FlowAccount receipt green |

In `invoice.html` line 41 the source comment explicitly says `Accent color — Invoice = PURPLE (Tailwind violet-600)` — the per-document hue is the imitation, not the table-of-colors itself.

**Replaced** with a Thai-government / medicinal-plant palette (Section 3).

### 1.3 "FlowAccount-style" attribution in source comments and class naming

The React component layer documents itself as a clone:

| File | Line | Text |
|------|------|------|
| `apps/web-app/src/components/finance/PageToolbar.tsx` | 7 | `PageToolbar — FlowAccount-style sticky top action bar.` |
| `apps/web-app/src/components/finance/SummaryCard.tsx` | 7 | `SummaryCard — FlowAccount-style summary card.` |
| `apps/web-app/src/components/finance/StatusBadge.tsx` | 7 | `StatusBadge — FlowAccount-style rounded pill for status.` |
| `apps/web-app/src/components/finance/FilterBar.tsx` | 7 | `FilterBar — FlowAccount-style inline filter row.` |
| `apps/web-app/src/components/finance/TabNav.tsx` | 7 | `TabNav — FlowAccount-style tab navigation.` |
| `apps/web-app/src/components/finance/DocumentLink.tsx` | 9 | `DocumentLink — FlowAccount-style document number reference.` |
| `apps/web-app/src/components/finance/index.ts` | 2, 6 | `Shared FlowAccount-style finance components` / `FlowAccount-derived design language` |
| `apps/web-app/__tests__/components/finance/status-badge-test.tsx` | 4 | `Smoke tests for the FlowAccount-style <StatusBadge />` |
| `apps/web-app/__tests__/components/finance/data-table-test.tsx` | 4 | `Smoke tests for the FlowAccount-style <DataTable />` |
| `finance-tokens.json:7` | metadata | `"reference": "FlowAccount.com (Thai SME accounting cloud)"` |

These comments are not themselves trade-dress infringement, but they document the design intent in a way that would be highly damaging in any IP dispute. **B22-B must rewrite each comment** to remove the `FlowAccount-style` / `FlowAccount-derived` phrasing (use `GACP finance` or `Thai government finance` instead). This is a text-only swap and is not a behavior change.

### 1.4 Signature block — centered logo pattern

The B21-A spec proposed a centered platform-logo motif between the two signers in the signature block. The current HTML templates do **not** yet contain a centered `.signature-logo` element (the signature block is a clean two-column flex row, e.g. `invoice.html` lines 498-511). So this is **NOT currently in the code**, but the B21-A doc says it is intended.

**Decision**: do not add it. The new identity spec (Section 6.6) explicitly forbids a centered logo motif in the signature block.

### 1.5 Other notes

- Per-document watermark using the accent color (`finance-tokens.json` line 241-248) is generic and is kept.
- Sarabun font (lines 12-13) is open-source SIL OFL and ubiquitous in Thai government documents — not protectable. Kept.
- Items table with right-aligned numeric columns (lines 211-230) is industry standard per ม.86/4 ป.รัษฎากร. Kept.
- A4 portrait layout, two-column customer block, totals on right — all industry-standard for Thai tax invoices. Kept.

---

## Section 2 — Replacement direction (chosen)

**Chosen: Direction 1 — Left-edge vertical stripe**

A 12mm vertical stripe is filled with the document-type accent color and runs floor-to-ceiling along the left page edge. The document type Thai name plus the document number is set in 10px Sarabun, weight 600, letter-spacing 1.5px, rotated -90 degrees, centered vertically along the stripe.

### Why Direction 1 over the alternatives

| Direction | Pro | Con | Verdict |
|-----------|-----|-----|---------|
| 1. Left-edge stripe | Reads as "official Thai report / government memo"; pure CSS; visually distinctive from corner triangle | Demands +8mm of left margin | **CHOSEN** |
| 2. Top header band | Simple, works in print | Visually similar to many SaaS templates including FreshBooks and Xero; consumes scarce vertical space on already long Thai tax invoices | Rejected |
| 3. Typographic chip | Lowest IP risk | Loses peripheral color-cueing — color-blind farmers benefit from the at-a-glance stripe even without reading the title | Rejected as primary; **kept as supplementary** (see Section 6.3, the chip system is layered on top of the stripe inside the title row) |
| 4. Alternative | n/a | n/a | n/a |

The chosen direction fits the platform context: this is a Thai government certification platform serving farmers and DTAM (กรมการแพทย์แผนไทยและการแพทย์ทางเลือก). The left-edge stripe is the visual idiom of Thai civil-service memo paper (บันทึก ราชการ format), which sets a more appropriate authority tone than the SaaS-style corner triangle and is structurally different from FlowAccount's signature element.

The chip system from Direction 3 is layered on top: each title row still shows a small tinted pill (`.doc-chip`) inline with the title so the document type is also stated typographically, giving color-blind users a redundant signal (WCAG 1.4.1 conformance).

### Visual signal hierarchy

```
[Left edge stripe ----------- vertical, 12mm wide, runs full page]
   12mm  |     Issuer header (logo + Thai legal name + tax id + address)
         |     Title row:  "ใบกำกับภาษีเต็มรูป" 24pt + [chip: TAX INVOICE]
         |     Meta box (เลขที่ / วันที่ / ครบกำหนด)  right-aligned
         |     Customer block
         |     Items table (soft-fill header, not solid)
         |     Totals (right, underline + tint, not solid pill)
         |     Amount in words (left-border accent)
         |     Signature row (two columns, plain horizontal line, NO center logo)
         |     Footer
```

---

## Section 3 — New color palette

Each color has been chosen for one of three reasons: (a) literal subject matter of the platform (medicinal plants = green), (b) Thai government / DTAM authority visual vocabulary (indigo + gold), or (c) functional pairing (debit/credit as cool/warm). None of the per-document hues replicate the FlowAccount role-to-color mapping (purple invoice / orange quotation / green receipt).

| Document | Thai name | Accent | Soft (≈10% tint) | Border (≈30%) | Text on fill | AA against white | Rationale |
|----------|-----------|--------|------------------|---------------|--------------|------------------|-----------|
| Invoice / Billing Note | ใบวางบิล/ใบแจ้งหนี้ | `#15803D` green-700 | `#F0FDF4` | `#86EFAC` | `#FFFFFF` | 5.69:1 PASS | Forest green = GACP literal subject (medicinal plants) |
| Quotation | ใบเสนอราคา | `#B45309` amber-700 | `#FFFBEB` | `#FCD34D` | `#FFFFFF` | 4.82:1 PASS | Warm earth — preliminary, welcoming. Different hue + role from FlowAccount orange |
| Receipt (platform) | ใบเสร็จรับเงิน | `#0F766E` teal-700 | `#F0FDFA` | `#5EEAD4` | `#FFFFFF` | 5.01:1 PASS | Settled, finalized; ties back to GACP's existing teal UI primary |
| Tax Invoice (full) | ใบกำกับภาษีเต็มรูป | `#475569` slate-600 | `#F8FAFC` | `#CBD5E1` | `#FFFFFF` | 7.45:1 PASS AAA | Formal, austere — VAT artefact for Revenue Department |
| Credit Note | ใบลดหนี้ | `#9F1239` rose-700 | `#FFF1F2` | `#FDA4AF` | `#FFFFFF` | 7.34:1 PASS AAA | Reduction; deeper rose communicates careful adjustment, not error |
| Debit Note | ใบเพิ่มหนี้ | `#1E3A8A` blue-900 | `#EFF6FF` | `#93C5FD` | `#FFFFFF` | 11.95:1 PASS AAA | Addition; cool/warm pair with credit-note rose |
| Government Revenue Receipt | ใบเสร็จเงินรายได้แผ่นดิน | `#3730A3` indigo-800 + `#B45309` amber-700 gold accent | `#EEF2FF` | `#A5B4FC` | `#FCD34D` amber-300 | 7.83:1 PASS AAA | Royal indigo + Thai-traditional gold — DTAM is a สังกัด of กระทรวงสาธารณสุข, the indigo+gold pairing is the Thai civil-service formal scheme |

Contrast values verified against the WCAG 2.1 formula (relative luminance, ratio threshold 4.5:1 AA Normal / 7:1 AAA / 3:1 AA Large).

### Accessibility fallback

Every document also shows its type as **plain text in the title row** (e.g. "ใบกำกับภาษีเต็มรูป") **and** in the inline chip. Color-blind users and grayscale-printed copies retain the document-type signal via the typographic layer; the stripe color is supplementary, not load-bearing.

---

## Section 4 — Typography

Carried over from B21-A unchanged (typography is industry-standard and is not subject to trade-dress protection):

- **Display family**: Sarabun (SIL OFL), with `Noto Sans Thai` and Tahoma as fallbacks.
- **Loaded weights**: 300, 400, 500, 600, 700, 800.
- **Scale**: title 22px / 700, chip 11px / 600 (new), label 11px / 700, body 13px / 400, bodyMono 12.5px / 400 tabular nums, footer 10.5px / 400 muted, stripeLabel 10px / 600 / letter-spacing 1.5px (new).

The only change from B21-A is the addition of two purpose-built scale entries (`chip` and `stripeLabel`) and a reduction of the title weight from 800 to 700 to feel less promotional and more report-like.

---

## Section 5 — Layout grid

A4 portrait. Margins adjust to host the left-edge stripe:

| Edge | B21-A | New |
|------|-------|-----|
| Top | 20mm | 20mm |
| Right | 18mm | 16mm (recovered 2mm from removed corner triangle) |
| Bottom | 20mm | 20mm |
| Left | 18mm | 26mm (12mm stripe + 14mm content gutter) |
| Print override | 14mm 12mm | 16mm 12mm 16mm 22mm |

Twelve-column 6mm-gutter grid kept.

---

## Section 6 — Component patterns

### 6.1 Identity stripe (new)

```
.identity-stripe {
  position: absolute;
  top: 0;
  left: 0;
  width: 12mm;
  height: 100%;
  background: var(--accent);
  z-index: 0;
}
.identity-stripe__label {
  position: absolute;
  left: 0;
  top: 65mm;
  width: 12mm;
  text-align: center;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 1.5px;
  color: var(--text-on-fill);
  transform: rotate(-90deg);
  transform-origin: center;
  white-space: nowrap;
}
```

Inside this stripe label, B22-B emits `{{DOC_TYPE_TH}} | {{DOC_NUMBER}}` (e.g. "ใบกำกับภาษีเต็มรูป | TX-2026-000123"). For DTAM Government Revenue Receipts, the text-on-fill is amber-300 gold instead of white.

### 6.2 Issuer header (top-left, beside the stripe)

Unchanged structure: logo 56×56, legal name (h1), Tax ID, address, ministry contact. The Garuda data URL `{{GARUDA_DATA_URL}}` is the issuer logo for DTAM documents; the platform logo is `{{PLATFORM_LOGO_DATA_URL}}` for PLATFORM-issued documents. No corner triangle is rendered — the issuer block extends further right since right-margin reclaim 2mm.

### 6.3 Document title row with chip

```
<div class="title-row">
  <div class="doc-title-block">
    <h2 class="doc-title">{{DOC_TYPE_TH}}</h2>
    <span class="doc-chip">{{DOC_CHIP_LABEL}}</span>
    <div class="doc-subtitle">ต้นฉบับ / ORIGINAL</div>
    <div class="doc-title-en">{{DOC_TYPE_EN}}</div>
  </div>
  <div class="meta-box">...</div>
</div>
```

```
.doc-chip {
  display: inline-block;
  vertical-align: middle;
  margin-left: 10px;
  padding: 3px 10px;
  border-radius: 8px;
  background: var(--accent-soft);
  color: var(--accent);
  border: 1px solid var(--accent-border);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.4px;
}
```

8px corner radius — explicitly **not** the 9999px pill that FlowAccount uses for its chips.

### 6.4 Items table

Header row uses the **soft fill** of the accent color (`--accent-soft`) with **same-hue accent text** and a 2px bottom border in the full accent color. This is visually different from B21-A's solid-fill reversed-text header (which mirrored FlowAccount's table head style).

```
.items-table thead th {
  background: var(--accent-soft);
  color: var(--accent);
  border-bottom: 2px solid var(--accent);
  font-weight: 700;
  font-size: 11px;
  padding: 10px 8px;
  text-align: left;
}
```

Row stripes use slate-50 not the per-doc tint, to keep the body readable across all 7 doc types.

### 6.5 Totals block

Underline + soft tint instead of solid fill:

```
.totals-table tr.grand td {
  border-top: 2px solid var(--accent);
  border-bottom: 1px solid var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 800;
  font-size: 14px;
  padding: 10px 12px;
}
```

### 6.6 Signature block — NO centered logo

Two-column flex row, plain horizontal divider line under each signer. **No center-element decoration of any kind** — no platform logo, no Garuda seal, no leaf glyph between the signers. This is a deliberate negative space.

```
<div class="signature-block">
  <div class="signer">
    <div class="line"></div>
    <div class="role">ผู้ขาย / Seller</div>
    <div class="name">{{ISSUER_NAME_TH}}</div>
  </div>
  <div class="signer">
    <div class="line"></div>
    <div class="role">ผู้รับ / Receiver</div>
    <div class="name">{{PAYER_NAME}}</div>
  </div>
</div>
```

For DTAM Government Revenue Receipts, an additional **third signer column** is added for the cashier (เจ้าหน้าที่การเงิน) — still no central decoration between the columns.

### 6.7 Footer

Single-line slate-500, 10.5px, with `เอกสารนี้ออกโดยระบบ GACP Online · เอกสารเลขที่ {{DOC_NUMBER}} ออก ณ วันที่ {{ISSUE_DATE}}`. No icon, no logo, no decoration — keep it functional.

---

## Section 7 — Implementation contract (for B22-B)

B22-B must apply the spec mechanically per these rules. No part of this contract requires reading FlowAccount source or imitating any FlowAccount visual.

### 7.1 CSS variables required in each template's `:root`

```
:root {
  --accent:           [from documentTypes[docType].accent.hex];
  --accent-soft:      [from documentTypes[docType].accentSoft.hex];
  --accent-border:    [from documentTypes[docType].accentBorder.hex];
  --text-on-fill:     [from documentTypes[docType].textOnFill.hex];

  --text-primary:     #0F172A;
  --text-secondary:   #1E293B;
  --text-muted:       #475569;
  --text-soft:        #64748B;
  --border:           #E2E8F0;
  --border-strong:    #CBD5E1;
  --surface:          #FFFFFF;
  --surface-alt:      #F8FAFC;

  --stripe-width:     12mm;
}
```

### 7.2 CSS classes removed

- `.corner-accent`

### 7.3 CSS classes added

- `.identity-stripe` (vertical left-edge color band)
- `.identity-stripe__label` (rotated -90° doc-type + number)
- `.doc-chip` (inline 8px-radius tinted pill in the title row)
- `.issuer-leaf` (optional outline-leaf glyph in the issuer header; not load-bearing)

### 7.4 Markup changes per template

1. Replace `<div class="corner-accent">1</div>` with:
   ```
   <div class="identity-stripe" aria-hidden="true"></div>
   <div class="identity-stripe__label">{{DOC_TYPE_TH}} | {{DOC_NUMBER}}</div>
   ```
2. Add `<span class="doc-chip">{{DOC_CHIP_LABEL}}</span>` inside `.doc-title-block` after the `.doc-title` element. The chip label comes from `documentTypes[docType].chipLabel`.
3. Update `body { padding: 20mm 16mm 20mm 26mm; }` to make room for the stripe. Print override `@media print { body { padding: 16mm 12mm 16mm 22mm; } }`.
4. Update `.items-table thead th` rules per Section 6.4.
5. Update `.totals-table tr.grand td` per Section 6.5.
6. Ensure no centered logo or seal is added between signers (Section 6.6).
7. Rewrite the file-header comment block to remove the phrase `FlowAccount-grade redesign` / `FlowAccount visual cue` / similar references. Replace with `GACP Brand Identity 2.0 (B22-A, 2026-05-16)`.

### 7.5 React component comment cleanup

Replace `FlowAccount-style` / `FlowAccount-derived` in the JSDoc and comments of the seven files listed in Section 1.3 with `GACP finance` or `Thai government finance`. The component behavior does not change.

### 7.6 Acceptance criteria for B22-B's PRs

- No `.corner-accent` class, no `clip-path: polygon(0 0, 100% 0, 100% 100%)`, no `FlowAccount-style` / `FlowAccount-derived` text remain in any file under `apps/`.
- All 7 templates render the left-edge stripe and the inline chip.
- All 7 templates pass `playwright` visual diff against the baseline screenshots that B22-A will provide alongside this doc.
- The Single Issuer Compliance (Batch 17) logic — `resolveIssuerForTemplate`, DTAM vs PLATFORM split — is **unchanged**. This work is visual only.

---

## Section 8 — Legal posture (designer's notes, not legal advice)

The new design is *unlikely* to constitute trade-dress infringement of FlowAccount.com for the following reasons. This is a designer's risk-management view; **formal legal review remains required before customer-facing rollout**.

1. **Different signature visual element.** FlowAccount's distinctive top-right diagonal triangle is the single most recognizable element of their template. It is removed entirely. The left-edge vertical stripe is a generic editorial / civil-service device used widely in Thai government publications and is not associated with FlowAccount.

2. **Different per-document color mapping.** Trade dress in product packaging and document design generally protects the *combination* of color + element + role. FlowAccount's combination is purple-invoice / orange-quote / green-receipt with a top-right colored triangle. The GACP combination is forest-green-invoice / amber-quote / teal-receipt / slate-tax-invoice / rose-credit-note / navy-debit-note / indigo+gold-government-receipt with a left-edge stripe. Both the role-to-color mapping and the geometric carrier are different.

3. **No centered-logo signature motif.** The signature block is deliberately bare in the center — a negative-space choice that breaks from FlowAccount's centered-logo pattern.

4. **Generic layout elements are not protected.** Issuer header at top, items table with right-aligned numeric columns, totals block on the right, amount-in-words line, two-signer row at the bottom — all of these are **mandated or industry-standard** for Thai accounting documents under ม.86, ม.86/4, ม.86/9, ม.86/10, ม.105 ประมวลรัษฎากร. The Revenue Department's e-Tax Invoice / e-Receipt specifications further constrain layout. These elements are functional, not protectable trade dress.

5. **Sarabun typography is open-source.** Used industry-wide in Thai government documents under SIL OFL.

6. **Tabler Icons** are MIT-licensed.

**Disclaimer**: This document is the work of a brand designer removing obvious trade-dress lookalikes. It is **not legal advice**. Before customer-facing rollout, please obtain a written opinion from Thai IP counsel familiar with Trade Mark Act B.E. 2534 (1991) section 80 (unfair competition / passing-off) and the Unfair Trade Competition Act B.E. 2542 (1999). Counsel should review side-by-side screenshots of FlowAccount.com templates vs the GACP redesign produced by B22-B.

---

## File boundaries respected

- No HTML template modified.
- No `.tsx` / `.js` / `.ts` source modified.
- No Prisma schema touched.
- `docs/design/finance-design-system-2026-05-16.md` (B21-A) left in place — this file supersedes it but does not delete it; the audit trail is preserved.
- Only the canonical `apps/web-app/src/lib/design/finance-tokens.json` has been replaced (per the user's explicit permission).
- This document (`gacp-brand-identity-2026-05-16.md`) is new.

End of spec.
