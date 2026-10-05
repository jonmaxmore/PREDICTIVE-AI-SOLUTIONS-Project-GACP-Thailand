# Document + Template Audit — GACP Platform

- **Reviewer:** Project team
- **Date:** 2026-04-28
- **Mode:** Read-only research

## Executive Summary

The platform has a **single dominant template engine** (Puppeteer + HTML/CSS with `{{KEY}}` placeholder substitution via `pdf-generator.service.js`) that drives certificates, invoices, receipts, tax invoices, quotations, application summaries, and lot labels.

**Top 3 strengths:**
1. HTML+Puppeteer is the right choice for Thai government documents — Sarabun font support, A4 print fidelity, real `qrcode` library generating green-on-white QRs at error-correction-level H, ministry colour palette codified at #1a5c38 / #4ade80.
2. Certificate number format is now keyed off `crypto.randomBytes(3)` with uniqueness retry (PR-1.5), QR points to `/verify/{certNumber}` correctly.
3. Invoice/tax-invoice flow is properly normalized — `split-payment-calculator` builds line items, `numberToThaiText()` prints amounts in Thai words.

**Top 5 gaps:**
1. **Two parallel PDF generators co-exist** — modern `pdf-generator.service.js` (Puppeteer/HTML) + legacy `pdf-service.js` (PDFKit, no Thai font registered, address still hard-coded "Tiwanon Road, Nonthaburi").
2. **Audit & CAR reports import a non-existent module** — `require('./PdfGenerator.service')` (capital P) which does NOT match the file `pdf-generator.service.js` on case-sensitive Linux production.
3. **Certificate template has a placeholder typo** — `{{Applicant_NAME}}` will never be substituted because the service supplies `APPLICANT_NAME`, leaving the literal string on the cert.
4. **Document-slot ID drift across 4 layers** — backend `license_pt09`, frontend wizard `LICENSE_PT11`+`LICENSE_PT9`, plant-selection `M1_PT09`, provider config has both aliases.
5. **Branding inconsistency** — three "official" titles in flight; receipt contact line is literally `"อีเมล contact@gacpthai.com  อีเมล contact@gacpthai.com"` (label "อีเมล" repeated, no phone).

**Single biggest "this doesn't look like an official government document" issue:** The receipt and `gacpthai-document-layout.tsx` ministry contact line is literally `"อีเมล contact@gacpthai.com  อีเมล contact@gacpthai.com"`. For a ministry-issued tax document, this is jarring and would not survive an internal audit by RD (Revenue Department). Same defect lives in `DEFAULT_PARENT === DEFAULT_DEPT` in the React layout.

## 1. Certificate generation

**Where:** `apps/backend/services/certificate-service.js` orchestrates DB record creation; the actual PDF is rendered via `apps/backend/services/pdf/certificate-template-service.js` which loads `templates/certificate.html` and feeds it to `pdf-generator.service.js` (Puppeteer headless).

**PDF library:** Puppeteer 'new' headless mode, `printBackground: true`, A4 landscape with 8mm margins. Fonts pulled via `@import url('https://fonts.googleapis.com/css2?family=Sarabun...')` — **problem in air-gapped or strict-CSP gov environments**: certificate generation depends on outbound HTTPS to fonts.googleapis.com at render time. The single garuda image is base64-inlined (good), but the font isn't.

**Template:** External HTML at `apps/backend/services/pdf/templates/certificate.html`. Bilingual (Thai + English on every label), A4 landscape, double border (#1a5c38 outer, #4ade80 inner), corner brackets, watermark `GACP` at 4% opacity, details table, QR + circular stamp + signature block.

**Localization:** Thai-primary, English subtitle on every line. Date is `formatThaiDate()` with full Buddhist year. Good.

**Branding:** Header reads "กรมการแพทย์แผนไทยและการแพทย์ทางเลือก / Department of Thai Traditional and Alternative Medicine, Ministry of Public Health". Two garuda images in header. Signature block hard-codes "อธิบดีกรมการแพทย์แผนไทยและการแพทย์ทางเลือก" — director-general — but the signed-by field on the DB record is `issuedBy: providerId || 'SYSTEM'`. Acceptable for ministry-issued certs.

**QR placement:** Bottom-left of footer, 72×72 with 1px border, `errorCorrectionLevel: 'H'`. QR data URL is `cert.qrData` (set to `https://dtam.moph.go.th/verify/${certNumber}` in `certificate-service.js:191`) — but `certificate-template-service.js:64` falls back to `https://gacp.dtam.moph.go.th/verify/${certificateNumber}`. **These two domains disagree.**

**Cert number format:** `GACP-TH-{Buddhist year}-{6-char hex}` e.g. `GACP-TH-2569-A3F7B2`. Readable, secure. Good.

**Bug 1.A (P0):** Line 339 of `certificate.html`: `<p class="Applicant-name">{{Applicant_NAME}}</p>`. Service injects key `APPLICANT_NAME`. The placeholder regex in `pdf-generator.service.js:76` is case-sensitive lookup. **Result: every issued certificate prints the literal string `{{Applicant_NAME}}` where the applicant's name should be. P0 blocker.**

**Bug 1.B (medium):** QR fallback URL inconsistency — `certificate-service.js:191` writes `https://dtam.moph.go.th/...`; `certificate-template-service.js:64` fallback is `https://gacp.dtam.moph.go.th/...`. Pick one.

**Concrete next steps:**
- Fix `{{Applicant_NAME}}` → `{{APPLICANT_NAME}}` in `certificate.html`.
- Add snapshot test that renders certificate.html and asserts no `{{...}}` literals survive.
- Move font to self-hosted woff2 (`shared/fonts/Sarabun-*.woff2`) and inline as base64.
- Centralise verify URL in `apps/backend/shared/constants.js` → `VERIFY_BASE_URL`.

## 2. Receipt + invoice generation

**Engine:** `apps/backend/services/pdf/invoice-template-service.js` exports `generateInvoicePdf`, `generateReceiptPdf`, `generateTaxInvoicePdf`, `generateQuotationPdf`. All four use HTML templates + Puppeteer.

**Phase 1 (5,000 THB):** Generated when invoice is created with `serviceType: PHASE_1_STATE_FEE | APPLICATION_FEE | PHASE_1_PLATFORM_FEE`. Receipt is generated when `invoice.status === 'paid'` and `receiptNumber` is set.

**Phase 2 (25,000 THB):** Same flow with `PHASE_2_STATE_FEE | AUDIT_FEE | PHASE2_AUDIT | PHASE_2_PLATFORM_FEE`.

**Both PDFs:** Yes. Email attachments — needs verification.

**Tax invoice format (RD compliance):** `tax-invoice.html` separates gov fee (VAT-exempt) from service fee + VAT in distinct line items. Has tax-id field (`PAYER_TAX_ID`), VAT amount column, total in Thai words. **Missing for full RD/RIA compliance:** seller tax ID + branch number, "ต้นฉบับ / สำเนา" copy designation, sequential running number per fiscal year.

**VAT line items:** Correctly shows `vatExempt` flag for gov fees with label `"(VAT Exempt)"`.

**Bug 2.A (medium):** `receipt.html` line 250 — `<p>อีเมล contact@gacpthai.com &nbsp;|&nbsp; อีเมล contact@gacpthai.com</p>` — same label twice. Should be "โทร: 0-2xxx-xxxx | อีเมล: contact@…". Frontend layout `gacpthai-document-layout.tsx:55` has same defect.

**Bug 2.B (low):** `receipt.html` lines 357-358 — signature block prints "ระบบรับรองมาตรฐาน GACP สมุนไพร" twice.

**Concrete next steps:**
- Fix duplicate-email contact line. Single shared constants file with `MINISTRY_CONTACT_PHONE`, `MINISTRY_CONTACT_EMAIL`.
- Confirm tax-invoice format with RD ปอ.86 checklist.
- Add e2e test that renders all four document types and lints output for `{{`, duplicate strings, missing critical fields.

## 3. Audit report template

**Where:** `apps/backend/services/pdf/audit-report-service.js` and `car-report-service.js`. Both use **inline HTML template literals** rather than external `templates/*.html` files — different pattern.

**Format:** PDF via `pdfGenerator.generatePDF(htmlContent, {...})` — but the require is broken (see below). Output saved to `apps/backend/services/storage/reports/` directory and `storage/reports/car/`.

**Findings/CAR rendering:** `audit-report-service.js` groups responses by category, prints PASS/FAIL/N/A badges, score by category in a table, signature block. Includes emoji (`📂 ${category}`, `✅ ผ่าน`, `❌ ไม่ผ่าน`, `📍 ลงพื้นที่`) — **questionable for an official government report**.

**Bug 3.A (P0, cross-platform):** Both `audit-report-service.js:5` and `car-report-service.js:6` do `require('./PdfGenerator.service')` (capital P). Actual file is `pdf-generator.service.js` (lowercase, hyphen). Windows is case-insensitive so dev passes; **Linux production will throw `Cannot find module './PdfGenerator.service'`** the first time an audit/CAR report is requested.

**Bug 3.B (medium):** Audit report stores PDFs to `path.join(__dirname, '../../storage/reports')` — local filesystem, NOT MinIO. Bypasses `storage-service.js` entirely. In multi-instance deploy these PDFs are inaccessible from peer pods.

**Bug 3.C (low):** Inline HTML template duplicates 60% of CSS that already lives in `pdf/styles/common.css`.

**Concrete next steps:**
- Fix the capital-P require in audit-report-service.js, car-report-service.js (and any tests).
- Move audit/CAR PDFs to MinIO via storage-service.
- Extract inline HTML to `templates/audit-report.html` and `templates/car-report.html`.
- Replace emoji status icons with proper SVG glyphs or color blocks.

## 4. Wizard form file-upload slots

**Backend registry:** `apps/backend/constants/document-slots.js` — central, comprehensive (~30 slots), conditional rules via `requiredFor`, helper functions `getRequiredDocuments()` / `getObjectiveWarnings()` / `canProceedWithObjectives()`. Strong design.

**Frontend mirror:** `apps/web-app/src/app/health/applications/new-legacy/steps/documents-step-config.tsx` defines its OWN list inline (~30 slots) with different IDs and a different conditional schema (`conditionalFor: { purposes, cultivationMethods, landOwnership }` — note `purposes` not `objectives`).

**Drift inventory (P1 finding):**

| Layer | License PT11 ID | License PT9 ID |
|---|---|---|
| Backend `document-slots.js` | `license_pt11` (lowercase) | `license_pt09` |
| Frontend wizard `documents-step-config.tsx` | `LICENSE_PT11` | `LICENSE_PT9` (no zero) |
| Plant-selection `plant-selection-config.ts` | `M1_PT11` | `M1_PT09` |
| Provider config `provider-application-detail-config.ts` | `LICENSE_PT11` | both `LICENSE_PT9` AND `LICENSE_PT09` (alias) |
| Preview helpers `preview-page-helpers.ts` | `LICENSE_PT11` | `LICENSE_PT9` |
| Print config `print-page-config.ts` | `LICENSE_PT11` | `LICENSE_PT9` |

The PR-#8 "canonicalisation" did not in fact converge — provider config has aliases (both `LICENSE_PT9` and `LICENSE_PT09`).

**Slot metadata:** Backend has `required`, `conditionalRequired`, `requiredFor`, `warningText`, `externalUrl`, `status: 'STUB'`, `deprecated`, `autoGenerated`, `category`. Frontend has `required`, `type`, `category`, `conditionalBehavior`, `conditionalFor`. **Schema mismatch.**

**Upload UX:** `<input type=file>` with `apiClient` upload, 20MB limit, MIME whitelist. Resume on partial upload — not visible.

**Concrete next steps:**
- Single source of truth: move `DOCUMENT_SLOTS` to `packages/shared/document-slots.ts` with shared TS types.
- Slot ID canonical form: pick one — recommend `LICENSE_PT09` (uppercase, two-digit). Migrate DB records.
- Add unit test that enumerates frontend IDs and asserts every one resolves to a backend slot.

## 5. Document storage + retrieval

**Service:** `apps/backend/services/storage-service.js`. Buckets: `gacp-uploads`, `gacp-certificates`, `gacp-pdfs`.

**Per-tenant prefix:** None visible. Multi-tenant isolation is at DB row level, not bucket prefix.

**Encryption at rest:** Not configured in `storage-service.js`. Relies on MinIO server config (out of band).

**Signed URL TTL:** `expiresIn = 3600` (1 hour) default. No renewal endpoint visible.

**Direct browser upload vs server-mediated:** Server-mediated. `multer` disk storage to `BASE_UPLOAD_DIR`, then mirrored to MinIO. For 20MB files this doubles bandwidth.

**Bug 5.A (low):** `storage-service.js:200` fallback when MinIO is unreachable returns local path — no signing — public access. OK for local dev, dangerous if accidentally toggled in prod.

**Concrete next steps:**
- Add per-tenant key prefix.
- Document SSE expectations in deploy/minio config.
- Consider presigned PUT for files > 5MB.

## 6. Document templates for OFFICIAL submissions

**Frontend pages:** `apps/web-app/src/app/health/export-documents/` and `health/official-documents/`.

**ภ.ท.10 export permit:** Marked `status: 'STUB'` in backend with `externalUrl: 'https://herbctrl.dtam.moph.go.th'`. Platform does NOT generate ภ.ท.10 — upload pass-through with warning. **Right call** — duplicating that permit issuance would cross departmental authority boundaries.

**Compliance reports (ภท.27-32):** Per `document-slots.js` comment "อยู่ใน routes/api/report-submissions.js" — submission flows, not generated docs.

## 7. Form layout consistency

**Wizard step layouts:** Each step file imports `ApplicationNavigation` and `SectionHeader` from shared layout — header/body/footer structure consistent.

**Field grouping:** Cards/sections used. `documents-step-config.tsx` exports `CATEGORY_LABELS` with icons + colors for 9 categories — strong foundation.

**Print view of filled-in form:** Yes. `provider/applications/[id]/print/print-page-config.ts` and `application-template-service.js` PDF — full summary with watermark="DRAFT" if applicable. Strong.

## 8. Download flows

**Download my certificate:** `GET /api/certificates/:id/download` (authenticated, ownership-checked). Returns `application/pdf` with `Content-Disposition: attachment`. **Filename uses internal cuid `id`, NOT the certificate number.** Users get `GACP-Certificate-clxxx0a01...pdf` instead of `GACP-Certificate-GACP-TH-2569-A3F7B2.pdf`.

**Download receipt / invoice:** Verify via `official-documents/client-view.tsx`. Likely `GET /api/invoices/:id/pdf`.

**Download my submitted form (PDF of application):** `application-template-service.js` produces this.

**Bulk download:** Not visible — no zip endpoint found. For provider reviewing 50 applications, productivity issue. Acceptable for v1, plan for v2.

**Concrete next steps:**
- Filename: use `cert.certificateNumber` for download, e.g. `GACP-TH-2569-A3F7B2.pdf`.
- Add provider-side bulk-zip endpoint via `archiver`.

## 9. Versioning + integrity

**Documents change after upload — versioned?** Not visible. Same key = overwrite. No `versions/{n}/` history.

**Signed PDF (PAdES / digital signature for tamper-evidence):** None. The certificate PDF is plain (no embedded signer cert, no LTV). For a ministry-issued cert intended to survive 3 years and be presented to overseas buyers, this is a meaningful gap.

**E-signature service exists:** ~~`apps/backend/services/esign-service.js`~~ — *(file removed in subsequent cleanup PR; was unwired feature with zero callers; if PAdES signing is added later it will be a fresh implementation, not based on this orphan)*. The original service stored **applicant-side signatures** as base64 PNG, which was not a PDF signature anyway.

**Hash of uploaded file:** Not stored.

**Concrete next steps:**
- Add `versionNumber` to document records, append-only.
- Phase B: integrate `node-signpdf` or call out to a Thai CA (CAT/TOT) to sign the certificate PDF with PAdES-B-LT.
- Store SHA-256 of every uploaded file at ingest.

## 10. Standards alignment

**Thai government document standards (ETDA):** Not aligned. No PAdES signing, no eMRTD-style tamper protection, no e-Tax signing. Cert is a pretty HTML→PDF.

**Tax invoice (RD ปอ.86):** Partially. Has Thai tax ID field, VAT-exempt designation, Thai-text amount. Missing seller tax ID/branch in template, no "ต้นฉบับ/สำเนา" copy stamp, running number scheme not validated.

**ISO/Codex/UN GACP:** Cert says "GACP Thailand" with `standardId: 'GACP-TH'`. WHO publishes "WHO guidelines on good agricultural and collection practices (GACP) for medicinal plants" (2003). Certificate doesn't reference underlying standard version or revision.

## Prioritized Roadmap

### Phase A — fix bugs that already broke (1 sprint, ~200 LOC)
1. **`{{Applicant_NAME}}` → `{{APPLICANT_NAME}}`** in `certificate.html:339`. **1 line, prevents every issued cert from looking broken.**
2. **Capital-P `require` fix** in `audit-report-service.js:5` and `car-report-service.js:6`. **2 lines, prevents Linux production crash.**
3. **Duplicate "อีเมล" contact line** in receipt.html, gacpthai-document-layout.tsx, tax-invoice.html, quotation.html, invoice.html.
4. **Filename uses cuid, not cert number** — `certificates.js:212`.
5. **QR verify URL inconsistency** — pick one constant.
6. **DEFAULT_PARENT === DEFAULT_DEPT** in `gacpthai-document-layout.tsx:53`.
7. **Move audit + CAR storage to MinIO**.
8. **Add render-time guard:** in `pdf-generator.service.js:replaceTemplateVariables` after substitution, scan for surviving `{{...}}` and warn.

Files touched: ~7. LOC: ~200.

### Phase B — converge templates and slot IDs (2-3 sprints, ~600 LOC)
9. **Single source of truth for document slots** — extract to `packages/shared/document-slots.ts`.
10. **Move audit/CAR inline HTML to `templates/*.html`**.
11. **Self-host Sarabun font** — removes outbound dependency on fonts.googleapis.com.
12. **Replace emoji icons** in audit reports with proper SVG glyphs.
13. **Per-tenant bucket prefix** in storage-service.

Files touched: ~15. LOC: ~600.

### Phase C — government-grade integrity (1-2 quarters, ~1500 LOC)
14. **PAdES-B-LT signing** of issued cert PDFs.
15. **RD ปอ.86 tax-invoice compliance**.
16. **Document versioning** — `versionNumber` column, append-only.
17. **File-hash at ingest** — SHA-256.
18. **Bulk-download zip endpoint** for providers.

Files touched: ~25. LOC: ~1500.

## Explicit non-recommendations

- **Do NOT switch to LaTeX, Typst, or PrinceXML.** Puppeteer/HTML is the right stack.
- **Do NOT introduce a templating language like Handlebars/Liquid.** The `{{KEY}}` placeholder + `_HTML` suffix raw-insertion is sufficient and auditable.
- **Do NOT consolidate `pdf-service.js` (PDFKit) and `pdf-generator.service.js` (Puppeteer) prematurely.** Verify call-sites first.
- **Do NOT migrate to a server-side React PDF library (`@react-pdf/renderer`).** Doesn't support Thai font shaping well.
- **Do NOT add per-cert customisation knobs.** Templates should be ministry-issued and homogeneous.

## Total LOC + files touched estimate

| Phase | Files | LOC | Effort |
|---|---|---|---|
| A — fix what's broken | ~7 | ~200 | 1 sprint |
| B — converge | ~15 | ~600 | 2-3 sprints |
| C — gov-grade | ~25 | ~1500 | 1-2 quarters |
