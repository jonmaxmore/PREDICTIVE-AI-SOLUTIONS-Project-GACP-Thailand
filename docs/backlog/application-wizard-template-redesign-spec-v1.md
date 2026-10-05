# Application Wizard Template Redesign Spec (v1)

Date: 2026-02-22  
Phase: Core Product Improvements (Workstream A)  
Mode: Review-first spec (frontend-focused)

## Goal

Improve the `Application Wizard` UI/UX quality to exceed the current implementation in clarity and consistency, while preserving the proven workflow behavior and avoiding scope creep.

This spec is intentionally narrow:

- redesign the template/patterns first
- do not refactor business logic unless required by UI correctness
- implement in slices with runtime verification

## Why This Spec Exists

Recent QA and review work showed:

- wizard behavior is improving
- validation and autosave flow are becoming more reliable
- visual/interaction consistency is still below the expected quality bar

Legacy manuals showed a strong advantage in `task clarity`, which should be brought into the frontend without copying outdated visual styles.

## Scope (In)

1. Wizard page template structure (shared layout pattern)
2. Section card pattern for step forms
3. Header / progress / helper text pattern
4. Sticky navigation/action bar pattern
5. Validation message hierarchy (summary + inline)
6. Late-stage clarity for Review / Submit / Payment pages
7. Copy rules for labels/help text/action buttons (frontend text only)

## Scope (Out)

1. Backend API redesign
2. Database schema changes
3. Reworking all non-wizard pages
4. Global theming overhaul across the entire app
5. Large design system migration

## Design Direction

`Modern Government Enterprise`

Characteristics:

- clean and neutral
- trustworthy and official
- readable on low-resolution and older office displays
- clear action hierarchy
- minimal decorative noise

Avoid:

- over-illustrated screens
- inconsistent page layouts across steps
- dense blocks of helper text
- flashy UI patterns that reduce task completion speed

## Template Anatomy (Target Pattern)

Each wizard step page should use the same base layout:

1. **Step Header**
- step number + title
- one-line purpose
- optional short caution/helper line (only if necessary)

2. **Progress Context**
- visible progress indicator
- current step / total step
- autosave status (consistent vocabulary)

3. **Main Form Sections (Cards)**
- section title
- grouped inputs
- inline validation
- optional examples (small, not full paragraphs)

4. **Validation Summary (Conditional)**
- shown when user tries to continue and page has errors
- concise bullets
- links/anchors optional (future improvement, not v1 requirement)

5. **Action Bar (Sticky or Fixed Bottom within container)**
- `Back`
- secondary action (optional)
- primary CTA (`Next` / `Review` / `Submit` / `Pay`)
- disabled/loading state always explicit

## UI Behavior Rules (v1)

### Form Validation

- Inline error shown on the field
- Error clears on valid change
- Top summary shown only after submit/next attempt
- Do not use generic error banners for field-level errors

### Autosave / Offline Status

Use one consistent language set across steps:

- Draft saved
- Saving...
- Waiting to sync (offline)
- Save failed (retry)

Do not overload one status label for multiple meanings.

### Navigation

- `Back` and `Next` labels must match the actual next action
- Step titles and CTA labels must match the runtime step mapping
- Avoid hardcoded step numbers/routes in step components unless guaranteed static

## Late-Stage Page Requirements (Review / Submit / Payment)

### Review Page

- Show what the user is about to confirm
- Highlight missing/incomplete data clearly
- Provide direct “go fix” paths

### Submit Page

- Confirmation checklist with plain-language meanings
- Clear statement of what happens after confirmation
- Primary CTA should describe next screen/action (not vague “continue”)

### Payment Page

- Payment stage explanation (what is being paid and why)
- Disabled CTA should always show reason if blocked
- Acknowledgement checkboxes should be grouped and readable

## Copywriting Rules (Frontend)

1. One idea per sentence
2. Prefer action verbs
3. Avoid legal-style blocks unless required
4. Keep helper text shorter than field label + error text combined
5. Error messages must tell the user what to fix, not just that it failed

## Rollout Plan (Slices)

### Slice T1: Shared Template Skeleton (No behavior changes)

- header/progress/action bar layout alignment
- spacing/typography consistency
- no API or validation logic changes

### Slice T2: Form Section Pattern + Validation Presentation

- section card standardization
- helper text cleanup
- validation summary pattern

### Slice T3: Review / Submit / Payment UX Clarity

- late-stage page copy and CTA clarity
- step mapping consistency checks
- runtime sanity QA on dynamic step configs

## Acceptance Criteria (v1)

1. At least 3 wizard pages share the same layout pattern visibly
2. CTA labels match the actual action for the tested flow
3. Validation messages are readable and consistent across the selected steps
4. No hardcoded step navigation bugs in tested late-stage flow
5. `local-prod` frontend build path remains green after each slice

## Validation Plan

1. Targeted ESLint on changed files
2. `docker compose -f docker-compose.local-prod.yml build frontend`
3. Manual QA sanity pass on the affected steps
4. Update QA execution record/addendum only when runtime behavior is verified

## Risks and Trade-offs

### Risk

- Visual cleanup can accidentally change behavior in form-heavy components

### Mitigation

- Small slices
- build verification after each slice
- manual QA on touched steps only

### Trade-off (intentional)

- Prioritize clarity and consistency over a large visual redesign in one pass

## Decision for Current Phase

Proceed with `Wizard Template Redesign v1` using the slice plan above.  
Do not expand to global frontend redesign until wizard UX improvements are stable and verified.

