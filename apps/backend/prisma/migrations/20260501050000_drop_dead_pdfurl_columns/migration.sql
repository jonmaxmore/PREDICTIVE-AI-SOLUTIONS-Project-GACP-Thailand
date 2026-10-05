-- Wave A Phase 39 — drop the two `pdfUrl` columns flagged as dead during
-- the G1 consumer migration sweep (Phases 33-38).
--
-- Pre-migration verification (run on prod 2026-05-01):
--   SELECT COUNT(*) FROM sop_documents WHERE "pdfUrl" IS NOT NULL;  → 0
--   SELECT COUNT(*) FROM sop_documents;                              → 0 (empty table)
--   SELECT COUNT(*) FROM certificates  WHERE "pdfUrl" IS NOT NULL;  → 0
--   SELECT COUNT(*) FROM certificates;                               → 13
--
-- Both columns were declared in the schema but never written. The
-- certificate-template-service generates PDFs on-demand into a Buffer
-- response; nothing persists pdfUrl. SOPDocument has no PDF generator
-- at all today.
--
-- Reader impact:
--   - Certificate: web-app/.../official-documents/client-view.tsx reads
--     `cert.pdfUrl || undefined`. After this migration the field is
--     simply absent from the API response, which the `|| undefined`
--     fallback handles transparently. Behavior identical (always
--     undefined either way).
--   - SOPDocument: zero frontend or backend readers found.
--
-- IF EXISTS guards make the migration idempotent against an already-dropped
-- column.

ALTER TABLE "certificates"  DROP COLUMN IF EXISTS "pdfUrl";
ALTER TABLE "sop_documents" DROP COLUMN IF EXISTS "pdfUrl";
