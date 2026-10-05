/**
 * Y1-FIX-D — `docs/i18n-policy.md` codification regression test.
 *
 * Y1-AUDIT §4 recommended documenting the Thai-only-by-design status of
 * ACCOUNT_DTAM + ACCOUNT_PLATFORM + ADMIN surfaces (per X4-A i18n-1 and
 * X5-A §10) instead of translating them. This test asserts the policy
 * file exists at the expected path and names each of the 5 policies so a
 * future drop / merge-conflict that nukes the file fails CI.
 *
 * The test reads from the repo root (not from web-app) because the
 * policy doc is a top-level governance artefact, not a web-app concern.
 */

import { describe, expect, it } from '@jest/globals';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const POLICY_PATH = resolve(__dirname, '../../../../../../docs/i18n-policy.md');

describe('[Y1-FIX-D] docs/i18n-policy.md codification', () => {
    it('exists at the expected repo path', () => {
        expect(existsSync(POLICY_PATH)).toBe(true);
    });

    it('declares Policy 1-5 (the 5 codified rules)', () => {
        const src = readFileSync(POLICY_PATH, 'utf8');
        expect(src).toMatch(/Policy 1 — ACCOUNT_DTAM \+ ACCOUNT_PLATFORM pages are Thai-only/);
        expect(src).toMatch(/Policy 2 — ADMIN pages are Thai-only by default/);
        expect(src).toMatch(/Policy 3 — HEALTH applicants \+ Provider portal .* require TH\+EN/);
        expect(src).toMatch(/Policy 4 — Login pages, Help center, Privacy \/ Terms of Service require TH\+EN/);
        expect(src).toMatch(/Policy 5 — Error codes always use English machine identifier \+ Thai user message/);
    });

    it('cites the Loop X audits that informed each policy', () => {
        const src = readFileSync(POLICY_PATH, 'utf8');
        // Each citation is the audit identifier — see Y1-AUDIT §8 carry-over table.
        expect(src).toMatch(/X1-A H-3/);
        expect(src).toMatch(/X2-A §6/);
        expect(src).toMatch(/X4-A i18n-1/);
        expect(src).toMatch(/X5-A §10/);
    });

    it('names the slip-review error-map as the Policy 5 reference implementation', () => {
        const src = readFileSync(POLICY_PATH, 'utf8');
        expect(src).toMatch(/SLIP_REVIEW_ERROR_MAP/);
        expect(src).toMatch(/resolveSlipReviewError/);
        expect(src).toMatch(/X4-FIX-C/);
    });

    it('lists the admin modals affected by Y1-FIX-D Policy 5 extension', () => {
        const src = readFileSync(POLICY_PATH, 'utf8');
        expect(src).toMatch(/ChangeRoleModal\.tsx/);
        // ForceMfaResetModal was removed 2026-09-26 (operator "ถอดทั้งสองประตู") — not listed as a live file any more
        expect(src).not.toMatch(/components\/admin\/ForceMfaResetModal\.tsx/);
        expect(src).toMatch(/UserDisableModal\.tsx/);
        expect(src).toMatch(/ForceStatusModal\.tsx/);
    });

    it('names the error-code-map shared helper from Y1-FIX-D', () => {
        const src = readFileSync(POLICY_PATH, 'utf8');
        expect(src).toMatch(/error-code-map\.ts/);
    });

    it('describes the override procedure for future policy reversal', () => {
        const src = readFileSync(POLICY_PATH, 'utf8');
        expect(src).toMatch(/Override procedure|override procedure/);
        // The dict parity test is the executable gate that the override
        // procedure relies on — fail closed when an EN dict is added.
        expect(src).toMatch(/dictionary parity test|dictionary-parity\.test\.ts/);
    });

    it('includes example error-code mappings (Policy 5 reference vocab)', () => {
        const src = readFileSync(POLICY_PATH, 'utf8');
        // Spot-check a few of the error codes that Y1-FIX-D wires up.
        expect(src).toMatch(/INVALID_REVIEWER_SIDE/);
        expect(src).toMatch(/ROLE_ADMIN_CANNOT_BE_LAST/);
        expect(src).toMatch(/USER_HAS_PENDING_APPLICATIONS/);
        expect(src).toMatch(/INVALID_STATE_TRANSITION/);
        expect(src).toMatch(/MFA_USER_NOT_FOUND/);
    });
});
