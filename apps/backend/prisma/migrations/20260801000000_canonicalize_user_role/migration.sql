-- Canonicalise users.role — lowercase AND alias-collapsed, matching
-- CANONICAL_ROLES (apps/backend/shared/canonical-rbac.js) exactly.
--
-- WHY: users.role is the RAW column (auth.prisma:104, @default('HEALTH')).
-- Every read path today calls normalizeRole() to translate it, and every write
-- path calls canonicalToLegacyRole() to translate BACK. This migration removes
-- the round trip: after it, users.role IS the canonical value.
--
-- The mapping table below is a byte-for-byte mirror of
-- apps/backend/shared/role-migration-map.js (which itself derives from
-- ROLE_ALIASES). __tests__/unit/role-migration-map.test.js pins the JS side;
-- scripts/verify-role-canonicalization.js pins that SQL and JS agree against a
-- live DB, before and after.
--
-- SAFETY POSTURE: a role we cannot map is NOT guessed. A wrong guess either
-- resurrects a dead account (COORDINATOR) or escalates privilege (EXECUTIVE),
-- and neither fails loudly at runtime. The migration ABORTS instead and names
-- the offending values so ops resolves them explicitly.
--
-- IDEMPOTENT: the mapping is closed (mapRawRole(target) === target for every
-- target), so re-running is a no-op. Safe to run twice.

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. The mapping table. lower(trim(raw)) -> canonical.
--    ON COMMIT DROP so a re-run rebuilds it cleanly.
-- ──────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE _role_map (raw TEXT PRIMARY KEY, canonical TEXT NOT NULL)
    ON COMMIT DROP;

INSERT INTO _role_map (raw, canonical) VALUES
    -- ADMIN
    ('admin',               'admin'),
    ('super_admin',         'admin'),
    -- PLATFORM_ADMIN (cross-tenant operator, ADR-014 / SEC-PROV-001)
    ('platform_admin',      'platform_admin'),
    ('platform_owner',      'platform_admin'),
    -- SCHEDULER
    ('scheduler',           'scheduler'),
    -- DOCUMENT_REVIEWER
    ('reviewer',            'document_reviewer'),
    ('reviewer_auditor',    'document_reviewer'),
    ('document_reviewer',   'document_reviewer'),
    -- AUDITOR (HEAD_AUDITOR/approver/final_approver consolidated here)
    ('auditor',             'auditor'),
    ('inspector',           'auditor'),
    ('audit',               'auditor'),
    ('head_auditor',        'auditor'),
    ('approver',            'auditor'),
    ('final_approver',      'auditor'),
    -- ACCOUNT_DTAM  (Tier 16 split — STATE-side slips)
    ('account_dtam',        'account_dtam'),
    ('accountant_dtam',     'account_dtam'),
    ('dtam_account',        'account_dtam'),
    ('finance_dtam',        'account_dtam'),
    -- ACCOUNT_PLATFORM (Tier 16 split — PLATFORM-side slips)
    ('account_platform',    'account_platform'),
    ('accountant_platform', 'account_platform'),
    ('platform_account',    'account_platform'),
    ('finance_platform',    'account_platform'),
    -- ACCOUNT (legacy, pre-split). Deliberately NOT resolved to a side here —
    -- scripts/migrate-account-role.js owns that decision so finance-ops can
    -- review who lands DTAM-side before any slip is touched.
    ('account',             'account'),
    ('accountant',          'account'),
    ('finance',             'account'),
    -- HEALTH
    ('health',              'health'),
    ('applicant',           'health'),
    -- FARMER: the ORIGINAL users.role DEFAULT (migration 20260110020726 line
    -- 24), re-cased by 20260207143000 line 17. It is NOT in ROLE_ALIASES, so
    -- normalizeRole('FARMER') is NULL today — and both consumers fall back to
    -- HEALTH (prisma-auth-service.js:336 and :473). Mapping it to 'health'
    -- preserves current behaviour exactly; leaving it would strand the rows.
    ('farmer',              'health'),
    -- SYSTEM (non-human actors: webhooks, cron)
    ('system',              'system'),
    ('webhook',             'system'),
    ('cron',                'system')
ON CONFLICT (raw) DO NOTHING;

-- ──────────────────────────────────────────────────────────────────────────
-- 2. PRE-FLIGHT GUARD — abort on any value we refuse to guess.
--    Runs BEFORE the UPDATE so the transaction rolls back untouched.
-- ──────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
    offenders TEXT;
    offender_rows BIGINT;
BEGIN
    SELECT string_agg(x.detail, ', ' ORDER BY x.detail), COALESCE(SUM(x.n), 0)
      INTO offenders, offender_rows
    FROM (
        SELECT format('%L (%s rows)', u."role", COUNT(*)) AS detail,
               COUNT(*) AS n
        FROM "users" u
        LEFT JOIN _role_map m ON m.raw = lower(btrim(COALESCE(u."role", '')))
        WHERE m.raw IS NULL
        GROUP BY u."role"
    ) x;

    IF offender_rows > 0 THEN
        RAISE EXCEPTION
            'users.role canonicalisation ABORTED: % row(s) hold an unmappable role: %. '
            'Resolve each explicitly (see QUARANTINE_VALUES in shared/role-migration-map.js) '
            'then re-run. Known dead values: COORDINATOR (seed-gacp.js, removed 2026-07-09 — '
            'already 403 INVALID_PROVIDER_ROLE), EXECUTIVE (read-filter only, never written).',
            offender_rows, offenders;
    END IF;
END
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- 3. THE REWRITE. Touches only rows that actually change, so a second run
--    updates 0 rows and does not bump updatedAt.
--    NOTE: `updatedAt` is deliberately NOT stamped — this is a representation
--    change, not a credential change, so it must not look like a role edit in
--    the audit surface, and must not trip any updatedAt-based cache.
-- ──────────────────────────────────────────────────────────────────────────
UPDATE "users" u
SET "role" = m.canonical
FROM _role_map m
WHERE m.raw = lower(btrim(COALESCE(u."role", '')))
  AND u."role" IS DISTINCT FROM m.canonical;

-- ──────────────────────────────────────────────────────────────────────────
-- 4. Column default. 'HEALTH' -> 'health' so newly-inserted rows that omit
--    the column are canonical too. Mirrors auth.prisma `@default("health")`.
-- ──────────────────────────────────────────────────────────────────────────
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'health';

-- ──────────────────────────────────────────────────────────────────────────
-- 5. role_groups: add the canonical codes the ADR-016 seed never created.
--    listGroupMemberUserIds() resolves a group code -> role_groups.id; without
--    these rows platform_admin / account_dtam / account_platform / health group
--    lookups silently return [] (no exception).
-- ──────────────────────────────────────────────────────────────────────────
--    "updatedAt" MUST be supplied explicitly. The table was created with
--    DEFAULT CURRENT_TIMESTAMP on it (20260430180000), which is why the
--    original seed INSERT could omit it — but 20260502000000_reconcile_drift
--    line 259 DROPPED that default to match Prisma's `@updatedAt` (which is
--    an ORM-level concern with no database default). The column is still NOT
--    NULL, so an INSERT that omits it now fails. "createdAt" kept its default.
INSERT INTO "role_groups" ("id", "code", "titleTH", "titleEN", "updatedAt") VALUES
    ('rg_platform_admin',   'platform_admin',   'ผู้ดูแลแพลตฟอร์ม',   'Platform Administrator', CURRENT_TIMESTAMP),
    ('rg_account_dtam',     'account_dtam',     'บัญชีกรมฯ',           'DTAM Accountant',        CURRENT_TIMESTAMP),
    ('rg_account_platform', 'account_platform', 'บัญชีแพลตฟอร์ม',     'Platform Accountant',    CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- ──────────────────────────────────────────────────────────────────────────
-- 6. VERIFICATION — fails loudly if ANY row is left non-canonical.
--    This is the gate: the transaction cannot COMMIT unless it passes.
-- ──────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
    bad_rows   BIGINT;
    bad_sample TEXT;
    total_rows BIGINT;
    dist       TEXT;
BEGIN
    SELECT COUNT(*), string_agg(DISTINCT format('%L', "role"), ', ')
      INTO bad_rows, bad_sample
    FROM "users"
    WHERE "role" IS NULL
       OR "role" <> lower(btrim("role"))
       OR "role" NOT IN (
            'admin', 'platform_admin', 'scheduler', 'document_reviewer',
            'auditor', 'account_dtam', 'account_platform', 'account',
            'health', 'system'
          );

    IF bad_rows > 0 THEN
        RAISE EXCEPTION
            'VERIFICATION FAILED: % users.role row(s) are not canonical: %',
            bad_rows, bad_sample;
    END IF;

    -- Belt and braces: the JS side must agree that every surviving value is a
    -- fixed point of normalizeRole(). Equivalent SQL assertion: re-mapping any
    -- surviving value through _role_map must return the value unchanged.
    SELECT COUNT(*) INTO bad_rows
    FROM "users" u
    JOIN _role_map m ON m.raw = u."role"
    WHERE m.canonical <> u."role";

    IF bad_rows > 0 THEN
        RAISE EXCEPTION
            'VERIFICATION FAILED: % row(s) are not a FIXED POINT of the map '
            '(the migration is not idempotent — do not commit)', bad_rows;
    END IF;

    SELECT COUNT(*) INTO total_rows FROM "users";
    SELECT string_agg(format('%s=%s', r, n), ' ' ORDER BY r) INTO dist
    FROM (SELECT "role" AS r, COUNT(*) AS n FROM "users" GROUP BY "role") d;

    RAISE NOTICE 'users.role canonicalisation OK — % rows. Distribution: %',
                 total_rows, dist;
END
$$;

COMMIT;
