# Application Frontend UX/UI Review (Manual Benchmark)

Date: 2026-02-22  
Scope: Review-only (design/UX direction for Application frontend)  
Inputs: 3 legacy/manual PDF references from local folder `Downloads/เอกสาร` (rendered for visual inspection)

## Purpose

Use the legacy manuals as a benchmark for practical usability (task clarity and step-by-step guidance), not as a direct visual style to copy 1:1.

This document stays within agreed scope:

- no feature refactor
- no system-wide redesign
- no over-engineering
- focus on the Application flow (wizard-first)

## Reviewed Files

1. `manual-api-tdc.pdf` (13 pages)
2. `manual-ccc (1).pdf` (27 pages)
3. `manual-herbctrl (2).pdf` (63 pages)

## Executive Summary

The current frontend can look more modern than some legacy screens, but the older manuals still win on one critical dimension: task clarity.  
The strongest legacy pattern is not decoration. It is:

- clear step sequencing
- clear action emphasis
- screenshot + callout explanation
- predictable page structure

The improvement direction should therefore be:

- task-first UX
- consistent visual system
- modernized layout and typography
- fewer visual style shifts across modules

## Findings by Evaluation Criteria

### 1. Over-engineering

Assessment: `No` (for the manuals)

- The manuals are mostly straightforward procedural guides.
- The issue is not technical complexity.
- The issue is presentation inefficiency (too many pages / repeated screenshot patterns in some sections).

### 2. Duplicate Pages / Redundant Patterns / Confusion

Assessment: `Yes, moderate`

Observed patterns:

- Similar screenshot pages repeated with minimal change between steps
- Cover/title pages with overlapping purpose in some manuals
- Different visual styles across manuals make the ecosystem feel fragmented

Impact on frontend direction:

- Users may tolerate old visuals if flow is clear
- Users will not tolerate inconsistent interactions even if visuals are modern

### 3. Non-sensical / Not Making Sense

Assessment: `Some presentation issues, but workflow guidance mostly makes sense`

Examples:

- Large whitespace pages with low information density
- Screenshot scaling sometimes too small for the importance of the step
- Some pages function more like placeholders than instructional content

Strong counter-example:

- `manual-herbctrl (2).pdf` is strong in procedural logic (step numbering, callouts, sequence)

### 4. Template Usability + Modernity

Assessment: `Usable, but not modern; strong operational structure`

What works well:

- Task-step structure
- Visual callouts (A/B/C/D)
- Action-oriented captions

What feels dated:

- Cover design styles differ heavily by manual
- Typography hierarchy is inconsistent
- Screenshot framing and spacing vary too much

### 5. Text Correctness / Length / Complexity

Assessment: `Generally acceptable in structure; layout is the bigger issue`

- Copy is mostly operational and direct (good for manuals)
- The larger problem is page composition and hierarchy, not word count
- For frontend copy, the goal should be even shorter and more action-oriented than the manuals

## Comparative Summary (What to Keep / What to Avoid)

### `manual-herbctrl (2).pdf` (best benchmark for UX structure)

Keep:

- step-by-step progression
- explicit action cues
- annotated screenshots
- predictable instructional rhythm

Avoid copying:

- dense page count
- dated visual styling
- inconsistent screenshot scale across sections

### `manual-api-tdc.pdf`

Keep:

- official tone
- concise total page count

Avoid:

- weak content density in some pages
- cover style disconnected from inner instructional pages

### `manual-ccc (1).pdf`

Keep:

- friendly tone / approachable entry point

Avoid:

- visual style mismatch with enterprise/government workflow UI
- decorative cover style that does not match runtime interface tone

## Frontend Improvement Direction (Application Flow Only)

### Target Design Direction

Use a `modern government enterprise` style:

- clean and trustworthy
- strong hierarchy
- high readability
- task-first interactions
- consistent UI patterns across steps

### Core UX Principles to Apply

1. Make the next action obvious
2. Keep page structure stable across steps
3. Show validation close to the field and also in a top summary when needed
4. Use helper text only where users are likely to fail
5. Prefer clarity over decoration

### Visual Principles to Apply

1. One typography system across all wizard pages
2. One spacing scale (no ad hoc padding/margins per step)
3. One card pattern for sections/forms
4. One action bar pattern (Back/Next/Primary CTA)
5. One status language for autosave/offline/error

## Priority Improvement Scope (Do First)

1. Wizard page template (shared layout pattern)
2. Review / Submit / Payment late-stage flow clarity
3. Form step consistency (labels, helper text, error messages)
4. Contextual help pattern (small callouts, not large verbose blocks)

## Out of Scope (This Review)

- Global rebrand
- Full design system migration
- Refactoring every legacy frontend page
- Backend workflow redesign

## Next Recommended Artifact

Create a focused spec for:

- `Application Wizard Template Redesign (v1)`
- shared page anatomy, state rules, copy rules, and rollout slices

