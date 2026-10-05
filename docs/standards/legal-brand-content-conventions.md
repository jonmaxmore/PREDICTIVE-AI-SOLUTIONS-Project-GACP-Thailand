# Legal/Brand Content Conventions

Effective date: `2026-02-22`  
Scope: tracked repository content (code comments, docs, notes, UI text, scripts)

## Goal

Prevent prohibited legal/brand wording from reappearing in the project during implementation, review, and handoff.

## 1) Banned-Term Rule

- Prohibited terms must not appear in tracked repository files.
- This includes:
  - code comments
  - markdown notes/docs
  - UI text/content
  - script messages

## 2) Manual Audit Check

Machine check:

```bash
npm run check:banned-terms
```

This runs:

- `scripts/ci/check-banned-terms.js`

Recommended use:

- Run during terminology-sensitive reviews and before release handoff.
- Optional staged-files check during local review:
  - `node scripts/ci/check-banned-terms.js --staged`

## 3) Change Policy

- If legal/compliance updates the prohibited-term list:
  - update `scripts/ci/check-banned-terms.js`
  - document the change in an ADR or scope note in the same PR
- Do not weaken guard patterns without explicit review approval.
