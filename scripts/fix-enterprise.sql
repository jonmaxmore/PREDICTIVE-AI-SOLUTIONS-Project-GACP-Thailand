-- ================================================================
-- GACP Enterprise Data Integrity & Sync
-- Run on production: docker exec -i gacp-postgres psql -U gacp -d gacp_db < /tmp/fix-enterprise.sql
-- ================================================================

-- ═══════════════════════════════════════════════════════════════════
-- 1. STATE ↔ STATUS SYNC TRIGGER
-- Keeps 'status' in sync whenever 'state' changes (or vice versa)
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION sync_app_state_status() RETURNS TRIGGER AS $$
BEGIN
  -- If state changed, sync to status
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    NEW.status = NEW.state;
  -- If status changed (legacy code), sync to state
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.state = NEW.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_app_state_status ON applications;
CREATE TRIGGER trg_sync_app_state_status
  BEFORE UPDATE ON applications
  FOR EACH ROW
  EXECUTE FUNCTION sync_app_state_status();

-- ═══════════════════════════════════════════════════════════════════
-- 2. SYNC EXISTING ROWS (state = status for all)
-- ═══════════════════════════════════════════════════════════════════
UPDATE applications SET state = status WHERE state != status;

-- ═══════════════════════════════════════════════════════════════════
-- 3. DATA INTEGRITY CHECKS (reports only, no modifications)
-- ═══════════════════════════════════════════════════════════════════

-- 3a. Duplicate canonicalId
SELECT 'DUPLICATE_CANONICAL_ID' AS check_name,
       "canonicalId", count(*) AS count
FROM users
GROUP BY "canonicalId"
HAVING count(*) > 1;

-- 3b. Orphaned applications (healthId points to non-existent user)
SELECT 'ORPHAN_APPLICATION' AS check_name,
       a.id AS application_id,
       a."healthId" AS orphan_health_id
FROM applications a
LEFT JOIN users u ON a."healthId" = u."canonicalId"
WHERE u.id IS NULL
LIMIT 10;

-- 3c. State/status mismatch (should be 0 after sync above)
SELECT 'STATE_STATUS_MISMATCH' AS check_name,
       count(*) AS mismatched_rows
FROM applications
WHERE state != status;

-- 3d. Users without canonicalId
SELECT 'NULL_CANONICAL_ID' AS check_name,
       count(*) AS null_count
FROM users
WHERE "canonicalId" IS NULL;
