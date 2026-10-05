/**
 * X3-FIX-D / AUD-FA-OBV (2026-05-18) — source-grep regression guard for
 * the architectural-decision flag at the head of `listFinalApprovalQueue`.
 *
 * `listFinalApprovalQueue` at
 *   apps/backend/services/application-service/application-provider-query-methods.js
 * currently returns ALL `AUDIT_PASSED` applications cross-tenant. The
 * GET route is gated to AUDITORS + ADMIN at the role layer (X2-FIX-D
 * M-18), and the WRITE path is narrowed by `withVisibility(req.user)`,
 * so production impact is bounded. But the READ scope is a product
 * decision (shared bench-of-auditors vs personal queue per auditor)
 * and must NOT be silently changed by a future agent.
 *
 * Per the X3 meeting (sub-task X3-FIX-D scope), no behaviour change is
 * applied — only a flag-comment is added documenting:
 *   (1) current behaviour (returns ALL AUDIT_PASSED cross-tenant)
 *   (2) why it is safe today (X2-FIX-D M-18 route gate + withVisibility
 *       on the POST path)
 *   (3) what it leaks (read-only case list to other auditors)
 *   (4) product decision pending (shared-bench vs personal-queue)
 *   (5) TODO(X3.5) anchor pointing at the X3-D handoff
 *
 * This guard makes sure the flag block is present so a refactor that
 * drops the comment forces a test failure and a conscious re-add. We
 * pin on three independent string anchors so cosmetic re-wording of the
 * comment (e.g. translating commentary into Thai) still passes — the
 * `TODO(X3.5)` anchor + `AUD-FA-OBV` tag + the sister-fix `M-18`
 * reference are stable.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SOURCE_PATH = path.resolve(
    __dirname,
    '../../services/application-service/application-provider-query-methods.js',
);

describe('[X3-FIX-D / AUD-FA-OBV] listFinalApprovalQueue architectural-decision flag', () => {
    let source;

    beforeAll(() => {
        source = fs.readFileSync(SOURCE_PATH, 'utf8');
    });

    test('AUD-FA-OBV flag tag is present at the head of listFinalApprovalQueue', () => {
        // The flag block sits between the function's existing JSDoc and
        // the `async listFinalApprovalQueue` declaration. It must carry
        // the `AUD-FA-OBV` tag so a code search lands on it.
        expect(source).toMatch(/AUD-FA-OBV/);

        // The flag must precede the function declaration — assert the
        // relative order so a stray reference somewhere else in the file
        // does not falsely pass this guard.
        const tagIdx = source.indexOf('AUD-FA-OBV');
        const fnIdx = source.indexOf('async listFinalApprovalQueue');
        expect(tagIdx).toBeGreaterThan(-1);
        expect(fnIdx).toBeGreaterThan(-1);
        expect(tagIdx).toBeLessThan(fnIdx);
    });

    test('flag block references the X2-FIX-D M-18 sister fix (route-layer gate)', () => {
        // The "why this is safe today" half of the comment names the
        // sister fix so readers find the route-layer narrowing without
        // having to grep cold.
        expect(source).toMatch(/X2-FIX-D[\s\S]{0,40}M-18/);
        expect(source).toMatch(/withVisibility/);
    });

    test('flag block carries a TODO(X3.5) anchor that points at the X3-D handoff', () => {
        // The TODO is the single mechanical anchor that a future agent
        // grep-search ("TODO(X3.5)" repo-wide) will land on. Drop the
        // anchor and you lose the only forward link to the decision.
        expect(source).toMatch(/TODO\(X3\.5\)/);
        expect(source).toMatch(/X3-D\.md/);
    });

    test('listFinalApprovalQueue body remains BEHAVIOUR-UNCHANGED (no withVisibility leaked in)', () => {
        // X3-FIX-D is comment-only. If a future agent narrows the read
        // by adding `withVisibility` without first writing the product
        // decision, this guard surfaces it. Extract the function body
        // and assert no `withVisibility` call inside it.
        const start = source.indexOf('async listFinalApprovalQueue');
        expect(start).toBeGreaterThan(-1);
        // The next sibling method begins with the JSDoc for
        // findApplicationForFinalApproval. Slice between those two
        // anchors to isolate the function body.
        const nextSibling = source.indexOf('findApplicationForFinalApproval', start);
        expect(nextSibling).toBeGreaterThan(start);
        const body = source.slice(start, nextSibling);
        expect(body).not.toMatch(/withVisibility/);
        // Sanity: the canonical select shape is still in place.
        expect(body).toMatch(/status: 'AUDIT_PASSED'/);
        expect(body).toMatch(/orderBy: \{ updatedAt: 'asc' \}/);
    });
});
