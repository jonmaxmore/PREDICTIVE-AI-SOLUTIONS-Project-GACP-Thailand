-- ADR-016 Phase 1A — Odoo/BPMN-style work activity tracking.
--
-- Codifies the gap surfaced in the 2026-04-30 SOW review: the system has
-- separate canonical roles (DOCUMENT_REVIEWER + AUDITOR + SCHEDULER + ACCOUNT)
-- but in practice one person often wears multiple hats. We need to track
-- "which work was done" independently from "which role did it" so the audit
-- trail still captures the work breakdown when a single person reviews docs
-- AND runs the field audit on the same application.
--
-- This is the Odoo `mail.activity` + Camunda `task` pattern formalised in
-- BPMN 2.0 (ISO/IEC 19510:2013). The application's workflow status remains
-- the single source of truth for stage; activities sit alongside as the
-- per-stage to-do items spawned by the workflow.
--
-- Three tables:
--
--   work_activities         per-tenant rows tracking actual work to be done
--                           (or already done) on an application
--   stage_activity_configs  global config: when application enters status X,
--                           which activities (workType + candidate group) get
--                           spawned?
--   sla_policies            global config: per workType, what's the due-by
--                           target + warning + escalation hours?
--
-- Phase 1A seeds the configs in this migration so the runtime can populate
-- activities from day 1. Phase 2 will surface an admin UI for editing them.

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────
-- work_activities — the per-tenant work items
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "work_activities" (
    "id"               TEXT PRIMARY KEY,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    "applicationId"    TEXT NOT NULL,

    -- What kind of work? (DOC_REVIEW | FIELD_AUDIT | CAR_REVIEW |
    -- FINAL_APPROVAL | SLIP_REVIEW | SCHEDULING | RECEIPT_ISSUE)
    -- Kept as TEXT (not enum) so admins can introduce new types via
    -- stage_activity_configs without a migration.
    "workType"         TEXT NOT NULL,

    -- Candidate group — canonical role code from canonical-rbac.js
    -- (any user with this role can claim).  Phase 3 may upgrade to M2M
    -- via UserGroupMembership; for now a single role string keeps the
    -- query path simple.
    "candidateGroup"   TEXT NOT NULL,

    -- TODO | CLAIMED | IN_PROGRESS | DONE | CANCELLED
    "state"            TEXT NOT NULL DEFAULT 'TODO',

    -- Assignment (Odoo's user_id field).  NULL until someone claims.
    "assignedUserId"   TEXT,
    "claimedAt"        TIMESTAMP(3),

    -- Execution timestamps for SLA/audit.
    "startedAt"        TIMESTAMP(3),
    "completedAt"      TIMESTAMP(3),
    "completedBy"      TEXT,

    "cancelledAt"      TIMESTAMP(3),
    "cancelReason"     TEXT,

    -- SLA targets computed at creation time from sla_policies (frozen
    -- once set so policy edits don't retroactively change deadlines).
    "dueAt"            TIMESTAMP(3),
    "warningAt"        TIMESTAMP(3),

    -- The workflow stage that triggered this activity.  Used to skip
    -- duplicate creation if status oscillates (REVISION_REQUESTED →
    -- ASSIGNED_FOR_REVIEW → REVISION_REQUESTED → ASSIGNED_FOR_REVIEW
    -- should NOT keep spawning new DOC_REVIEW rows; instead we reuse
    -- the open one if it exists).
    "triggeredAtStage" TEXT NOT NULL,

    -- Free-form note shown in the activity row (e.g. "Phase 1 fee slip
    -- ready for review"). Optional.
    "note"             TEXT,

    -- Multi-tenancy.
    "organizationId"   TEXT NOT NULL,

    CONSTRAINT "work_activities_applicationId_fkey"
        FOREIGN KEY ("applicationId") REFERENCES "applications"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "work_activities_assignedUserId_fkey"
        FOREIGN KEY ("assignedUserId") REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "work_activities_completedBy_fkey"
        FOREIGN KEY ("completedBy") REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "work_activities_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "work_activities_applicationId_idx"
    ON "work_activities" ("applicationId");
CREATE INDEX IF NOT EXISTS "work_activities_assignedUserId_idx"
    ON "work_activities" ("assignedUserId");
CREATE INDEX IF NOT EXISTS "work_activities_state_candidateGroup_idx"
    ON "work_activities" ("state", "candidateGroup");
CREATE INDEX IF NOT EXISTS "work_activities_workType_state_idx"
    ON "work_activities" ("workType", "state");
CREATE INDEX IF NOT EXISTS "work_activities_dueAt_idx"
    ON "work_activities" ("dueAt") WHERE "state" IN ('TODO', 'CLAIMED', 'IN_PROGRESS');
CREATE INDEX IF NOT EXISTS "work_activities_organizationId_idx"
    ON "work_activities" ("organizationId");

-- Idempotency: only one open activity per (applicationId, workType,
-- triggeredAtStage). Prevents duplicate spawning on status oscillation.
CREATE UNIQUE INDEX IF NOT EXISTS "work_activities_open_unique"
    ON "work_activities" ("applicationId", "workType", "triggeredAtStage")
    WHERE "state" IN ('TODO', 'CLAIMED', 'IN_PROGRESS');

ALTER TABLE "work_activities" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "work_activities_observe_tenant" ON "work_activities";
CREATE POLICY "work_activities_observe_tenant" ON "work_activities"
    FOR ALL
    TO PUBLIC
    USING (rls_observe_check('work_activities', "organizationId"))
    WITH CHECK (rls_observe_check('work_activities', "organizationId"));

-- ──────────────────────────────────────────────────────────────────────────
-- stage_activity_configs — global: which activities each stage spawns
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "stage_activity_configs" (
    "id"             TEXT PRIMARY KEY,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Workflow status code (e.g. 'ASSIGNED_FOR_REVIEW') — the entered
    -- status that triggers spawning.
    "workflowStage"  TEXT NOT NULL,

    -- What activity to spawn.
    "workType"       TEXT NOT NULL,
    "candidateGroup" TEXT NOT NULL,

    -- Display ordering when a single stage spawns multiple activities.
    "displayOrder"   INTEGER NOT NULL DEFAULT 0,

    -- TH/EN labels for UI.  Kept inline (rather than a translations
    -- table) — there are <30 rows total.
    "labelTH"        TEXT NOT NULL,
    "labelEN"        TEXT NOT NULL,
    "descriptionTH"  TEXT,

    -- Toggle a config off without deleting it (for safe rollback).
    "isActive"       BOOLEAN NOT NULL DEFAULT TRUE,

    CONSTRAINT "stage_activity_configs_unique"
        UNIQUE ("workflowStage", "workType")
);

CREATE INDEX IF NOT EXISTS "stage_activity_configs_workflowStage_idx"
    ON "stage_activity_configs" ("workflowStage", "isActive");

-- ──────────────────────────────────────────────────────────────────────────
-- sla_policies — global: per-workType deadlines
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "sla_policies" (
    "id"               TEXT PRIMARY KEY,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    "workType"         TEXT NOT NULL UNIQUE,

    -- Hours from creation to due-by (BPMN intermediate timer).
    "targetHours"      INTEGER NOT NULL,

    -- Hours from creation to first warning (UI badge / notification).
    -- NULL means no early warning.
    "warningHours"     INTEGER,

    -- Hours from creation to escalation (notify admin).  NULL means
    -- no auto-escalation.
    "escalationHours"  INTEGER,

    "labelTH"          TEXT NOT NULL,
    "labelEN"          TEXT NOT NULL,

    "isActive"         BOOLEAN NOT NULL DEFAULT TRUE
);

-- ──────────────────────────────────────────────────────────────────────────
-- Seed: stage_activity_configs (Phase 1A — 8 default activities)
-- ──────────────────────────────────────────────────────────────────────────
INSERT INTO "stage_activity_configs"
    ("id", "workflowStage", "workType", "candidateGroup", "displayOrder",
     "labelTH", "labelEN", "descriptionTH")
VALUES
    ('sac_phase1_slip',    'PHASE_1_SLIP_UNDER_REVIEW', 'SLIP_REVIEW',    'account',
     0, 'ตรวจสลิปค่าเอกสาร', 'Review Phase 1 Fee Slip',
     'ตรวจสลิปโอนเงินค่าเอกสาร แล้วอนุมัติหรือปฏิเสธ'),
    ('sac_doc_assign',     'DOC_FEE_PAID',              'SCHEDULING',     'scheduler',
     0, 'มอบหมายผู้ตรวจเอกสาร', 'Assign Document Reviewer',
     'เลือกผู้ตรวจเอกสารและส่งงานให้พิจารณา'),
    ('sac_doc_review',     'ASSIGNED_FOR_REVIEW',       'DOC_REVIEW',     'document_reviewer',
     0, 'ตรวจเอกสารใบสมัคร', 'Document Review',
     'พิจารณาความครบถ้วนของเอกสารใบสมัคร'),
    ('sac_phase2_slip',    'PHASE_2_SLIP_UNDER_REVIEW', 'SLIP_REVIEW',    'account',
     0, 'ตรวจสลิปค่าตรวจประเมิน', 'Review Phase 2 Fee Slip',
     'ตรวจสลิปโอนเงินค่าตรวจประเมิน แล้วอนุมัติหรือปฏิเสธ'),
    ('sac_audit_assign',   'AUDIT_FEE_PAID',            'SCHEDULING',     'scheduler',
     0, 'จัดคิวตรวจประเมิน', 'Schedule Field Audit',
     'จัดคิวลงพื้นที่ตรวจประเมิน + มอบหมายผู้ตรวจ'),
    ('sac_field_audit',    'AUDIT_CONFIRMED',           'FIELD_AUDIT',    'auditor',
     0, 'ลงพื้นที่ตรวจประเมิน', 'Field Audit',
     'ลงพื้นที่ตรวจประเมินตามวันที่กำหนด'),
    ('sac_car_review',     'CAR_REVIEWING',             'CAR_REVIEW',     'auditor',
     0, 'ตรวจ CAR ที่ผู้สมัครส่งกลับ', 'CAR Review',
     'ทบทวน Corrective Action Report ที่ผู้สมัครส่งกลับ'),
    ('sac_final_approval', 'AUDIT_PASSED',              'FINAL_APPROVAL', 'auditor',
     0, 'อนุมัติออกใบรับรอง', 'Final Approval',
     'พิจารณาขั้นสุดท้าย กดอนุมัติออกใบรับรอง');

-- ──────────────────────────────────────────────────────────────────────────
-- Seed: sla_policies (defaults from RoleJobDescription.slaTargets pattern)
-- ──────────────────────────────────────────────────────────────────────────
INSERT INTO "sla_policies"
    ("id", "workType", "targetHours", "warningHours", "escalationHours",
     "labelTH", "labelEN")
VALUES
    ('sla_slip_review',     'SLIP_REVIEW',      24,  16,  48,
     'ตรวจสลิป',           'Review Payment Slip'),
    ('sla_scheduling',      'SCHEDULING',       24,  16,  48,
     'จัดคิว/มอบหมาย',     'Scheduling / Assignment'),
    ('sla_doc_review',      'DOC_REVIEW',       72,  48,  120,
     'ตรวจเอกสาร',         'Document Review'),
    ('sla_field_audit',     'FIELD_AUDIT',      336, 240, 504,
     'ตรวจประเมินภาคสนาม', 'Field Audit'),
    ('sla_car_review',      'CAR_REVIEW',       72,  48,  120,
     'ตรวจ CAR',           'CAR Review'),
    ('sla_final_approval',  'FINAL_APPROVAL',   24,  16,  48,
     'อนุมัติขั้นสุดท้าย',  'Final Approval'),
    ('sla_receipt_issue',   'RECEIPT_ISSUE',    24,  16,  48,
     'ออกใบเสร็จ',         'Issue Receipt');

COMMIT;
