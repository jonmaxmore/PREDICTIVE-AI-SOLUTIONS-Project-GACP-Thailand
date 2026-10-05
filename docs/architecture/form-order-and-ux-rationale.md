# Form Order & UX Rationale — GACP Platform

> Why the form steps are ordered the way they are.

## Design Principle
The form follows the user's natural mental model, not the database schema.

## Order Rationale

### Step 1: Plant & Consent (พืชและยินยอม)
**Why first**: PDPA consent is legally required before collecting data.
Plant selection determines which subsequent fields appear (e.g., cannabis
requires different docs than turmeric). This is the "what" question.

### Step 2: Applicant (ผู้ยื่นคำขอ)
**Why second**: After knowing WHAT they want to certify, users identify
WHO is applying. This uses a discriminated union: Individual (Thai ID),
Juristic (Tax ID + company), or Community Enterprise (registration number).

### Step 3: Farm & Cultivation (สถานที่และเพาะปลูก)
**Why third**: WHERE the cultivation happens. Farm address, GPS coordinates,
plot definitions, land ownership. This is the largest data entry step.

### Step 4: Quality & Documents (คุณภาพและหลักฐาน)
**Why fourth**: HOW they manage quality — harvest methods, drying, storage.
Plus the 5 required documents (title deed, ID copy, etc.). This comes after
farm info because document requirements depend on farm/entity type.

### Step 5: Review (ตรวจทาน)
**Why fifth**: Users review ALL entered data before submission.
Confirmation checkbox serves as digital signature of correctness.

### Step 6: Payment (ชำระเงิน)
**Why last**: Payment happens AFTER submission. This is an operational
phase, not a form input step. User sees the Phase 1 invoice and can
pay via QR Code PromptPay.

## Anti-Patterns Avoided
1. **Payment before review**: Users shouldn't pay before confirming data
2. **Documents before farm**: Document requirements depend on farm type
3. **Identity last**: Would feel backwards to users
4. **Consent buried**: Must be first per PDPA law
5. **Mixing system steps**: Payment, review status, scheduling are NOT form steps

## Industry comparison (research note — references only)

> Mature business platforms approach multi-step forms with broadly the
> same shape; GACP follows that shape. The references below are
> **research-only** — GACP does not depend on Odoo or Oracle.

| System | Form approach |
|--------|--------------|
| Odoo (open-source ERP) | Progressive disclosure: basic → detail → confirm → process |
| Oracle ERP | Wizard with save-at-each-step |
| GACP | Progressive disclosure with PDPA-first ordering: consent → identity → location → quality → confirm → pay |
