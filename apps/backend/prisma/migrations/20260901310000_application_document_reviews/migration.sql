-- กทล.๑ ส่วนสำหรับเจ้าหน้าที่ ข้อ ๑.๑ — per-slot document verdicts.
--
-- ADDITIVE ONLY: one new table, no column touched on any existing one, so this
-- can be applied to a running deployment and rolled back by dropping the table.
-- Hand-written (never `prisma migrate dev`) because the demo database is shared
-- with production and a reset there is unrecoverable.
--
-- The CHECK constraints mirror the frozen JS vocabularies exactly, which is the
-- pattern every other state column here follows (executive decision R1): a
-- String plus a CHECK, rather than a Postgres enum whose ALTER TYPE cannot run
-- inside a transaction.

CREATE TABLE IF NOT EXISTS "application_document_reviews" (
    "id"              TEXT NOT NULL,
    "applicationId"   TEXT NOT NULL,
    "slot_id"         TEXT NOT NULL,
    "verdict"         TEXT NOT NULL,
    "reason"          TEXT,
    "due_date"        TIMESTAMP(3),
    "reviewer_id"     TEXT NOT NULL,
    "round"           INTEGER NOT NULL DEFAULT 1,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organization_id" TEXT NOT NULL,

    CONSTRAINT "application_document_reviews_pkey" PRIMARY KEY ("id"),

    -- The closed vocabulary, in the database as well as in JS.
    CONSTRAINT "application_document_reviews_verdict_check"
        CHECK ("verdict" IN ('ACCEPTED', 'MORE_REQUESTED')),

    -- A request the applicant cannot act on is a rejection wearing the wrong
    -- name. The service refuses it too; this is the backstop for any writer that
    -- does not go through the service.
    CONSTRAINT "application_document_reviews_reason_when_more_check"
        CHECK ("verdict" <> 'MORE_REQUESTED' OR ("reason" IS NOT NULL AND length(btrim("reason")) >= 10)),

    CONSTRAINT "application_document_reviews_due_when_more_check"
        CHECK ("verdict" <> 'MORE_REQUESTED' OR "due_date" IS NOT NULL),

    CONSTRAINT "application_document_reviews_round_check" CHECK ("round" >= 1)
);

-- One verdict per slot per round. A later round writes a new row rather than
-- overwriting the record of what was asked the first time.
CREATE UNIQUE INDEX IF NOT EXISTS "application_document_reviews_app_slot_round_key"
    ON "application_document_reviews" ("applicationId", "slot_id", "round");

CREATE INDEX IF NOT EXISTS "application_document_reviews_application_idx"
    ON "application_document_reviews" ("applicationId");

CREATE INDEX IF NOT EXISTS "application_document_reviews_application_round_idx"
    ON "application_document_reviews" ("applicationId", "round");

-- Guarded, because every CREATE above is `IF NOT EXISTS` and a bare ADD CONSTRAINT
-- is not: applying this file twice by hand aborted here with "constraint already
-- exists" while the rest of the file sailed through. `prisma migrate deploy` never
-- re-runs a recorded migration, so this only bit a hand-applied re-run — which is
-- exactly what the header above invites ("can be applied to a running deployment").
-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, hence the DO block.
-- Proved on a throwaway Postgres 15 (same image as the staging container):
-- evidence/migrations/20260901310000-applied-on-scratch.md
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'application_document_reviews_applicationId_fkey'
          AND conrelid = '"application_document_reviews"'::regclass
    ) THEN
        ALTER TABLE "application_document_reviews"
            ADD CONSTRAINT "application_document_reviews_applicationId_fkey"
            FOREIGN KEY ("applicationId") REFERENCES "applications"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'application_document_reviews_organization_id_fkey'
          AND conrelid = '"application_document_reviews"'::regclass
    ) THEN
        ALTER TABLE "application_document_reviews"
            ADD CONSTRAINT "application_document_reviews_organization_id_fkey"
            FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END
$$;
