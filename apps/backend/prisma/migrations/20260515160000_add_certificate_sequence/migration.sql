-- ✅ System deep-dive fix Compliance H-2 (2026-05-15):
-- Certificate number race-condition fix.
--
-- The previous certificate-number generator did:
--   `const count = await prisma.certificate.count() + 1;`
-- This is NOT atomic with the subsequent `prisma.certificate.create()`.
-- Two concurrent APPROVED-application transitions could both read the same
-- count, compute the same next number, and race to create. The unique
-- index would catch one as a P2002 — but only AFTER both DB rounds — and
-- duplicate `GACP-TH-YYYY-NNNNN` strings have appeared in stress tests.
-- A duplicate DTAM-issued certificate number is a legal defect with no
-- recovery path once published to the applicant.
--
-- This migration creates a Postgres SEQUENCE — atomic nextval allocation
-- per the database engine's transaction-isolation semantics. The
-- certificate-service.js change uses `SELECT nextval('gacp_certificate_seq')`
-- which is guaranteed to return a unique increasing value even under
-- arbitrary concurrent callers.
--
-- Starting value: 1. If the database already has N certificates, the next
-- nextval() will return N+1 (advance the sequence post-migration via
-- `SELECT setval('gacp_certificate_seq', (SELECT COUNT(*) FROM "certificates"))`
-- in the deployment runbook).

CREATE SEQUENCE IF NOT EXISTS gacp_certificate_seq
    START WITH 1
    INCREMENT BY 1
    NO MAXVALUE
    NO CYCLE;

-- Initialize sequence to current certificate count (idempotent — does nothing
-- if there are no existing certificates).
SELECT setval(
    'gacp_certificate_seq',
    GREATEST(1, (SELECT COUNT(*) FROM "certificates"))
);
