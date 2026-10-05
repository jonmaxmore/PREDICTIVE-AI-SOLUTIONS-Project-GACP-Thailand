-- Q1 lane separation (owner ruling 2026-07-08): the once-per-application
-- limit applies to LENIENCY reopens ONLY. A WRONGFUL_EXPIRY reinstate is the
-- platform correcting its own bug — it must NOT consume the farmer's single
-- leniency chance ("แพลตฟอร์มต้องไม่ได้กำไรจาก bug ตัวเอง"; the farmer did
-- nothing wrong). Narrow the APPROVED partial unique to reasonCode='LENIENCY'.
-- The one-open-PENDING unique is unchanged (still one open request at a time).
--
-- Idempotent — safe to re-run.

DROP INDEX IF EXISTS "uniq_waiver_reopen_approved_per_app";

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_waiver_reopen_leniency_per_app"
    ON "waiver_reopen_requests"("applicationId")
    WHERE "status" = 'APPROVED' AND "reasonCode" = 'LENIENCY';
