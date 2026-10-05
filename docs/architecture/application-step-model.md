# Application Step Model — GACP Platform

> Canonical 6-step model for the application form wizard.

## Source of Truth
`apps/web-app/src/app/health/applications/new/application-schema.ts`

## Steps

| Step | Key | Label (TH) | Label (EN) | User Action |
|------|-----|------------|------------|-------------|
| 1 | plant_consent | พืชและยินยอม | Plant & Consent | PDPA, select plant, purpose, methods |
| 2 | applicant | ผู้ยื่นคำขอ | Applicant | Identity, contact, entity type |
| 3 | farm_cultivation | สถานที่และเพาะปลูก | Farm & Cultivation | Farm address, plots, GPS, crops |
| 4 | quality_docs | คุณภาพและหลักฐาน | Quality & Documents | Harvest/dry/storage + file uploads |
| 5 | review | ตรวจทาน | Review | Summary review, confirm correctness |
| 6 | payment | ชำระเงิน | Payment | Post-submit Phase 1 fee payment |

## Mental Model
1. **Who** is applying (identity)
2. **What** they want (plant, purpose)
3. **Where** they cultivate (farm, plots)
4. **How** they manage quality (harvest, storage, documents)
5. **Check** everything is correct (review)
6. **Pay** the application fee (payment)

## Validation Schema per Step
- Step 1: `step1Schema` — PDPA consent, plant selection, purpose, cultivation methods
- Step 2: `step2Schema` — Discriminated Union (Individual / Juristic / Community)
- Step 3: `step3Schema` — Farm data, plots array, cultivation details
- Step 4: `step4Schema` — Harvest/drying/storage methods, 5 required documents
- Step 5: `step5Schema` — Confirmation boolean
- Step 6: `step6Schema` — Payment acceptance (optional)

## Legacy Model (9-step, deprecated)
The `new-legacy/steps/` directory contains the old 9-step implementation:
consent → plant → purpose → applicant → farm → production → quality → documents → review/submit

This has been superseded by the 6-step model. The legacy files serve as
component implementations that the new routes may import.
