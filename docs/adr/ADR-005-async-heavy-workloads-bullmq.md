# ADR-005: Async Heavy Workloads with Queue Workers

- Status: Accepted
- Date: 2026-02-22

## Context

CPU-heavy tasks (PDF rendering, large QR generation, batch reporting) can block the Node.js event loop and degrade all API traffic.

## Decision

- Move heavy workloads out of request thread into background workers.
- Use Redis-backed queue orchestration (BullMQ-compatible pattern).
- Keep API responses fast; clients poll/subscribe for job completion.

## Consequences

- Improved API latency under load.
- Adds queue/job observability and worker operations responsibility.
