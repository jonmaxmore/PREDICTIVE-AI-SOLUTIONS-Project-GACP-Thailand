-- M2a EXPAND — requirement_rules: the list of mandatory documents stops being
-- code and becomes dated data (operator ruling G2, 2026-08-15; spec
-- design note 2026-08-15-membership-m2-documents-and-poa-design §3).
--
-- EXPAND only (guidance §4): a NEW table beside everything that exists. No
-- column altered, no row of any other table touched, nothing dropped. The four
-- older definitions of "mandatory documents" keep working untouched during the
-- window; this table is what the submit gate starts reading (M2a Task 4).
--
-- APPEND-ONLY table. A rule that has ever been in force is the law an
-- application was judged by on its filing date, so no writer may rewrite a row
-- body — a change is: close the old row (effectiveTo/closedBy/closedAt) and
-- INSERT a new one. Enforced in services/requirement-rule-service.js (M2a Task 2),
-- which exposes no updateRule at all; there is no updatedAt column here because
-- nothing about a rule body is meant to move.
--
-- NO organizationId: national ministry policy, not tenant configuration — same
-- shape as certification_standards.
--
-- Idempotent: CREATE TABLE / INDEX IF NOT EXISTS, and the seed uses fixed ids
-- with ON CONFLICT ("id") DO NOTHING (template: migration
-- 20260805100000_add_correction_submission_versions). A re-run inserts nothing
-- and, critically, does NOT overwrite a row the ministry has since closed or
-- superseded — DO NOTHING, never DO UPDATE.
--
-- Rollback (manual):
--   DROP TABLE IF EXISTS "requirement_rules";

BEGIN;

CREATE TABLE IF NOT EXISTS "requirement_rules" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Dimensions — NULL means "every value of this dimension".
  -- holderType: entities.type (INDIVIDUAL | JURISTIC | COMMUNITY_ENTERPRISE)
  -- requestType: NEW | RENEWAL | REPLACEMENT (constants/document-slots.js)
  "holderType" TEXT,
  "requestType" TEXT,
  "plantCode" TEXT,

  -- Central document slot in CANONICAL form (getCanonicalSlotId,
  -- routes/api/applications/validation-slot-utils.js) — e.g. 'company_reg'.
  "slotId" TEXT NOT NULL,
  "isRequired" BOOLEAN NOT NULL DEFAULT true,

  -- G4 freshness budget in months; inert until the vault lands (M2b).
  "maxDocumentAgeMonths" INTEGER,

  -- Effective dating — effectiveTo NULL = still in force.
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveTo" TIMESTAMP(3),

  -- Provenance: the reason travels on the row, so a closed rule still explains
  -- itself even when read far from its audit entry.
  "createdBy" TEXT NOT NULL,
  "reason" TEXT,
  "closedBy" TEXT,
  "closedAt" TIMESTAMP(3),

  CONSTRAINT "requirement_rules_pkey" PRIMARY KEY ("id")
);

-- Read path of the gate: "which rules mention this slot".
CREATE INDEX IF NOT EXISTS "requirement_rules_slotId_idx"
  ON "requirement_rules"("slotId");

-- Read path of rulesAt(): effectiveFrom <= at AND (effectiveTo IS NULL OR effectiveTo > at).
CREATE INDEX IF NOT EXISTS "requirement_rules_effectiveFrom_effectiveTo_idx"
  ON "requirement_rules"("effectiveFrom", "effectiveTo");

-- Founding rules (spec §3 "seed ชุดแรก" — the set the operator settled on):
-- JURISTIC -> company_reg, COMMUNITY_ENTERPRISE -> community_cert, INDIVIDUAL
-- gets nothing extra. Fixed ids: they are what makes the seed re-runnable and
-- what lets an admin close exactly this rule later instead of guessing.
-- maxDocumentAgeMonths = 6 is the starting value taken from the usual practice
-- for Thai government certificates — it is DATA and the ministry changes it
-- through the admin API (M2a Task 3), never through a deploy.
INSERT INTO "requirement_rules" ("id","holderType","requestType","plantCode","slotId","isRequired","maxDocumentAgeMonths","effectiveFrom","effectiveTo","createdBy","reason","createdAt")
VALUES
('m2a-seed-juristic-company-reg', 'JURISTIC', NULL, NULL, 'company_reg', TRUE, 6, '2026-08-15T00:00:00Z', NULL, 'SYSTEM-M2A-SEED', 'คำวินิจฉัย operator 2026-08-15 (G-grill): นิติบุคคลแนบหนังสือรับรอง DBD', NOW()),
('m2a-seed-community-cert',      'COMMUNITY_ENTERPRISE', NULL, NULL, 'community_cert', TRUE, 6, '2026-08-15T00:00:00Z', NULL, 'SYSTEM-M2A-SEED', 'คำวินิจฉัย operator 2026-08-15 (G-grill): วิสาหกิจชุมชนแนบเอกสารรับรองการจดทะเบียน', NOW())
ON CONFLICT ("id") DO NOTHING;

COMMIT;
