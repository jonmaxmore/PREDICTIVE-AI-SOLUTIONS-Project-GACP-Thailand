-- Document pre-check (2026-09-27 design, §2/§8) — Task 5 data model.
--
-- ADDITIVE ONLY: two new tables + one new nullable column on an existing
-- table; no existing column is touched. Can be applied to a running
-- deployment and rolled back by dropping the new tables / column.
-- Hand-written (never `prisma migrate dev`) — same reason as
-- 20260901310000_application_document_reviews: the demo database is shared
-- with production and a reset there is unrecoverable.
--
-- The CHECK constraints mirror the frozen JS vocabularies exactly (same
-- pattern as 20260901310000): a String plus a CHECK, rather than a Postgres
-- enum whose ALTER TYPE cannot run inside a transaction.
--   status        — services/document-precheck/* callers (Task 6/7), §8
--   extract_method — services/document-precheck/extract.js's `method`

CREATE TABLE IF NOT EXISTS "document_prechecks" (
    "id"                        TEXT NOT NULL,
    "organization_id"           TEXT NOT NULL,
    "applicationId"             TEXT NOT NULL,
    "document_id"               TEXT NOT NULL,
    "slot_id"                   TEXT NOT NULL,
    "status"                    TEXT NOT NULL,
    "rules_version"             INTEGER NOT NULL,
    "extract_method"            TEXT,
    "ocr_confidence"            DOUBLE PRECISION,
    "page_count"                INTEGER,
    "extracted_text"            TEXT,
    "applicant_acknowledged_at" TIMESTAMP(3),
    "created_at"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at"               TIMESTAMP(3),

    CONSTRAINT "document_prechecks_pkey" PRIMARY KEY ("id"),

    -- The closed vocabulary, in the database as well as in JS.
    CONSTRAINT "document_prechecks_status_check"
        CHECK ("status" IN ('PENDING', 'DONE', 'FAILED', 'SUPERSEDED')),

    CONSTRAINT "document_prechecks_extract_method_check"
        CHECK ("extract_method" IS NULL OR "extract_method" IN ('TEXT_LAYER', 'OCR', 'NONE'))
);

-- One precheck per live document — a re-upload gets a new
-- ApplicationDocument.documentId, so it gets a new row here too.
CREATE UNIQUE INDEX IF NOT EXISTS "document_prechecks_document_id_key"
    ON "document_prechecks" ("document_id");

CREATE INDEX IF NOT EXISTS "document_prechecks_app_slot_status_idx"
    ON "document_prechecks" ("applicationId", "slot_id", "status");

CREATE TABLE IF NOT EXISTS "document_precheck_flags" (
    "id"               TEXT NOT NULL,
    "organization_id"  TEXT NOT NULL,
    "precheck_id"      TEXT NOT NULL,
    "check"            TEXT NOT NULL,
    "result"           TEXT NOT NULL,
    "reason_th"        TEXT NOT NULL,
    "confidence"       DOUBLE PRECISION NOT NULL,
    "evidence_snippet" TEXT,

    CONSTRAINT "document_precheck_flags_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "document_precheck_flags_precheck_id_idx"
    ON "document_precheck_flags" ("precheck_id");

-- The precheck a review round was informed by, if any (§8). Nullable: a
-- review can happen with no precheck at all, and existing rows have none.
ALTER TABLE "application_document_reviews"
    ADD COLUMN IF NOT EXISTS "precheck_id" TEXT;

-- Fix round 1 (task-5-review.md Minor 3): a SET NULL on precheck delete
-- scans this table by precheck_id, and so does any "reviews by precheck"
-- read (§2 accuracy measurement).
CREATE INDEX IF NOT EXISTS "application_document_reviews_precheck_id_idx"
    ON "application_document_reviews" ("precheck_id");

-- Guarded, because every CREATE above is `IF NOT EXISTS` and a bare ADD
-- CONSTRAINT is not: applying this file twice by hand would abort here with
-- "constraint already exists" while the rest of the file sails through.
-- `prisma migrate deploy` never re-runs a recorded migration, so this only
-- bites a hand-applied re-run — same guard as 20260901310000.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'document_prechecks_organization_id_fkey'
          AND conrelid = '"document_prechecks"'::regclass
    ) THEN
        ALTER TABLE "document_prechecks"
            ADD CONSTRAINT "document_prechecks_organization_id_fkey"
            FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    -- Fix round 1 (task-5-review.md Important 1): a precheck belongs to
    -- exactly one application and cannot outlive it — added in this same
    -- migration, before the table has ever held a row, following
    -- application_document_reviews_applicationId_fkey's own pattern
    -- (application-document-review.prisma:14-15 has the identical FK).
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'document_prechecks_applicationId_fkey'
          AND conrelid = '"document_prechecks"'::regclass
    ) THEN
        ALTER TABLE "document_prechecks"
            ADD CONSTRAINT "document_prechecks_applicationId_fkey"
            FOREIGN KEY ("applicationId") REFERENCES "applications"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'document_precheck_flags_organization_id_fkey'
          AND conrelid = '"document_precheck_flags"'::regclass
    ) THEN
        ALTER TABLE "document_precheck_flags"
            ADD CONSTRAINT "document_precheck_flags_organization_id_fkey"
            FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'document_precheck_flags_precheck_id_fkey'
          AND conrelid = '"document_precheck_flags"'::regclass
    ) THEN
        ALTER TABLE "document_precheck_flags"
            ADD CONSTRAINT "document_precheck_flags_precheck_id_fkey"
            FOREIGN KEY ("precheck_id") REFERENCES "document_prechecks"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'application_document_reviews_precheck_id_fkey'
          AND conrelid = '"application_document_reviews"'::regclass
    ) THEN
        ALTER TABLE "application_document_reviews"
            ADD CONSTRAINT "application_document_reviews_precheck_id_fkey"
            FOREIGN KEY ("precheck_id") REFERENCES "document_prechecks"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END
$$;
