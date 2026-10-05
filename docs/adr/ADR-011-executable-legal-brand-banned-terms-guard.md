# ADR-011: Executable Legal Brand Banned-Terms Guard

- Status: Accepted
- Date: 2026-02-22

## Context

The project must avoid prohibited legacy brand wording in all tracked repository content, including comments, notes, docs, and user-facing text.

Manual review alone is not reliable enough to prevent accidental reintroduction during concurrent edits and handoff work.

## Decision

Add an executable repository-wide banned-terms guard as a maintainers' manual audit tool:

1. `scripts/ci/check-banned-terms.js`
   - Scans tracked repository files using `git grep`.
   - Fails on prohibited legal/brand terms (Thai and English variants).
2. `package.json`
   - Add `npm run check:banned-terms`.
3. Use the check during review/release preparation when legal/brand wording risk is in scope.

Document the convention in a standards document for maintainers and reviewers.

## Consequences

### Positive

- Reduces legal/branding risk from accidental text regressions.
- Enforces the rule across code, docs, and comments (not only UI).
- Makes the requirement explicit and testable without adding release-gate friction to unrelated changes.

### Trade-offs

- Guard patterns require maintenance if the prohibited-term list changes.
- False positives are possible if future terms overlap valid domain language, so updates must be reviewed carefully.
- As a manual check, enforcement depends on reviewer discipline unless explicitly added to a temporary release checklist.
