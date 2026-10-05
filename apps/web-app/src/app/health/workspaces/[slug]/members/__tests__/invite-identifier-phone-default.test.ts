/**
 * invite-identifier-phone-default.test.ts — W8 personal-workspace-team, item 3.
 *
 * The invite form defaulted to national ID (เลขบัตรประชาชน), which
 * contradicts the approved org-model ruling (2026-08-17, memory:
 * org-model-direction-C): "invites in-app-notification-only, add-by
 * phone/short-code (not national-ID/name/long-numeric)".
 *
 * Backend check (apps/backend/services/entity-service.js:1868-1906,
 * findInviteeByIdentifier): healthId, email, AND phone are all live,
 * functional lookup channels — none of the three 500s or is dead code.
 * Per the ruling, national ID specifically must not remain a selectable
 * invite channel (not just "not the default") — email is not on the
 * ruling's blacklist (not a national ID / name / long numeric) and stays
 * as a secondary option. So: default → phone, secondary → email,
 * national ID (healthId) → REMOVED from the UI entirely (PDPA: this also
 * means the invite form can never solicit someone's national ID at all).
 *
 * fs source-scan pin (repo convention for this page — see
 * member-healthid-masked.test.ts): this page fetches in a useEffect, so
 * there is no @testing-library/react render step in this file.
 */

import fs from 'fs';
import path from 'path';

const PAGE = fs.readFileSync(path.join(__dirname, '..', 'page.tsx'), 'utf8');

describe('invite identifier — default is phone, national ID option is removed', () => {
    it('the identifierType state initializes to phone, not healthId', () => {
        expect(PAGE).toMatch(/useState<\s*'phone'\s*\|\s*'email'\s*>\(\s*'phone'\s*\)/);
    });

    it('the type union no longer includes healthId anywhere in the invite state', () => {
        expect(PAGE).not.toMatch(/'healthId'\s*\|\s*'email'\s*\|\s*'phone'/);
        expect(PAGE).not.toMatch(/identifierType\s*===\s*'healthId'/);
    });

    it('the identifier <select> no longer offers a national-ID (เลขบัตรประชาชน) option', () => {
        expect(PAGE).not.toMatch(/<option value="healthId">/);
        expect(PAGE).not.toMatch(/เลขบัตรประชาชน/);
    });

    it('phone and email remain as the two selectable invite channels', () => {
        expect(PAGE).toMatch(/<option value="phone">/);
        expect(PAGE).toMatch(/<option value="email">/);
    });

    it('the placeholder/aria-label for the identifier input no longer references a citizen-ID example value', () => {
        // pre-fix bug: identifierType === 'healthId' ? '1100000000008' : ...
        expect(PAGE).not.toMatch(/1100000000008/);
    });
});
