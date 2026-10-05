-- กทล.1 case dimensions on the append-only rule table (spec 2026-09-01 §2.1).
-- NULL keeps the existing wildcard semantics; no existing row changes meaning.
ALTER TABLE "requirement_rules" ADD COLUMN "landTenure" TEXT;
ALTER TABLE "requirement_rules" ADD COLUMN "areaType" TEXT;
ALTER TABLE "requirement_rules" ADD COLUMN "certScope" TEXT;
