# ADR-004: Optimistic Locking for Offline Sync

- Status: Accepted
- Date: 2026-02-22

## Context

Offline edits from multiple clients/sessions can race during re-sync. Last-write-wins is unsafe for legal/compliance records.

## Decision

- Add version-based optimistic locking to critical entities (for example `Application` and audit artifacts).
- On update, require client version match; increment on success.
- Return HTTP `409 Conflict` for stale payloads.

## Consequences

- Prevents silent overwrite and preserves legal data integrity.
- Clients must implement conflict handling UX and retry paths.
