'use strict';

/**
 * W4 (2026-08-22) — the wizard was unusable for every seeded applicant.
 *
 * SYMPTOM (view-in-the-loop walk, reports/design-cleanup-2026-08-21/wizard-walk):
 *   POST /api/applications/draft-documents returned 400 VALIDATION_ERROR
 *   "Failed to upload draft document" for EVERY file, so wizard steps 2 and 4
 *   could never validate and steps 5-9 were unreachable. GET /api/entities/mine
 *   returned `data: []`, so the applicant step also showed a permanent
 *   "โหลดพื้นที่ทำงานไม่สำเร็จ" banner.
 *
 * CHAIN (all four links pinned below):
 *   1. prisma/seed-gacp.js wrote `role: 'HEALTH'` — a LEGACY spelling that
 *      migration 20260801000000 removed from the column. Commit b4ac86bf
 *      ("Narrow role filters to canonical-only") fixed the two writers it knew
 *      re-dirtied the column but never looked in prisma/, so the seed kept
 *      writing the legacy value.
 *   2. The seed also creates no personal INDIVIDUAL Entity, breaking the
 *      Wave-B Phase-68 invariant ("every health user has one") that the whole
 *      application-creation path depends on.
 *   3. entity-service.listMembershipsForUserWithHeal compared the RAW column
 *      value against CANONICAL_ROLES.HEALTH, so the lazy self-heal that exists
 *      precisely for users created outside registration skipped seeded users.
 *   4. With no entity, findOrCreateApplicationForHealth refuses to create the
 *      draft (applications.js, M1 2026-08-15) with a bare VALIDATION_ERROR —
 *      a code that names neither the cause nor the fix, which is why the wire
 *      response was undiagnosable.
 *
 * These are static-source + catalog guards (no DB, no seed execution); the
 * behavioural heal guard is pinned in entity-mine-self-heal.test.js.
 */

const fs = require('fs');
const path = require('path');

const { CANONICAL_ROLES, normalizeRole } = require('../../shared/canonical-rbac');
const { DEFAULT_ERROR_MESSAGES } = require('../../shared/api-response');
const { ERROR_CODES } = require('../../shared/error-codes');

const BACKEND_ROOT = path.join(__dirname, '../..');

function readCode(rel) {
    return fs.readFileSync(path.join(BACKEND_ROOT, rel), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** A quoted value that IS a role but is NOT spelled canonically. */
function isLegacyRoleSpelling(value) {
    const canonical = normalizeRole(value);
    return Boolean(canonical) && canonical !== value;
}

describe('seed-gacp.js writes canonical role values (link 1)', () => {
    const source = readCode('prisma/seed-gacp.js');

    test('no `role:` literal in the seed is a legacy spelling', () => {
        const offenders = [...source.matchAll(/\brole\s*:\s*'([^']*)'/g)]
            .map((m) => m[1])
            .filter(isLegacyRoleSpelling);
        expect(offenders).toEqual([]);
    });

    test('the applicant rows are seeded as the canonical HEALTH role', () => {
        const applicantBlock = source.match(/for \(const a of APPLICANTS\)[\s\S]*?\n {4}\}/);
        expect(applicantBlock).not.toBeNull();
        // Resolve either spelling the source may use: a bare canonical literal
        // or a CANONICAL_ROLES.X reference. Comparing VALUES survives a
        // stylistic change and still fails on a wrong role.
        const values = [
            ...[...applicantBlock[0].matchAll(/\brole\s*:\s*'([^']*)'/g)].map((m) => m[1]),
            ...[...applicantBlock[0].matchAll(/\brole\s*:\s*CANONICAL_ROLES\.([A-Z_]+)/g)]
                .map((m) => CANONICAL_ROLES[m[1]]),
        ].filter(Boolean);
        expect(values).toContain(CANONICAL_ROLES.HEALTH);
    });

    test('re-running the seed repairs an already-dirty role column — through the guard', () => {
        // Every DB seeded before W4 holds the legacy value, so a re-seed has to
        // repair it or the fix never reaches those rows. It must NOT do that
        // via the upsert's `update:` clause: that write is unconditional and
        // would revert a migrated ACCOUNT_DTAM / ACCOUNT_PLATFORM row to the
        // legacy union role (W4 review round). The repair goes through
        // repairSeededUserRow, which only rewrites a legacy SPELLING of the
        // same canonical role — pinned in
        // role-spelling-repair-never-reverts-a-split.test.js.
        const applicantBlock = source.match(/for \(const a of APPLICANTS\)[\s\S]*?\n {4}\}/);
        expect(applicantBlock).not.toBeNull();
        const updateClause = applicantBlock[0].match(/update\s*:\s*\{[^}]*\}/);
        expect(updateClause).not.toBeNull();
        expect(updateClause[0]).not.toMatch(/\brole\s*:/);
        expect(applicantBlock[0]).toMatch(/repairSeededUserRow\(user, CANONICAL_ROLES\.HEALTH/);
    });
});

describe('seed-gacp.js upholds the Phase-68 personal-entity invariant (link 2)', () => {
    const source = readCode('prisma/seed-gacp.js');

    test('each seeded applicant gets their personal INDIVIDUAL entity', () => {
        // Registration is the only other caller; a seeded applicant that never
        // gets one cannot create an application draft at all.
        expect(source).toMatch(/ensurePersonalIndividualEntity\s*\(/);
        const applicantBlock = source.match(/for \(const a of APPLICANTS\)[\s\S]*?\n {4}\}/);
        expect(applicantBlock).not.toBeNull();
        expect(applicantBlock[0]).toMatch(/ensurePersonalIndividualEntity\s*\(/);
    });
});

describe('the entity-missing refusal names its cause on the wire (link 4)', () => {
    const source = readCode('routes/api/applications/applications.js');

    test('findOrCreateApplicationForHealth throws a specific code, not bare VALIDATION_ERROR', () => {
        const guard = source.match(/if \(!seedEntityId\) \{[\s\S]*?\n {4}\}/);
        expect(guard).not.toBeNull();
        expect(guard[0]).toMatch(/err\.code = 'APPLICANT_ENTITY_MISSING'/);
    });

    test('the code carries a Thai default message (not the internal-error fallback)', () => {
        // sendErrorResponse falls back to INTERNAL_SERVER_ERROR's Thai for any
        // code missing from this map — i.e. a plain 400 would tell the farmer
        // "เกิดข้อผิดพลาดภายในระบบ", which is untrue and unactionable.
        expect(DEFAULT_ERROR_MESSAGES.APPLICANT_ENTITY_MISSING).toBeDefined();
        expect(typeof DEFAULT_ERROR_MESSAGES.APPLICANT_ENTITY_MISSING.th).toBe('string');
        expect(DEFAULT_ERROR_MESSAGES.APPLICANT_ENTITY_MISSING.th.length).toBeGreaterThan(0);
        expect(DEFAULT_ERROR_MESSAGES.APPLICANT_ENTITY_MISSING.th)
            .not.toBe(DEFAULT_ERROR_MESSAGES.INTERNAL_SERVER_ERROR.th);
    });

    test('the code is catalogued', () => {
        expect(ERROR_CODES.APPLICANT_ENTITY_MISSING).toBeDefined();
        expect(ERROR_CODES.APPLICANT_ENTITY_MISSING.httpStatus).toBe(400);
    });
});
