# DBD Video Research -> UI Adaptation Notes

Date: 2026-02-17
Scope: Health application flow (`/health/applications/new/step/1`) and shared form clarity styles

## Sources reviewed

1. https://www.youtube.com/watch?v=pG51UMjNqSg
2. https://www.youtube.com/watch?v=-jZkxKZAnjI
3. https://www.youtube.com/watch?v=PNH_GU4oIFs
4. https://www.youtube.com/watch?v=bjRFDrXMwxg
5. https://www.dbd.go.th/ewt_news.php?nid=469498302
6. https://www.dbd.go.th/ewt_news.php?nid=469495620

## Key findings from videos (usable for our project)

1. **Step clarity reduces abandonment**
   - DBD communication repeatedly explains a fixed sequence (สมัคร/ยืนยันตัวตน -> สร้างคำขอ -> เตรียมข้อมูล -> ยื่น).
   - Users proceed faster when each page states the current step and what comes next.

2. **Preparation checklist must be visible before data entry**
   - DBD flow warns users to prepare required information/documents before continuing.
   - This avoids backtracking and repeated errors in later steps.

3. **Contextual help near fields**
   - DBD e-registration training emphasizes inline explanation and help icon usage.
   - Help text should be next to the field, not hidden in separate docs.

4. **Official-form mindset**
   - DBD process treats data entry as legal record creation.
   - Form pages should clearly indicate that data feeds official preview/export documents.

5. **Progress + status feedback are mandatory**
   - Users need visible completion status and missing-item feedback before submit.

## Applied changes in this commit scope

### 1) Step-1 wizard information architecture updated
File: `apps/web-app/src/app/health/applications/new/steps/step-plant-selection.tsx`

- Added **submission flow overview** block with 6 stages.
- Added **preparation checklist summary** (application profile, required M1 docs, estimated fee).
- Kept existing API/business behavior unchanged.
- Kept CTA as a single primary action (`Save and continue`) with readiness guard.

### 2) Field contrast and input visibility strengthened
File: `apps/web-app/src/styles/globals.css`

- Increased contrast for form grouping surface (`--field-muted-surface`).
- Strengthened input emphasis (`.field-emphasis`) to make fillable fields obvious.
- Updated `.contrast-panel` and `.form-block` shadows for clearer visual grouping.

## Rationale for Thai government workflow context

- Government-oriented systems require auditability and lower ambiguity.
- The added flow and preparation sections reduce interpretation errors and improve legal-form completeness.
- The styling changes focus on readability and data-entry confidence rather than decorative separators.

## Next recommended phase

1. Apply the same pattern to steps 2-6:
   - field-level helper text standard
   - missing-required indicators
   - consistent preparation/status summaries
2. Keep step 7 preview as official document output surface (print/export first class).
3. Add task-level inline help (`i` tooltip pattern) for complex fields.
