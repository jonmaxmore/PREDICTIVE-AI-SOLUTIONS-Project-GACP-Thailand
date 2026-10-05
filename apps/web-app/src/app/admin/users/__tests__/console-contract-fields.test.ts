/**
 * P0-B — /admin/users console FE↔BE field contract (source-scan pin).
 *
 * The page reads `isActive`, `isLocked`, `username`, `lastLoginAt` from
 * every row, but the backend mapUser (routes/api/admin/users.js) emitted
 * NONE of them — `isActive` came back undefined → falsy → every row
 * rendered "ถูกระงับ", KPI counters were wrong, and UserDisableModal
 * (isActive ? disable : enable) always called enable → 409 ALREADY_ACTIVE.
 * Disable was impossible from this page while unit mocks stayed green.
 *
 * This test pins the FE field reads against the BE mapUser source (same
 * fs-scan pattern as provider/scheduler/reassign/__tests__/
 * reassign-route-contract.test.ts) so the class cannot silently drift.
 */

import fs from 'fs';
import path from 'path';

const read = (p: string) => fs.readFileSync(p, 'utf8');

const PAGE = path.resolve(__dirname, '..', 'page.tsx');
// __tests__ → users → admin → app → src → web-app → apps
const APPS_DIR = path.resolve(__dirname, '../../../../../..');
const BE_USERS = path.join(APPS_DIR, 'backend/routes/api/admin/users.js');

// The row fields page.tsx actually renders / branches on.
const FIELDS_FE_READS = ['isActive', 'isLocked', 'username', 'lastLoginAt'] as const;

describe('P0-B — /admin/users page reads only fields the BE mapUser emits', () => {
    const pageSrc = read(PAGE);
    const beSrc = read(BE_USERS);

    // Slice the mapUser function body so a field name appearing elsewhere in
    // the route file (e.g. a WHERE clause) cannot satisfy the pin.
    const mapUserStart = beSrc.indexOf('function mapUser(');
    const mapUserEnd = beSrc.indexOf('async function writeAdminUserAudit');
    const mapUserSrc = beSrc.slice(mapUserStart, mapUserEnd);

    test('BE mapUser exists and is sliceable', () => {
        expect(mapUserStart).toBeGreaterThan(-1);
        expect(mapUserEnd).toBeGreaterThan(mapUserStart);
    });

    test.each(FIELDS_FE_READS)('page.tsx reads %s → mapUser must emit it', (field) => {
        // Guard the premise: the page really does read this field.
        expect(pageSrc).toContain(field);
        // The contract: mapUser emits it.
        expect(mapUserSrc).toContain(field);
    });

    test('the FE service row type matches (AdminUserRow declares the fields)', () => {
        const SERVICE = path.join(
            APPS_DIR,
            'web-app/src/lib/services/admin-service-b28.ts',
        );
        const serviceSrc = read(SERVICE);
        for (const field of FIELDS_FE_READS) {
            expect(serviceSrc).toContain(field);
        }
    });
});
