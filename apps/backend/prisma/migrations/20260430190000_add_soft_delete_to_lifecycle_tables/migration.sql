-- Wave A Phase 15 (G11) — extend soft-delete to remaining lifecycle tables.
--
-- The 2026-04-30 ERP gap analysis identified 8 lifecycle entities without
-- the standard soft-delete columns (isDeleted + deletedAt + deletedBy +
-- deleteReason). Adding them brings these models in line with the rest
-- of the schema and lays the groundwork for the auto-filter extension
-- planned for Phase 17 (tenant-prisma-extension default scope).
--
-- Models updated:
--   ApplicationDraft, ApplicationComment, ApplicationBundle (application.prisma)
--   Subscription (billing.prisma)
--   ScopeOfWork, AuditChecklist, MeetingRoom (system.prisma)
--   ConsumerFeedback (trace.prisma)
--
-- All additions are nullable / default-false so existing rows aren't
-- affected. Reads that rely on `WHERE isDeleted = false` work
-- immediately because every existing row gets the default false.
--
-- Models intentionally NOT updated:
--   PaymentTransaction / PaymentAudit / PaymentReconciliation — log rows
--   InvoiceLineItem — child of Invoice (cascade-managed)
--   Notification — log row
--   SystemConfig / WizardStepConfig / DocumentTemplate — config (status field)
--   RoleJobDescription / BankAccount — use isActive instead
--   AuditLog — immutable by design
--   work_activities — uses state = CANCELLED instead
--   user_group_memberships / role_groups — use isActive

BEGIN;

-- ApplicationDraft
ALTER TABLE "application_drafts"
    ADD COLUMN IF NOT EXISTS "isDeleted"    BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS "deletedAt"    TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "deletedBy"    TEXT,
    ADD COLUMN IF NOT EXISTS "deleteReason" TEXT;
CREATE INDEX IF NOT EXISTS "application_drafts_isDeleted_idx"
    ON "application_drafts" ("isDeleted");

-- ApplicationComment
ALTER TABLE "application_comments"
    ADD COLUMN IF NOT EXISTS "isDeleted"    BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS "deletedAt"    TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "deletedBy"    TEXT,
    ADD COLUMN IF NOT EXISTS "deleteReason" TEXT;
CREATE INDEX IF NOT EXISTS "application_comments_isDeleted_idx"
    ON "application_comments" ("isDeleted");

-- ApplicationBundle
ALTER TABLE "application_bundles"
    ADD COLUMN IF NOT EXISTS "isDeleted"    BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS "deletedAt"    TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "deletedBy"    TEXT,
    ADD COLUMN IF NOT EXISTS "deleteReason" TEXT;
CREATE INDEX IF NOT EXISTS "application_bundles_isDeleted_idx"
    ON "application_bundles" ("isDeleted");

-- Subscription
ALTER TABLE "subscriptions"
    ADD COLUMN IF NOT EXISTS "isDeleted"    BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS "deletedAt"    TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "deletedBy"    TEXT,
    ADD COLUMN IF NOT EXISTS "deleteReason" TEXT;
CREATE INDEX IF NOT EXISTS "subscriptions_isDeleted_idx"
    ON "subscriptions" ("isDeleted");

-- ScopeOfWork
ALTER TABLE "scope_of_works"
    ADD COLUMN IF NOT EXISTS "isDeleted"    BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS "deletedAt"    TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "deletedBy"    TEXT,
    ADD COLUMN IF NOT EXISTS "deleteReason" TEXT;
CREATE INDEX IF NOT EXISTS "scope_of_works_isDeleted_idx"
    ON "scope_of_works" ("isDeleted");

-- AuditChecklist
ALTER TABLE "audit_checklists"
    ADD COLUMN IF NOT EXISTS "isDeleted"    BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS "deletedAt"    TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "deletedBy"    TEXT,
    ADD COLUMN IF NOT EXISTS "deleteReason" TEXT;
CREATE INDEX IF NOT EXISTS "audit_checklists_isDeleted_idx"
    ON "audit_checklists" ("isDeleted");

-- MeetingRoom
ALTER TABLE "meeting_rooms"
    ADD COLUMN IF NOT EXISTS "isDeleted"    BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS "deletedAt"    TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "deletedBy"    TEXT,
    ADD COLUMN IF NOT EXISTS "deleteReason" TEXT;
CREATE INDEX IF NOT EXISTS "meeting_rooms_isDeleted_idx"
    ON "meeting_rooms" ("isDeleted");

-- ConsumerFeedback
ALTER TABLE "consumer_feedback"
    ADD COLUMN IF NOT EXISTS "isDeleted"    BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS "deletedAt"    TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "deletedBy"    TEXT,
    ADD COLUMN IF NOT EXISTS "deleteReason" TEXT;
CREATE INDEX IF NOT EXISTS "consumer_feedback_isDeleted_idx"
    ON "consumer_feedback" ("isDeleted");

COMMIT;
