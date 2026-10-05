# Admin Tooling Runbook (Iter 28 — 2026-05-16)

Operational reference for the GACP admin tooling surface delivered in
Iteration 28 (B28-A). Covers user management, application force-status,
and the admin audit-log viewer.

## 1. Admin role responsibilities

The `ADMIN` canonical role (legacy values: `ADMIN`, `SUPER_ADMIN`) is
the only role permitted to invoke any endpoint under `/api/admin/`.
Role assignment is enforced by:

1. `middleware/require-admin.js` — applied globally to the admin router
   in `routes/api/admin/index.js`.
2. Each new service mutation (`admin-user-service`, `admin-application-service`)
   double-checks the `actorRole` argument as defence-in-depth.

Admins are accountable for:

- User lifecycle (create, disable, re-enable, role-change). There is no force MFA reset: no one clears another account's 2FA (operator 2026-09-26, "ถอดทั้งสองประตู"; 2FA recovery belongs to หมอพร้อม)
- Emergency overrides on stuck applications (`force-status`, `revert-last-transition`)
- Reviewing the audit log when an incident is reported

Every admin mutation produces an AuditLog row with severity `WARNING`
and the actor's id captured. There is no way to disable this logging
from the admin surface — it is a compliance requirement under PDPA s.32
and ISO 27799 §7.10.4.

## 2. User management endpoints

Base path: `/api/admin/users`

| Method | Path                              | Purpose                              |
| ------ | --------------------------------- | ------------------------------------ |
| GET    | `/`                               | Paginated search (role, type, q)     |
| POST   | `/provider`                       | Create new provider account         |
| PATCH  | `/:id/role`                       | Legacy role/status update (Iter 27) |
| PATCH  | `/:id/disable`                    | Soft-disable (status=INACTIVE)       |
| PATCH  | `/:id/enable`                     | Re-enable (status=ACTIVE)            |
| PATCH  | `/:id/change-role`                | Strict role change (10-char reason)  |

### Reason policies

| Mutation                | Min reason length |
| ----------------------- | ----------------- |
| `disable`               | 5                 |
| `change-role`           | 10                |

### Self-target guards

The service refuses any of the following on the actor themselves:

- self-disable (`USER_DISABLE` on `actorId == targetUserId`)
- self role-change (`SELF_ROLE_CHANGE_FORBIDDEN`)

This prevents an admin from accidentally locking themselves out, and
prevents an admin under duress from being coerced into a self-action
that bypasses dual-control.

### Lost authenticator device: no admin reset

`POST /:id/force-reset-mfa` was removed 2026-09-26 (operator: "ถอดทั้งสองประตู"),
together with `POST /api/provider/directory/:id/disable-2fa`. No admin clears
another account's 2FA, and there is no account recovery (operator 2026-09-17).
2FA recovery belongs to หมอพร้อม. The account owner can still turn their own 2FA
off at `DELETE /api/mfa/disable` with a current code from their own app, or move it
to a new device from `/provider/profile/security`: `POST /api/mfa/setup` on an account
with 2FA enabled needs the current code (401 `MFA_CODE_REQUIRED` otherwise), and the
old factor stays active until `POST /api/mfa/verify-setup` confirms a code from the new
one (audit `MFA_REENROLLED`). That confirmation is rate-limited like `/disable`, must come
from the session that started the move, is abandoned after 5 wrong codes, and signs every
other session out while keeping the current one.

## 3. Application force-status (emergency only)

Base path: `/api/admin/applications`

| Method | Path                                  | Purpose                            |
| ------ | ------------------------------------- | ---------------------------------- |
| PATCH  | `/:id/status`                         | Legacy override (Iter 22+)         |
| POST   | `/:id/force-status`                   | Iter 28 — strict guard, audited    |
| POST   | `/:id/revert-last-transition`         | Emergency rollback                 |

### When to use force-status

Force-status BYPASSES the workflow state machine. Use only when ALL of:

1. The application is stuck (workflow-transition-service refuses the move).
2. The applicant has been contacted and the override is communicated.
3. A ticket exists with a recorded `reasonCode` and free-text justification.

Allowed `reasonCode` values:

- `DATA_CORRECTION` — fix typed field that blocked the next transition.
- `COMPLIANCE_ESCALATION` — DTAM compliance team escalation.
- `LEGAL_ORDER` — court order or DTAM legal directive.
- `SYSTEM_RECOVERY` — recover from a known production incident.
- `MANUAL_REVIEW_EXCEPTION` — case-by-case exception approved by lead.

### Audit guarantees

A successful `force-status` writes THREE independent records:

1. `Application.workflowHistory[]` — the override event.
2. `Application.formData.adminOverrides[]` — same event, denormalised.
3. `AuditLog` row with `action=APPLICATION_FORCE_STATUS`, severity `WARNING`.

Losing any one of those still leaves the override forensically
recoverable. The triple-redundant design is intentional.

### Revert-last-transition

Used when a force-status was performed in error. The revert is a NEW
transition (not an in-place edit) — workflow history is append-only.

Constraints:

- Reason must be at least 10 characters.
- The application's current status MUST match the last recorded
  `toStatus`. Otherwise the service returns 409 to avoid restoring an
  incoherent state.

## 4. Audit log query patterns

Base path: `/api/admin/audit-log`

| Method | Path                | Purpose                          |
| ------ | ------------------- | -------------------------------- |
| GET    | `/`                 | JSON list with structured filters |
| GET    | `/export.csv`       | CSV export (up to 50,000 rows)   |

### Filters

| Query param      | Type     | Behaviour                                |
| ---------------- | -------- | ---------------------------------------- |
| `category`       | string   | Exact match, upper-cased                 |
| `action`         | string   | Exact match, upper-cased                 |
| `actorId`        | string   | Exact match                              |
| `applicationId`  | string   | Scopes to `resourceType=APPLICATION`     |
| `organizationId` | string   | Tenant filter                            |
| `from`, `to`     | ISO date | Inclusive range on `createdAt`           |
| `page`, `limit`  | int      | Pagination (limit max 200, default 50)   |

### Example: investigate a user-disable event

```
GET /api/admin/audit-log?action=USER_DISABLED&actorId=admin-7&from=2026-05-01
```

### Example: dump every force-status for a tenant

```
GET /api/admin/audit-log/export.csv?action=APPLICATION_FORCE_STATUS&organizationId=org-123&from=2026-01-01&to=2026-12-31
```

The CSV export streams up to 50,000 rows. For larger windows, narrow
the filter set or paginate via the JSON endpoint.

## 5. File boundaries

This iteration deliberately did NOT modify:

- `apps/backend/services/application-status-writer.js` — read-only;
  consumed via `writeApplicationStatus` from inside the service.
- `apps/backend/shared/canonical-rbac.js` — role table is canonical.
- Any Iter 23-27 service file.
- Frontend, marketing, customer success files (B28-B/C/D scopes).

The admin tooling stays inside:

- `apps/backend/services/admin-user-service.js` (new)
- `apps/backend/services/admin-application-service.js` (extended)
- `apps/backend/services/audit-trail.js` (extended)
- `apps/backend/routes/api/admin/users.js` (extended)
- `apps/backend/routes/api/admin/applications.js` (extended)
- `apps/backend/routes/api/admin/audit-log.js` (new)

## 6. Test coverage

Two new test files exercise the Iter 28 surface:

- `__tests__/admin-user-service.test.js` — 23 cases
- `__tests__/admin-application-service.test.js` — 24 cases

Both run without DB access via mocked `provider-user-service` and a
mocked `prisma-database` singleton. All cases pass at delivery.
