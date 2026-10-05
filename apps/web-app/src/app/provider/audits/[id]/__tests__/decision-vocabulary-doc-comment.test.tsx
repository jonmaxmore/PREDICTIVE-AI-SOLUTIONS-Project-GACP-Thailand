/**
 * decision-vocabulary-doc-comment.test.tsx — V3-C (DI-2) lint-level check.
 *
 * Purpose: ensure the cross-link comment in `audit-service.ts` stays
 * present. DI-2 is the silent split between two AUDITOR decision
 * endpoints with mutually-incompatible vocabularies:
 *   • /audit/onsite/:id/decision  → PASS | FAIL | NEEDS_REVIEW
 *   • /api/provider/auditor/.../audit-decisions → PASS | MINOR | MAJOR
 *
 * A future agent who only sees one surface will assume the other is
 * dead code and may try to "consolidate" by removing one. The
 * comment block documents BOTH and explains why both exist. If the
 * comment disappears (e.g. an aggressive refactor strips it), this
 * test fails — forcing the next iteration to re-document the
 * decision-vocabulary rationale.
 *
 * No runtime behaviour is asserted; this is purely a documentation
 * contract guard.
 */

import { describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';

describe('audit-service.ts — DI-2 decision-vocabulary doc comment (V3-C)', () => {
    const sourcePath = path.resolve(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        '..',
        'lib',
        'services',
        'audit-service.ts',
    );

    const source = fs.readFileSync(sourcePath, 'utf8');

    it('mentions the DECISION VOCABULARY heading', () => {
        expect(source).toContain('DECISION VOCABULARY');
    });

    it('documents the inspect-flow vocab PASS | FAIL | NEEDS_REVIEW', () => {
        expect(source).toMatch(/PASS.*FAIL.*NEEDS_REVIEW/s);
        // The onsite path string is the canonical reference.
        expect(source).toContain('/audit/onsite/:auditId/decision');
    });

    it('documents the legacy job-sheet vocab PASS | MINOR | MAJOR', () => {
        expect(source).toMatch(/PASS.*MINOR.*MAJOR/s);
        expect(source).toContain('/api/provider/auditor/applications/:id/audit-decisions');
    });

    it('cross-references both backend service files for future readers', () => {
        expect(source).toContain('audit-onsite-service.js');
        expect(source).toContain('auditor-audit-decision-handler.js');
    });

    it('explains the workflow targets so the split is not mistaken for a bug', () => {
        // Either surface produces AUDIT_PASSED on PASS — the comment
        // calls this out explicitly so a future agent doesn't try to
        // "fix" the dual surface.
        expect(source).toContain('AUDIT_PASSED');
        expect(source).toContain('CAR_PENDING');
    });

    it('flags GACP score gate ownership (only on legacy flow today)', () => {
        // Tracks the deferred-consolidation note in the RFC §V3-C.
        expect(source.toLowerCase()).toContain('gacp');
    });
});
