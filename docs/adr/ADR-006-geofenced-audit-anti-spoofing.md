# ADR-006: Geofenced Anti-Spoofing for Field Audits

- Status: Accepted
- Date: 2026-02-22

## Context

Audit credibility depends on physical presence at registered farm locations. Remote/forged submissions weaken certification trust.

## Decision

- Extract EXIF location/time from uploaded audit photos.
- Compare against registered farm coordinates with distance threshold checks.
- Flag out-of-range submissions for supervisor review.

## Consequences

- Stronger evidence quality and audit trust.
- Requires robust metadata handling and review workflow for flagged cases.
