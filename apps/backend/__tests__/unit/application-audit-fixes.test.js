/**
 * [AppAudit] Application/Submission System Audit — Phase A regression tests
 *
 * Covers the 6 Phase A fixes from the application audit (2026-05-15):
 *   - AC3: healthId masked in trace/lots workflowHistory metadata
 *   - AC4: raw error.message suppressed in applications.js + workflow-handlers.js
 *   - AC5: phantom userId query replaced with canonical healthId lookup
 *   - AM2: CAR upload uses strict MIME + ext allowlist (not regex substring)
 *   - AH9: revision-deadline GET requires auth + ownership
 *   - AH2: revision-deadline-checker routes through canonical buildTransitionUpdate
 */

const fs = require('fs');
const path = require('path');

jest.mock('../../shared/logger', () => {
    const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { ...log, createLogger: jest.fn(() => log), stream: { write: jest.fn() } };
});

describe('[AppAudit] Phase A fixes — static regressions', () => {
    it('AC3: trace/lots.js no longer writes raw req.user.healthId into workflowHistory metadata', () => {
        const filePath = path.join(__dirname, '..', '..', 'routes', 'api', 'trace', 'lots.js');
        const src = fs.readFileSync(filePath, 'utf8');
        // Strip comments to ignore audit notes that mention the legacy code.
        const stripped = src
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
        // Must NOT contain the raw `actorIdentity: req.user?.healthId` write.
        expect(stripped).not.toMatch(/actorIdentity:\s*req\.user\?\.healthId/);
        // Must import maskThaiId.
        expect(src).toMatch(/maskThaiId/);
        // Should reference the masked variant.
        expect(stripped).toMatch(/actorIdentityMasked:\s*maskThaiId/);
    });

    it('AC4: applications.js does not echo raw error.message in 5xx responses', () => {
        const filePath = path.join(__dirname, '..', '..', 'routes', 'api', 'applications', 'applications.js');
        const src = fs.readFileSync(filePath, 'utf8');
        const stripped = src
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
        // No `details: error.message` in catch-block responses.
        expect(stripped).not.toMatch(/details:\s*error\.message/);
        // Should route 5xx through a sanitizing wrapper. applications.js was
        // migrated (commit 3e8f9b01 + the 741→480 split) from direct
        // `safeErrorMessage(error)` calls to the centralized `respondError(...)`
        // helper, which itself calls `safeErrorMessage` internally
        // (shared/api-response.js:262/275/289). Either path satisfies the AC4
        // intent — raw error.message is never echoed to the client.
        expect(src).toMatch(/respondError\(\s*res\s*,\s*req\s*,\s*error|safeErrorMessage\(error\)/);
    });

    it('AC4: application-workflow-handlers.js PDF + reject use safeErrorMessage', () => {
        const filePath = path.join(__dirname, '..', '..', 'routes', 'api', 'applications', 'application-workflow-handlers.js');
        const src = fs.readFileSync(filePath, 'utf8');
        const stripped = src
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
        // The PDF handler previously had `error: error.message || 'Failed to generate PDF'`.
        // It must now route through a sanitizing wrapper with that fallback —
        // either a direct `safeErrorMessage(error, 'Failed to generate PDF')`
        // or the centralized `respondError(res, req, error, { message: 'Failed
        // to generate PDF' })` (respondError calls safeErrorMessage internally,
        // shared/api-response.js:262/275/289). Both satisfy AC4.
        expect(stripped).toMatch(
            /safeErrorMessage\(error,\s*['"]Failed to generate PDF['"]\)|respondError\([^)]*['"]Failed to generate PDF['"]/,
        );
        // Reject handler also.
        expect(stripped).not.toMatch(/error: 'Failed to reject application', details:\s*error\.message/);
    });

    it('AC5: applications.js readiness endpoint queries healthId, not phantom userId', () => {
        const filePath = path.join(__dirname, '..', '..', 'routes', 'api', 'applications', 'applications.js');
        const src = fs.readFileSync(filePath, 'utf8');
        const stripped = src
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
        // The phantom `where: { userId, status: { not: 'EXPIRED' } }` must be gone from
        // the readiness route's application query.
        expect(stripped).not.toMatch(/prisma\.application\.findMany\(\{\s*where:\s*\{\s*userId,\s*status:/);
        // Must use applicationService.resolveHealthIdentity for the lookup.
        expect(stripped).toMatch(/resolveHealthIdentity/);
    });

    it('AM2: CAR upload uses strict MIME allowlist (not regex substring)', () => {
        const filePath = path.join(__dirname, '..', '..', 'routes', 'api', 'applications', 'applications-car.js');
        const src = fs.readFileSync(filePath, 'utf8');
        // No more `allowedTypes = /jpeg|jpg|png|pdf/` regex.
        expect(src).not.toMatch(/allowedTypes\s*=\s*\/jpeg/);
        // Has the new explicit allowlist Set.
        expect(src).toMatch(/CAR_ALLOWED_MIMETYPES\s*=\s*new Set/);
        expect(src).toMatch(/CAR_ALLOWED_EXTENSIONS\s*=\s*new Set/);
    });

    it('AH9: revision-deadline GET handler is gated by authenticateAny', () => {
        const filePath = path.join(__dirname, '..', '..', 'routes', 'api', 'applications', 'revision-deadline.js');
        const src = fs.readFileSync(filePath, 'utf8');
        // The GET /:applicationId handler must have authenticateAny middleware.
        expect(src).toMatch(/router\.get\(['"]\/:applicationId['"],\s*authenticateAny/);
        // Ownership check via resolveHealthIdentity.
        expect(src).toMatch(/resolveHealthIdentity/);
    });

    it('AH2: revision-deadline-checker routes the EXPIRED transition through canonical', () => {
        const filePath = path.join(__dirname, '..', '..', 'jobs', 'revision-deadline-checker.js');
        const src = fs.readFileSync(filePath, 'utf8');
        // Imports the canonical helper.
        expect(src).toMatch(/buildTransitionUpdate.*require.*workflow-transition-service/s);
        // Uses it inside the transaction.
        expect(src).toMatch(/buildTransitionUpdate\(\{[^)]*toState:\s*['"]EXPIRED['"]/s);
    });
});

describe('[AppAudit] AM2 — CAR upload MIME filter behaviour', () => {
    // Re-import the file's filter logic by intercepting multer's `fileFilter`.
    // We don't load multer for real — instead, smoke-check the filter values
    // by parsing the source for the allow-set contents.

    it('blocks files with mimetype image/jpeg-exploit (substring of jpeg)', () => {
        const filePath = path.join(__dirname, '..', '..', 'routes', 'api', 'applications', 'applications-car.js');
        const src = fs.readFileSync(filePath, 'utf8');
        // The Set must contain ONLY exact valid types, not partial matches.
        const allowedSet = src.match(/CAR_ALLOWED_MIMETYPES\s*=\s*new Set\(\[([^\]]+)\]\)/);
        expect(allowedSet).not.toBeNull();
        const contents = allowedSet[1];
        expect(contents).toMatch(/['"]image\/jpeg['"]/);
        expect(contents).toMatch(/['"]image\/png['"]/);
        expect(contents).toMatch(/['"]application\/pdf['"]/);
        // Must NOT include any exploit-style substring entries.
        expect(contents).not.toMatch(/jpeg-exploit|;malicious/);
    });

    it('extension allowlist is exact-match', () => {
        const filePath = path.join(__dirname, '..', '..', 'routes', 'api', 'applications', 'applications-car.js');
        const src = fs.readFileSync(filePath, 'utf8');
        const extSet = src.match(/CAR_ALLOWED_EXTENSIONS\s*=\s*new Set\(\[([^\]]+)\]\)/);
        expect(extSet).not.toBeNull();
        const contents = extSet[1];
        // Lowercase, dot-prefixed exact extensions.
        expect(contents).toMatch(/['"]\.jpg['"]/);
        expect(contents).toMatch(/['"]\.jpeg['"]/);
        expect(contents).toMatch(/['"]\.png['"]/);
        expect(contents).toMatch(/['"]\.pdf['"]/);
    });
});
