# Core Product Improvements Phase Kickoff (Post-Stabilization)

- Status: Started (Workstream A selected; review-first mapping complete)
- Last Updated: 2026-02-22
- Prerequisite phase: `Stabilization / Release-Readiness`

## Purpose

Define the first development phase after release-readiness work, with strict scope control:

- prioritize user impact first
- avoid mixing feature work with release operations
- preserve security and deploy discipline established in the previous phase

## Entry Criteria (Met)

This phase is allowed to start because the following conditions are already satisfied:

- release-readiness closeout exists (`docs/release-readiness-closeout-2026-02-22.md`)
- deploy runbook/checklist/command sequence are documented and rehearsed
- restore drill template + recorded rehearsal exist
- runtime rehearsal baseline was validated and later approved SHAs were checked with `docs-only diff`
- residual dependency risks were documented and accepted where patching was unsafe

Note:

- Actual production/preview machine execution is an operations step and remains outside this planning doc.

## Scope Guard (Non-Negotiable)

### In Scope

- user-facing reliability improvements on critical flows
- bug fixes that remove ambiguity or broken behavior
- additive hardening tied directly to the target flow
- test coverage for changed behavior
- docs/ADR updates only when a decision changes behavior or process

### Out of Scope (Unless Explicitly Re-approved)

- broad refactors across unrelated modules
- UI polish with no reliability or task-completion impact
- architecture rewrites without evidence of current pain
- dependency sweeps unrelated to the target flow
- schema redesign beyond the minimum needed for the chosen slice

## Prioritization Rule (How We Choose Work)

Choose work by this order:

1. user impact on task completion
2. production risk reduction
3. blast radius (smaller change set preferred)
4. verification cost (can we prove it works quickly?)

When two items compete, choose the one with:

- clearer acceptance criteria
- fewer moving parts
- easier rollback

## Recommended Work Pattern (Default)

Use a `review-first vertical slice` pattern:

1. map the request flow end-to-end (request -> auth -> service -> DB -> response)
2. identify the exact failure or inconsistency
3. patch only the minimum path that fixes the behavior
4. add/adjust tests for the changed path
5. run targeted validation + relevant gates
6. record any design decision if behavior/process changed materially

Why this pattern:

- aligns with the requirement to understand system mental model before edits
- reduces hidden regressions from "fixing" code that was not fully understood
- avoids scope creep in a large monorepo with dirty parallel workstreams

## Role / Agent Lens Selection (Use the Right Lens Per Task)

Use these as review/implementation lenses, not parallel uncontrolled changes:

1. `Flow Reviewer` (always first)
- Builds mental model of request/auth/DB flow
- Confirms what is broken vs expected

2. `Backend/API Lens`
- Use for validation, orchestration, auth checks, error handling, idempotency
- Owns contract correctness and non-blocking failure behavior

3. `Database Integrity Lens`
- Use when schema, migration, indexing, or query behavior is involved
- Must preserve migration pairing and rollback clarity

4. `Frontend UX/Offline Lens`
- Use when completion rate, offline resilience, or user feedback is impacted
- Focus on clarity and state integrity over cosmetic polish

5. `Security/Compliance Lens`
- Use when auth, tokens, IP extraction, public APIs, or audit trails are touched
- Must verify no regression against hardening decisions already implemented

Rule:

- Prefer one implementation lens at a time plus review from one other lens.
- Do not run multi-surface edits (frontend + backend + schema + infra) in one ticket unless unavoidable.

## First Phase Candidate Workstreams (High-Impact First)

### A. Applicant Wizard Reliability and Offline Sync Clarity

Why:

- directly impacts user completion in low-connectivity environments
- high business value and visible outcomes

Suggested first slices:

- reconcile pending-sync indicator accuracy with actual save state
- verify conflict/error messaging on offline sync rejection paths
- targeted regression tests for draft save/restore edge cases

Acceptance criteria (example):

- no silent loss of draft state in tested scenarios
- sync conflict returns clear UI state and retry path
- tests cover at least one offline recovery and one conflict case

Current review-first mapping:

- `docs/backlog/Applicant-wizard-offline-sync-workstream-a-review-first-mapping.md`

### B. Auditor Decision / Evidence Submission Robustness

Why:

- audit evidence is compliance-critical and already partially hardened
- recent fixes changed evidence metadata submission path

Suggested first slices:

- verify backend acceptance/validation of evidence metadata payloads
- check error behavior for mixed valid/invalid file sets
- ensure audit decision paths stay non-blocking where intended, strict where required

Acceptance criteria (example):

- evidence metadata persists correctly for supported uploads
- invalid files are rejected with clear feedback without corrupting decision flow
- tests cover success + mixed-file rejection path

### C. provider Workflow Operational Consistency (SLA / Notification)

Why:

- affects internal timeliness and accountability
- recent SLA notification feature was added and should be verified end-to-end

Suggested first slices:

- validate SLA breach notification routing and duplicate prevention
- confirm state-machine transitions vs expected 5-day behavior
- add targeted integration or service-level tests

Acceptance criteria (example):

- exactly one SLA breach notification for a qualifying event (or documented dedupe strategy)
- no false positives on non-breach states
- logs/telemetry support traceability

## Phase Execution Order (Recommended)

1. Pick one workstream only (`A` or `B`) for the first implementation ticket
2. Do review-first mapping and write acceptance criteria before edits
3. Implement minimal fix + tests
4. Run targeted validation and relevant gates
5. Reassess next priority (do not pre-commit to all three streams)

## Version Control / Process Rules (Carry Forward)

- use small reversible commits
- do not touch unrelated dirty/untracked files
- use clean checkout/worktree for release or exact-SHA verification
- review code before running deploy-impacting commands
- use preview/rehearsal process before any deploy after feature changes

## Definition of "Phase Started"

This phase is considered started only when:

- one workstream is selected
- acceptance criteria are written
- first review-first findings are documented
- implementation scope is explicitly limited

This prevents "starting everything at once" and losing release discipline.

Current status:

- met via Workstream A review-first mapping in `docs/backlog/Applicant-wizard-offline-sync-workstream-a-review-first-mapping.md`
