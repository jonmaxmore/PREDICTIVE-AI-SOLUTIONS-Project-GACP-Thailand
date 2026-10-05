# Architecture Decision Records (ADR)

Project: GACP Certification Platform (DTAM)  
Purpose: Preserve major architectural/security decisions and their rationale for handoff and future maintenance.

## Index

- `docs/adr/ADR-001-four-pillar-PROVIDER-structure.md`
- `docs/adr/ADR-002-decouple-legacy-ui-branding-retain-identity-core.md`
- `docs/adr/ADR-003-offline-first-indexeddb.md`
- `docs/adr/ADR-004-optimistic-locking-offline-sync.md`
- `docs/adr/ADR-005-async-heavy-workloads-bullmq.md`
- `docs/adr/ADR-006-geofenced-audit-anti-spoofing.md`
- `docs/adr/ADR-007-auth-and-request-security-hardening.md`
- `docs/adr/ADR-008-preview-gate-enforcement-before-deploy.md`
- `docs/adr/ADR-009-executable-security-conventions.md`
- `docs/adr/ADR-010-commit-scoped-quality-gates-for-schema-and-lint.md`
- `docs/adr/ADR-011-executable-legal-brand-banned-terms-guard.md`
- `docs/adr/ADR-012-audit-log-canonical-write-path-and-phased-chain-verification.md`
- `docs/adr/ADR-013-platform-neutral-production-strategy.md`
- `docs/adr/ADR-014-multi-tenancy-foundation.md`
- `docs/adr/ADR-014-phase-3-handoff.md`
- `docs/adr/ADR-015-mobile-app-shelving.md`

## ADR Policy

- Record decisions that materially affect architecture, security, data integrity, or operations.
- Keep each ADR immutable after acceptance. If direction changes, add a new ADR that supersedes prior decisions.
- Every ADR must include context, decision, and consequences.
