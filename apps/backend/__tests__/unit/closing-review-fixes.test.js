/**
 * [ClosingReview] Regression tests for the NEW bugs found by the
 * day-end team meta-review (2026-05-15):
 *
 *   NEW-1: `mfaSecret`/`mfaBackupCodes` are not on the User schema — canonical
 *          columns are `twoFactorSecret`/`twoFactorBackupCodes`/`twoFactorEnabled`.
 *   NEW-2: 6 remaining `actorIdentity: req.user.healthId` raw-PII writes had to
 *          be swept after Sprint 6 H3 + App-audit AC3 fixed only 2 of 8 sites.
 *   NEW-3: `PUT /revision-deadline/:applicationId/submit` was gated by
 *          `authenticateProvider` but JSDoc says HEALTH_USER submits — broken.
 *   NEW-4: applications.js had 6 duplicate `logger.error` calls with one
 *          mislabelled ("Save" instead of "Draft") — cleanup.
 *   NEW-5: Day-end Priority 1 (next-sprint promoted to same-day): the
 *          `routes/api/identity/mfa.js` setup/verify-setup/verify/disable
 *          endpoints were ALSO writing to the non-existent `mfaSecret` /
 *          `mfaEnabled` / `mfaBackupCodes` columns — entire MFA flow broken
 *          in production. Schema fix swept across all 4 endpoints.
 *   NEW-6: Day-end Priority 4 (AC6): the admin status override at
 *          `routes/api/admin/applications.js:219-263` previously updated
 *          `Application.status` BEFORE the hash-chained audit insert. If the
 *          audit `create` failed, the status mutation persisted with no
 *          tamper-evident trail. Fix wraps both writes in a single Prisma
 *          `$transaction` via the new `auditLogger.logWithin(event, tx)`
 *          method, with retry-on-P2002 around the whole tx.
 */

const fs = require('fs');
const path = require('path');

const BACKEND = path.join(__dirname, '..', '..');

describe('[ClosingReview] NEW-1: twoFactor schema field names', () => {
    it('pdpa-retention-job.js writes twoFactorSecret (not mfaSecret)', () => {
        const src = fs.readFileSync(path.join(BACKEND, 'jobs/pdpa-retention-job.js'), 'utf8');
        // Strip comments so the audit-note that mentions the old name doesn't
        // false-positive.
        const stripped = src
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
        expect(stripped).not.toMatch(/mfaSecret:\s*null/);
        expect(stripped).not.toMatch(/mfaBackupCodes:\s*null/);
        expect(stripped).toMatch(/twoFactorSecret:\s*null/);
        expect(stripped).toMatch(/twoFactorBackupCodes:\s*null/);
        expect(stripped).toMatch(/twoFactorEnabled:\s*false/);
    });

    it('auth-session-security-handlers.js deleteMe writes twoFactorSecret (not mfaSecret)', () => {
        const src = fs.readFileSync(path.join(BACKEND, 'controllers/auth-controller/auth-session-security-handlers.js'), 'utf8');
        const stripped = src
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
        expect(stripped).not.toMatch(/mfaSecret:\s*null/);
        expect(stripped).not.toMatch(/mfaBackupCodes:\s*null/);
        expect(stripped).toMatch(/twoFactorSecret:\s*null/);
        expect(stripped).toMatch(/twoFactorEnabled:\s*false/);
    });

    it('prisma-auth-service.js login() reads twoFactorEnabled (with mfaEnabled legacy fallback)', () => {
        // Since 2026-09-15 (no email second factor) the read lives in the one
        // helper every login surface asks — shared/second-factor.js — so the
        // canonical-column pin follows it there; login() must go through the helper.
        const strip = (src) => src
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
        const service = strip(fs.readFileSync(path.join(BACKEND, 'services/prisma-auth-service.js'), 'utf8'));
        expect(service).toMatch(/hasUsableSecondFactor\(user\)/);
        expect(service).not.toMatch(/user\.mfaEnabled/);
        const helper = strip(fs.readFileSync(path.join(BACKEND, 'shared/second-factor.js'), 'utf8'));
        // Must check twoFactorEnabled, with the legacy column as the fallback.
        expect(helper).toMatch(/user\.twoFactorEnabled/);
        expect(helper).toMatch(/user\.mfaEnabled/);
    });
});

describe('[ClosingReview] NEW-2: actorIdentity healthId leak sweep', () => {
    const FILES_THAT_SHOULD_MASK = [
        'routes/api/cultivation/harvest-batches.js',
        'routes/api/provider/handlers/auditor-audit-decision-handler.js',
        'routes/api/provider/handlers/auditor-inspection-start-handler.js',
        'routes/api/provider/handlers/scheduler-audit-schedules-post-handler.js',
        'routes/api/provider/handlers/workflow-revision-expirations-handler.js',
        'routes/api/provider/handlers/workflow-side-effects.js',
    ];

    for (const relPath of FILES_THAT_SHOULD_MASK) {
        it(`${relPath} masks healthId in actorIdentity field`, () => {
            const src = fs.readFileSync(path.join(BACKEND, relPath), 'utf8');
            const stripped = src
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
            // After the fix: should call maskThaiId on the healthId fallback.
            // Allow optional-chaining (`req.user?.healthId`) as well as plain access.
            expect(stripped).toMatch(/maskThaiId\s*\(\s*(?:req\.user|reqUser)\??\.healthId\s*\)/);
        });
    }

    it('repo-wide sweep: no raw healthId write to actorIdentity field remains', () => {
        // This test runs a final grep across the explicit FILES list above.
        for (const relPath of FILES_THAT_SHOULD_MASK) {
            const src = fs.readFileSync(path.join(BACKEND, relPath), 'utf8');
            const stripped = src
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
            // No bare `... healthId || null` after `actorIdentity:` (without maskThaiId).
            // Allow optional chaining; the requirement is just that maskThaiId wraps the access.
            const bareHealthIdPattern = /actorIdentity:\s*(?:req\.user|reqUser)\??\.healthId\b/;
            expect(stripped).not.toMatch(bareHealthIdPattern);
        }
    });
});

describe('[ClosingReview] NEW-3: revision-deadline PUT /submit middleware fix', () => {
    it('uses authenticateAny (not authenticateProvider)', () => {
        const src = fs.readFileSync(path.join(BACKEND, 'routes/api/applications/revision-deadline.js'), 'utf8');
        const stripped = src
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
        // The /submit handler must be wired with authenticateAny, NOT authenticateProvider.
        expect(stripped).toMatch(/router\.put\(['"]\/:applicationId\/submit['"],\s*authenticateAny/);
        expect(stripped).not.toMatch(/router\.put\(['"]\/:applicationId\/submit['"],\s*authModule\.authenticateProvider/);
    });

    it('has ownership check (resolveHealthIdentity + isProviderRole)', () => {
        const src = fs.readFileSync(path.join(BACKEND, 'routes/api/applications/revision-deadline.js'), 'utf8');
        // Must reference both helpers for the ownership gate.
        expect(src).toMatch(/resolveHealthIdentity/);
        expect(src).toMatch(/isProviderRole/);
    });
});

describe('[ClosingReview] NEW-5: mfa.js routes use canonical twoFactor* columns', () => {
    const stripComments = (src) =>
        src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

    // Batch 15 prisma-bypass cleanup (2026-05-16): the canonical
    // twoFactor* column writes moved out of the route file and into
    // `services/identity-service.js`. The route still references the
    // service methods by name (`enableMfaWithBackupCodes`,
    // `disableMfa`, etc.). To keep this regression gate meaningful we
    // assert against the concatenation of the route + the service, so
    // the gate fires if a future change reintroduces the broken
    // `mfaSecret`/`mfaBackupCodes`/`mfaEnabled` names anywhere on the
    // live MFA path.
    let src;
    let stripped;
    beforeAll(() => {
        const route = fs.readFileSync(path.join(BACKEND, 'routes/api/identity/mfa.js'), 'utf8');
        const service = fs.readFileSync(path.join(BACKEND, 'services/identity-service.js'), 'utf8');
        src = `${route}\n${service}`;
        stripped = stripComments(src);
    });

    it('POST /setup writes twoFactorSecret + twoFactorEnabled (not mfa*)', () => {
        // Setup handler must write to canonical columns.
        expect(stripped).toMatch(/twoFactorSecret:\s*secret/);
        expect(stripped).toMatch(/twoFactorEnabled:\s*false/);
        // And must NOT write the broken legacy names.
        expect(stripped).not.toMatch(/mfaSecret:\s*secret/);
    });

    it('POST /verify-setup reads twoFactorSecret and writes twoFactorEnabled/twoFactorBackupCodes as a native array', () => {
        expect(stripped).toMatch(/select:\s*\{\s*twoFactorSecret:\s*true\s*\}/);
        expect(stripped).toMatch(/twoFactorEnabled:\s*true/);
        // Retro-QA fix HIGH-1: `twoFactorBackupCodes` is a Prisma `Json?`
        // column — write the array directly, no JSON.stringify wrapper.
        expect(stripped).toMatch(/twoFactorBackupCodes:\s*hashedBackupCodes/);
        expect(stripped).not.toMatch(/twoFactorBackupCodes:\s*JSON\.stringify/);
        // Legacy names must be gone.
        expect(stripped).not.toMatch(/mfaEnabled:\s*true/);
        expect(stripped).not.toMatch(/mfaBackupCodes:\s*JSON\.stringify/);
    });

    it('POST /verify selects canonical twoFactor* trio in the user lookup', () => {
        // The select clause for the /verify flow must include all three canonical columns.
        expect(stripped).toMatch(/twoFactorSecret:\s*true/);
        expect(stripped).toMatch(/twoFactorEnabled:\s*true/);
        expect(stripped).toMatch(/twoFactorBackupCodes:\s*true/);
        // And the legacy trio must not appear in a select.
        expect(stripped).not.toMatch(/mfaSecret:\s*true/);
        expect(stripped).not.toMatch(/mfaBackupCodes:\s*true/);
    });

    it('DELETE /disable writes twoFactorEnabled: false + nulls canonical columns', () => {
        // Disable handler must null the canonical columns AND set twoFactorEnabled:false.
        expect(stripped).toMatch(/twoFactorEnabled:\s*false/);
        expect(stripped).toMatch(/twoFactorSecret:\s*null/);
        expect(stripped).toMatch(/twoFactorBackupCodes:\s*null/);
        // Broken legacy disable writes must be gone.
        expect(stripped).not.toMatch(/mfaSecret:\s*null/);
        expect(stripped).not.toMatch(/mfaBackupCodes:\s*null/);
        expect(stripped).not.toMatch(/mfaEnabled:\s*false/);
    });

    it('No live code references the broken mfaSecret/mfaBackupCodes column names', () => {
        // Final guard: the live (comment-stripped) source must have zero occurrences
        // of the broken column names. Only the file header comment may still mention
        // them for historical context.
        expect(stripped).not.toMatch(/\bmfaSecret\b/);
        expect(stripped).not.toMatch(/\bmfaBackupCodes\b/);
        expect(stripped).not.toMatch(/\bmfaEnabled\b/);
    });
});

describe('[ClosingReview] NEW-6: admin status override is transactional with audit', () => {
    const stripComments = (src) =>
        src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

    let src;
    let stripped;
    beforeAll(() => {
        src = fs.readFileSync(path.join(BACKEND, 'routes/api/admin/applications.js'), 'utf8');
        stripped = stripComments(src);
    });

    it('wraps application.update + audit write in prisma.$transaction', () => {
        // Must use $transaction with an interactive (async tx) callback.
        expect(stripped).toMatch(/prisma\.\$transaction\(\s*async\s*\(\s*tx\s*\)\s*=>/);
        // The application.update MUST go through tx, not the singleton prisma.
        expect(stripped).toMatch(/tx\.application\.update/);
        // And the audit write MUST be the new logWithin variant, scoped to tx.
        expect(stripped).toMatch(/auditLogger\.logWithin\(/);
    });

    it('no longer uses the best-effort try/catch audit pattern', () => {
        // The OLD pattern was:
        //   await prisma.application.update(...)
        //   try { await auditLogger.log(...) } catch (auditError) { logger.warn(...) }
        // After the fix there must be no `auditLogger.log(` call (only logWithin),
        // and no `failed to write audit log` warn message.
        expect(stripped).not.toMatch(/auditLogger\.log\(\s*\{/);
        expect(stripped).not.toMatch(/failed to write audit log/);
    });

    it('retries the whole transaction on audit P2002 sequence conflicts', () => {
        // The route must classify P2002 via auditLogger.isSequenceConflictError
        // and re-enter the for-loop to retry the WHOLE transaction (not just
        // the audit insert) — that's what makes the contract safe even under
        // concurrent admin overrides.
        expect(stripped).toMatch(/isSequenceConflictError/);
        expect(stripped).toMatch(/MAX_TX_ATTEMPTS/);
    });
});

describe('[ClosingReview] NEW-4: applications.js duplicate logger cleanup', () => {
    it('no duplicate logger.error calls in catch blocks', () => {
        const src = fs.readFileSync(path.join(BACKEND, 'routes/api/applications/applications.js'), 'utf8');
        // Specifically, the mislabeled "Save" log must be gone.
        expect(src).not.toMatch(/logger\.error\(['"]\[Applications Save\]/);
        // And the "full error" duplicates must be gone (only the first log per catch remains).
        expect(src).not.toMatch(/logger\.error\(['"]\[Applications [^\]]+\] full error:/);
        // Count occurrences of `\[Applications Submit\] Error` — should appear once now.
        const submitErrors = (src.match(/\[Applications Submit\] Error/g) || []).length;
        expect(submitErrors).toBe(1);
    });
});
