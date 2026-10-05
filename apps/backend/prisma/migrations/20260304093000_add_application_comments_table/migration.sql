-- Create missing ApplicationComment table used by workflow history/detail endpoints
CREATE TABLE IF NOT EXISTS "application_comments" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applicationId" TEXT NOT NULL,
    "auditorId" TEXT NOT NULL,
    "commentText" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "attachments" JSONB,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,

    CONSTRAINT "application_comments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "application_comments_applicationId_idx" ON "application_comments"("applicationId");
CREATE INDEX IF NOT EXISTS "application_comments_auditorId_idx" ON "application_comments"("auditorId");
CREATE INDEX IF NOT EXISTS "application_comments_type_idx" ON "application_comments"("type");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_name = 'application_comments_applicationId_fkey'
          AND table_name = 'application_comments'
    ) THEN
        ALTER TABLE "application_comments"
        ADD CONSTRAINT "application_comments_applicationId_fkey"
        FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;