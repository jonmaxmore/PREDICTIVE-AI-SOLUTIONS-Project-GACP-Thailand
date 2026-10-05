/**
 * P0-C — FE↔BE route-existence contract for the auditor-reassign tool.
 *
 * The page called '/audits/reassignable' + '/audits/:id/reassign' while the
 * backend mounts the router at /audits/REASSIGN (routes/api/index.js
 * `auditConsolidated.use('/reassign', …)` → audits-reassign.js
 * GET /reassignable + POST /:id/reassign). The GET fell into audits.js
 * GET /:id → 404, so the scheduler's ONLY sick/no-show auditor swap tool
 * permanently error-toasted — and the URL-string jest mocks kept the suite
 * green. This test pins the FE literals against the BE source so the class
 * cannot silently drift again.
 */

import fs from 'fs';
import path from 'path';

const read = (p: string) => fs.readFileSync(p, 'utf8');

const PAGE = path.resolve(__dirname, '..', 'page.tsx');
// __tests__ → reassign → scheduler → provider → app → src → web-app → apps
const APPS_DIR = path.resolve(__dirname, '../../../../../../..');
const BE_INDEX = path.join(APPS_DIR, 'backend/routes/api/index.js');
const BE_REASSIGN = path.join(APPS_DIR, 'backend/routes/api/audit/audits-reassign.js');

describe('P0-C — reassign page calls the mounted BE paths', () => {
    const pageSrc = read(PAGE);

    test('FE literals target the /audits/reassign mount', () => {
        expect(pageSrc).toContain("'/audits/reassign/reassignable'");
        expect(pageSrc).toContain('`/audits/reassign/${selectedApp.id}/reassign`');
        // The dead pre-fix literals must NOT come back.
        expect(pageSrc).not.toContain("'/audits/reassignable'");
        expect(pageSrc).not.toContain('`/audits/${selectedApp.id}/reassign`');
    });

    // M2 — the auditor dropdown queried role=REVIEWER_AUDITOR, but
    // canonical-rbac maps reviewer_auditor → document_reviewer and
    // provider-directory-utils.matchesRoleFilter does exact canonical
    // equality — so AUDITOR-role staff NEVER appeared in the AUDIT
    // reassignment picker. This page reassigns audits; it must ask for
    // AUDITORs.
    test('auditor dropdown queries role=AUDITOR, not the reviewer alias', () => {
        expect(pageSrc).toContain("'/provider/directory?role=AUDITOR'");
        expect(pageSrc).not.toContain('role=REVIEWER_AUDITOR');
    });

    test('BE still mounts the reassign router where the FE points', () => {
        const indexSrc = read(BE_INDEX);
        const reassignSrc = read(BE_REASSIGN);
        // /api/audits → auditConsolidated → /reassign → audits-reassign.js
        expect(indexSrc).toMatch(/use\(\s*'\/audits'\s*,\s*auditConsolidated\s*\)/);
        expect(indexSrc).toMatch(/auditConsolidated\.use\(\s*'\/reassign'/);
        expect(reassignSrc).toMatch(/router\.get\(\s*'\/reassignable'/);
        expect(reassignSrc).toMatch(/router\.post\(\s*'\/:id\/reassign'/);
    });
});
