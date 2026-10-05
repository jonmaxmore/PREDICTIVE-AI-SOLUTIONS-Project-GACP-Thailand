# GACP Certificate — B23 Sample (2026-05-16)

This document captures the rendered shape of the rewritten GACP certificate
PDF after the B23 redesign. The template lives at
`apps/backend/services/pdf/templates/certificate.html` and is driven by
`apps/backend/services/pdf/certificate-template-service.js`.

## At-a-glance change log

| Aspect             | Pre-B23 (landscape)           | B23 (current)                                   |
| ------------------ | ----------------------------- | ----------------------------------------------- |
| Orientation        | A4 landscape (297×210mm)      | A4 PORTRAIT (210×297mm)                         |
| Palette            | GACP green (#1a5c38)          | DTAM indigo #3730A3 + Thai gold #B45309         |
| Border             | Double-rule + corner brackets | Indigo + gold inset frame (no corner triangles) |
| Cert number scheme | `GACP-TH-{พศ}-{hex6}` only    | `GACP-DTAM-{พศ}-{hex6}` display + Thai-numeral mirror |
| Signer             | Hardcoded title only          | Configurable `{{SIGNER_NAME}}` + `{{SIGNER_POSITION}}` |
| QR + verify URL    | QR only                       | QR + visible verify URL footer                  |
| ID privacy         | (none — column wasn't shown)  | Masked national ID (`1-2345-XXXXX-67-8`)        |
| DTAM ministry line | In header only                | Header + bottom-of-page footer (both ends)      |

## Sample render with real data

Using sample data:
```
APPLICANT_NAME    = สมชาย ใจดี
APPLICANT_ID      = 1234567890123  →  masked to 1-2345-XXXXX-12-3
CULTIVATION       = กัญชา / Cannabis sativa L.
FARM (location)   = หมู่ 1 ตำบลรอบเวียง อำเภอเมือง จังหวัดเชียงราย
ISSUE_DATE        = 2026-05-16  →  ๑๖ พฤษภาคม พุทธศักราช ๒๕๖๙
EXPIRY_DATE       = 2027-05-16  →  ๑๖ พฤษภาคม พุทธศักราช ๒๕๗๐
CERT_NUMBER       = GACP-DTAM-2569-A3F7B2  (Thai: GACP-DTAM-๒๕๖๙-A๓F๗B๒)
SIGNER            = อธิบดีกรมการแพทย์แผนไทยและการแพทย์ทางเลือก (default)
VERIFY_URL        = https://gacp.dtam.moph.go.th/verify/GACP-TH-2569-A3F7B2
```

ASCII mock-up of the rendered A4 portrait page:

```
+----------------------------------------------------------------+
| [outer indigo frame, 2.5px, inset 12mm]                        |
|  +-----------------------------------------------------------+ |
|  | [inner gold frame, 0.8px, inset 15mm]                     | |
|  |                                                           | |
|  |  [Garuda]  กรมการแพทย์แผนไทยและการแพทย์ทางเลือก  [   ]    | |
|  |            Department of Thai Traditional and AM         | |
|  |            กระทรวงสาธารณสุข · Ministry of Public Health  | |
|  | ────────────────────────────────────────────────────────  | |
|  |                                                           | |
|  |                                                           | |
|  |            ใบรับรองมาตรฐาน GACP                            | |
|  |        GACP CERTIFICATE · GOOD AGRICULTURAL ...           | |
|  |                                                           | |
|  |              เลขที่ใบรับรอง / Certificate No.              | |
|  |          [ GACP-DTAM-2569-A3F7B2 ] (gold chip)            | |
|  |              (GACP-DTAM-๒๕๖๙-A๓F๗B๒)                       | |
|  |                                                           | |
|  |   กรมการแพทย์แผนไทยและการแพทย์ทางเลือก ขอรับรองว่า          | |
|  |                                                           | |
|  |                  สมชาย ใจดี                                 | |
|  |       เลขประจำตัวประชาชน / ID No. : 1-2345-XXXXX-12-3      | |
|  |                                                           | |
|  |    ได้ผ่านการตรวจประเมินและรับรองตามมาตรฐาน                  | |
|  |    Good Agricultural and Collection Practices (GACP)      | |
|  |    สำหรับการปลูกพืชสมุนไพร                                 | |
|  |                                                           | |
|  |           กัญชา / Cannabis sativa L.                       | |
|  |                                                           | |
|  | ณ พื้นที่ หมู่ 1 ตำบลรอบเวียง อำเภอเมือง จังหวัดเชียงราย      | |
|  |                                                           | |
|  |  มีผลตั้งแต่วันที่ ๑๖ พฤษภาคม พุทธศักราช ๒๕๖๙              | |
|  |  จนถึงวันที่    ๑๖ พฤษภาคม พุทธศักราช ๒๕๗๐                 | |
|  |                                                           | |
|  | ────────────────────────────────────────────────────────  | |
|  |                                                           | |
|  |   ────────────                       [██ QR ██]           | |
|  |   อธิบดีกรม...                       Scan to verify        | |
|  |   Director-General                                        | |
|  |   วันที่: ๑๖ พ.ค. ๒๕๖๙                                     | |
|  |                                                           | |
|  | ────────────────────────────────────────────────────────  | |
|  |  ออกโดย DTAM · กรมการแพทย์แผนไทยและการแพทย์ทางเลือก         | |
|  |  · กระทรวงสาธารณสุข · Ministry of Public Health           | |
|  +-----------------------------------------------------------+ |
|  [Watermark "GACP DTAM" 5% opacity, -22deg, centred]            |
+----------------------------------------------------------------+
```

## Placeholder dictionary

The `buildCertificateContext(cert, signer?, opts?)` pure function (exported
from `certificate-template-service.js`) returns this map, which the template
substitutes via `pdfGenerator.replaceTemplateVariables`:

| Placeholder            | Source / formatter                                         | Example output                          |
| ---------------------- | ---------------------------------------------------------- | --------------------------------------- |
| `CERT_NUMBER`          | `buildDtamCertNumberDisplay(cert.certificateNumber)`       | `GACP-DTAM-2569-A3F7B2`                 |
| `CERT_NUMBER_TH`       | `arabicToThai(CERT_NUMBER)`                                | `GACP-DTAM-๒๕๖๙-A๓F๗B๒`                  |
| `APPLICANT_NAME`       | `cert.applicantName` (escaped)                              | `สมชาย ใจดี`                              |
| `APPLICANT_ID`         | `maskNationalId(cert.applicantId)`                          | `1-2345-XXXXX-12-3`                     |
| `CULTIVATION_METHODS`  | `formatCultivationMethods(cert.cultivationMethods)` (array or string) | `กัญชา / กระท่อม`                |
| `FARM_LOCATION`        | `buildFarmLocation({address, subDistrict, district, province})` | `หมู่ 1 ตำบลรอบเวียง อำเภอเมือง จังหวัดเชียงราย` |
| `ISSUE_DATE_TH`        | `formatThaiDate(cert.issuedDate)` (Thai-numeral + พุทธศักราช) | `๑๖ พฤษภาคม พุทธศักราช ๒๕๖๙`             |
| `EXPIRY_DATE_TH`       | `formatThaiDate(cert.expiryDate)`                          | `๑๖ พฤษภาคม พุทธศักราช ๒๕๗๐`             |
| `SIGNER_NAME`          | `signer.name` or `DEFAULT_SIGNER.name`                     | `อธิบดีกรมการแพทย์แผนไทย…`                |
| `SIGNER_POSITION`      | `signer.position` or `DEFAULT_SIGNER.position`             | `Director-General, DTAM`                |
| `VERIFY_URL`           | `cert.qrData` or `CERT_VERIFY_BASE_URL/{cert.certificateNumber}` | `https://gacp.dtam.moph.go.th/verify/…` |
| `QR_CODE_DATA_URL`     | `qrcode.toDataURL(VERIFY_URL, …)` (indigo on white, ECC=H) | `data:image/png;base64,iVBORw0…`        |
| `GARUDA_DATA_URL`      | `getLogoDataUrl()` (cached)                                | `data:image/png;base64,…`               |
| Legacy mirror keys     | `FARM_NAME`, `CROP_TYPE`, `ISSUED_DATE_TH`, `ISSUED_DATE_SHORT`, `STANDARD_NAME`, `QR_DATA_URL`, `VERIFICATION_CODE` | (back-compat for pre-B23 fragments)     |

## Certificate-number scheme — note on storage vs display

Two different forms coexist by design:

- **Storage (column `Certificate.certificateNumber`, @unique):**
  `GACP-TH-{พศ}-{hex6}` — owned by `certificate-service.js` at the
  `generateCertificate` write path. Hex6 from `crypto.randomBytes(3)` per
  PR-1.5 (16M-key search space, defeats enumeration of the public
  `/api/public/verify/:id` endpoint).
- **Display (rendered PDF, search index `CERT_NUMBER`):**
  `GACP-DTAM-{พศ}-{hex6}` — built by `buildDtamCertNumberDisplay` at render
  time. The `-DTAM-` token makes the issuing authority explicit on the
  printed certificate, matching Thai government document conventions.
- **Thai-numeral mirror (`CERT_NUMBER_TH`):**
  `GACP-DTAM-๒๕๖๙-A๓F๗B๒` — the digits inside the display number are
  transliterated; the letters in the hex suffix stay Latin so it remains
  human-distinguishable from real Thai-script titles.

The display projection is reversible: the `GACP-DTAM-…` form maps 1-to-1
back to `GACP-TH-…` (drop the `-DTAM-` token), so the public verify
endpoint can accept either and resolve to the same row.

## QR generation

- Library: `qrcode@^1.5.4` (already in `apps/backend/package.json` dependencies).
- Call site: `certificate-template-service.js` → `QRCode.toDataURL(verifyUrl, …)`.
- Options chosen:
  - `width: 220` — large enough that a phone scan after print → A4
    photocopy → re-print survives.
  - `errorCorrectionLevel: 'H'` — 30% Reed-Solomon redundancy; the
    documented best for a printed government certificate where the QR
    may pick up coffee stains and crease damage in the field.
  - `color.dark: '#3730A3'` — indigo to match the template; still
    well above the ISO 8.5:1 contrast minimum for scannability.

## BE date formatting

Goes through `apps/backend/utils/thai-numerals.js#formatThaiDate`, which
produces the canonical DTAM revenue-receipt form:

```
formatThaiDate(new Date('2026-05-16')) → '๑๖ พฤษภาคม พุทธศักราช ๒๕๖๙'
```

The compact form (`formatThaiDate` from `utils/thai-format.js` →
`๑๖ พ.ค. ๒๕๖๙`) is **not** used on the certificate — government convention
for formal certificates calls for the full-month + full-era spelling.

## Signer placeholder approach

- Default signer (`DEFAULT_SIGNER` constant): `อธิบดีกรมการแพทย์แผนไทยและการแพทย์ทางเลือก`
  + position `Director-General, Department of Thai Traditional and Alternative Medicine`.
- Callers can override per-render: `generateCertificatePdf(cert, { signer: { name, position } })`.
- The template renders a blank signature line + name + position + the
  issue date. A digital-signature image is intentionally **not** included
  in B23; if a future iteration wires in PKI signing, the placeholder
  `{{SIGNATURE_IMAGE_DATA_URL}}` is the recommended slot.

## Wire-in instructions for follow-up batches

The CERTIFIED-transition wiring is **out of scope** for B23 (the
brief tags `application-status-writer.js` as boundary). To complete
the loop:

1. Whoever owns the audit-pass / CERTIFIED transition (today:
   `audits.js` route at `POST /api/audits/:id/result` per
   certificate-service.js comments at lines 116-117) should call:

   ```js
   const cert = await certificateService.generateCertificate(applicationId, providerId);
   await certificateTemplateService.generateCertificatePdf(cert);
   ```

   `generateCertificate` already returns the Prisma row populated with
   the canonical `certificateNumber` (`GACP-TH-…`) and `qrData`
   (verify URL); the template service then projects to the DTAM-prefixed
   display form at render time.

2. The render is **upload-by-default** (MinIO bucket `certificates`,
   key `${certificateNumber}.pdf`). Pass `{ upload: false }` for a
   preview-only render (e.g. an admin preview UI).

3. The verify-URL base is `process.env.CERT_VERIFY_BASE_URL` with the
   production default `https://gacp.dtam.moph.go.th/verify`. Staging
   must override or risk leaking staging cert numbers through a
   production-style QR.

## Test surface

`apps/backend/__tests__/unit/certificate-template-service.test.js` — 34
unit tests covering helpers, the pure `buildCertificateContext`, the
template anchors (placeholders, palette, A4-portrait declaration,
no-corner-triangle directive), and the wrapped `generateCertificatePdf`
path (qrcode + puppeteer mocked).

Run with:

```
cd apps/backend
npx jest __tests__/unit/certificate-template --no-coverage
```
