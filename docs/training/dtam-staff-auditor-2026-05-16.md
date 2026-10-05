# DTAM Auditor Team Training — 2026-05-16

**Audience**: DTAM field auditors performing on-site GACP inspections
**Prerequisites**: AUDITOR role, GACP auditor certification, field app installed
**Estimated reading**: 45 minutes
**Field practice**: 1 supervised visit before solo audits

> Auditors are the human gatekeepers of GACP certification quality. This guide covers the digital tools and decision framework. For domain content (what constitutes a GACP-compliant farm), see the DTAM GACP Standard 2021.

---

## 1. AUDITOR role and responsibilities

The AUDITOR persona has these scopes:

- View assigned applications (only those assigned by Scheduler)
- View applicant farm details, photos, documents
- Execute on-site audit using field app
- Submit audit decision (PASS / FAIL / NEEDS_REVIEW)
- Request reschedule (rare; requires reason)

**NOT allowed**:
- Self-assignment to applications
- Editing fees, payments, certificates
- Modifying applicant data
- Viewing other auditors' assignments

---

## 2. Field app overview

[FIG-01: Field app home screen]

### 2.1 Login + offline mode

- Login at first launch (online required)
- App stores ASSIGNED audits locally (encrypted)
- Works offline at farm (no signal areas)
- Auto-syncs when network restored

### 2.2 GPS

[FIG-02: GPS verification on farm arrival]

- Tap "Start Audit" on arrival
- App captures GPS coordinates
- System verifies coordinates within 1km of farm address
- If mismatch > 1km: app warns; you must confirm reason (e.g. "farmer moved plot")

### 2.3 Checklist execution

[FIG-03: Audit checklist with sections]

Standard GACP checklist has 9 sections:
1. Site & soil
2. Water source
3. Seeds & propagation
4. Cultivation practices
5. Pest & disease management
6. Harvest & post-harvest
7. Storage
8. Documentation & traceability
9. Worker safety & welfare

For each item:
- Select: COMPLIANT / NON_COMPLIANT / NOT_APPLICABLE
- Add note (required if NON_COMPLIANT)
- Attach photo (mandatory for at least 1 photo per section)

### 2.4 Photo capture

[FIG-04: In-app camera with watermark]

- Use in-app camera (do NOT use phone camera + upload)
- Photos auto-watermarked with GPS + timestamp
- Min resolution: 1920x1080
- Max 20 photos per audit (storage budget)

---

## 3. Decision matrix (PASS / FAIL / NEEDS_REVIEW)

### 3.1 PASS

Use when:
- All major checklist items COMPLIANT
- 0 critical non-conformities (CNC)
- ≤ 2 minor non-conformities (MNC), each with corrective evidence captured during audit
- Documentation complete and traceable
- Photos support compliance claim

### 3.2 FAIL

Use when:
- Any critical non-conformity present (e.g. prohibited pesticide use, contamination risk, fraudulent documentation)
- > 5 minor non-conformities
- Farm site does not match application
- Applicant refused inspection or obstructed audit

### 3.3 NEEDS_REVIEW

Use when:
- Borderline case requiring senior auditor opinion
- 3–5 minor non-conformities but applicant has remediation plan
- Documentation incomplete but recoverable
- Conflicting evidence on a section

Result: another senior auditor reviews within 5 working days. Applicant cannot proceed until resolved.

---

## 4. Reporting completed audits

[FIG-05: Submit Audit screen]

### 4.1 Submission checklist

Before tapping "Submit":
- [ ] All checklist items answered
- [ ] Required photos attached (≥ 1 per section)
- [ ] GPS verified
- [ ] Auditor signature captured (touch signature)
- [ ] Decision selected (PASS / FAIL / NEEDS_REVIEW)
- [ ] Decision rationale ≥ 50 characters
- [ ] Applicant signature captured (or marked "refused")

### 4.2 What happens after submit

- Audit syncs to server (may take a few minutes on slow signal)
- Applicant notified within 1 hour
- If PASS: certificate workflow triggered automatically
- If FAIL: applicant has 30 days to request re-audit (additional 5,000 THB)
- If NEEDS_REVIEW: case enters review queue

### 4.3 Audit cannot be edited after submission

If you discover an error post-submission:
- Contact Scheduler immediately
- Scheduler creates AMENDMENT request
- Senior auditor reviews
- Original audit annotated, not overwritten

---

## 5. Reschedule request handling

[FIG-06: Reschedule Request form]

### 5.1 Auditor-initiated reschedule

Allowed reasons:
- Force majeure (weather, road closure)
- Vehicle breakdown
- Auditor illness/injury
- Conflict of interest discovered late

NOT allowed reasons:
- Personal convenience
- Forgot the assignment

### 5.2 Process

1. Tap "Request Reschedule" on assignment
2. Select reason from list
3. Add free-text explanation (≥ 100 chars)
4. Attach evidence if applicable (e.g. weather warning screenshot)
5. Submit; goes to Scheduler

Scheduler responds within 2h. Applicant notified of new date.

### 5.3 Applicant-initiated reschedule

You may receive Scheduler-forwarded reschedule requests from applicants. You don't decide — Scheduler does. You just acknowledge new date in field app.

---

## 6. Best practices

- **Time at site**: aim 4–6 hours for new farms, 2–4 hours for renewal
- **Photos before checklist**: capture overview first, then per section as you progress
- **Talk to workers**: real practices > paper documentation
- **Note your hunches**: even if checklist says COMPLIANT, free-text note "looks clean but no records of last 3 months" — Scheduler reviews
- **Battery**: bring power bank, field app drains battery
- **Backup notes**: paper notebook as backup if app crashes; report bug immediately

---

## 7. Audit ethics

- No gifts from applicants (food/water acceptable, anything > 200 THB not)
- No relationship with applicant (declare conflict)
- No coaching during audit
- No private contact with applicant outside of platform messaging

Violations: immediate suspension + investigation.

Hotline: ethics@dtam.go.th (anonymous).

---

## 8. Quick reference

- App download: https://gacp.dtam.go.th/auditor/app
- Helpdesk: ext. 4100, audit-support@dtam.go.th
- Senior auditor on-call: rotating schedule, see Scheduler
- Field app version: must be ≥ 2.0.0 for production cutover
