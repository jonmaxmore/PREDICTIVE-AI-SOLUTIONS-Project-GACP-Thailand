# ADR-002: De-couple Legacy UI Branding While Retaining Identity Core

- Status: Accepted
- Date: 2026-02-22

## Context

Earlier UX and terminology were too close to legacy external branding. This introduced legal/brand risk for a standalone DTAM platform.

## Decision

- Remove legacy external visual language and user-facing terminology from GACP interfaces.
- Keep proven identity semantics and backend patterns based on:
  - `healthId` for citizen/Applicant identity
  - `providerId` for provider identity

## Consequences

- Reduced legal and branding risk.
- Preserved core identity logic and integration readiness.
- Faster delivery by reusing stable backend identity behavior.
