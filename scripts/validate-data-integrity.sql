-- ═══════════════════════════════════════════════════════════════
-- GACP Data Integrity Validation Script
-- Run: docker exec gacp-postgres psql -U gacp -d gacp_db -f /tmp/validate-data-integrity.sql
-- ═══════════════════════════════════════════════════════════════

-- 1. Check state ↔ status sync (should return 0 rows)
\echo '── 1. State ↔ Status Drift ──'
SELECT id, "applicationNumber", status, state
FROM applications
WHERE status IS DISTINCT FROM state
LIMIT 20;

-- 2. Check for duplicate canonicalId (should return 0 rows)
\echo '── 2. Duplicate canonicalId ──'
SELECT "canonicalId", count(*) AS cnt
FROM users
WHERE "canonicalId" IS NOT NULL
GROUP BY "canonicalId"
HAVING count(*) > 1;

-- 3. Check orphaned applications (healthId → users.canonicalId, should return 0)
\echo '── 3. Orphaned Applications ──'
SELECT a.id, a."applicationNumber", a."healthId"
FROM applications a
LEFT JOIN users u ON a."healthId" = u."canonicalId"
WHERE u.id IS NULL
LIMIT 20;

-- 4. Check users without canonicalId (should return 0)
\echo '── 4. Users Missing canonicalId ──'
SELECT id, email, "nationalId"
FROM users
WHERE "canonicalId" IS NULL OR "canonicalId" = ''
LIMIT 10;

-- 5. Summary counts
\echo '── 5. Summary Counts ──'
SELECT 'users' AS entity, count(*) AS total FROM users
UNION ALL
SELECT 'applications', count(*) FROM applications
UNION ALL
SELECT 'certificates', count(*) FROM certificates
UNION ALL
SELECT 'invoices', count(*) FROM invoices;

-- 6. Application state distribution
\echo '── 6. Application State Distribution ──'
SELECT state, count(*) AS total
FROM applications
GROUP BY state
ORDER BY total DESC;

\echo '✅ Data integrity validation complete'
