/**
 * create-officer-payload.test.ts — the contract the create-officer dialog
 * violated in production.
 *
 * 2026-08-14, operator's AC7 walk (screenshot 9.PNG): the "เพิ่มพนักงานใหม่"
 * dialog collected username/email/password/name/role — no providerId — and
 * the backend correctly refused with "providerId is required for provider
 * accounts" (routes/api/system/provider.js:297-303, THAI_ID_REGEX 13 digits).
 * The dialog also accepted a 6-char password the strength policy
 * (createProviderUser, min 10) would reject one step later.
 *
 * The payload builder is a pure module so THIS behavioral suite survives the
 * planned redesign of the page around it. Assertions run the real function.
 */

import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildCreateOfficerPayload, buildEditOfficerPayload } from '../create-officer-payload';

const VALID = {
    providerId: '1234567890123',
    email: 'officer@gacp-test.local',
    password: 'StrongPass10!',
    firstName: 'ทดสอบ',
    lastName: 'ฟาร์ม',
    role: 'document_reviewer',
};

describe('buildCreateOfficerPayload', () => {
    it('valid input → ok payload carrying providerId and NO username key', () => {
        const r = buildCreateOfficerPayload(VALID);
        expect(r.ok).toBe(true);
        if (!r.ok) { return; }
        expect(r.payload.providerId).toBe('1234567890123');
        expect(r.payload.role).toBe('document_reviewer');
        expect('username' in r.payload).toBe(false);
    });

    it('providerId missing → refused in Thai naming the 13-digit requirement', () => {
        const r = buildCreateOfficerPayload({ ...VALID, providerId: '' });
        expect(r.ok).toBe(false);
        if (r.ok) { return; }
        expect(r.messageTh).toContain('13');
    });

    it('providerId with 12 digits or non-digits → refused', () => {
        expect(buildCreateOfficerPayload({ ...VALID, providerId: '123456789012' }).ok).toBe(false);
        expect(buildCreateOfficerPayload({ ...VALID, providerId: '12345678901ab' }).ok).toBe(false);
    });

    it("the operator's actual input — password '123456' → refused BEFORE the network, message names min 10", () => {
        const r = buildCreateOfficerPayload({ ...VALID, password: '123456' });
        expect(r.ok).toBe(false);
        if (r.ok) { return; }
        expect(r.messageTh).toContain('10');
    });

    it('blank names or email → refused (backend requires them; fail before the network)', () => {
        expect(buildCreateOfficerPayload({ ...VALID, firstName: '' }).ok).toBe(false);
        expect(buildCreateOfficerPayload({ ...VALID, email: '' }).ok).toBe(false);
    });
});

// Operator 2026-09-26: the directory sets no password. The edit payload is the
// whole contract of PUT /provider/directory/:id from this page: profile fields
// only. It used to be the raw form state, which carried `password` (hashed onto
// the officer by the backend) and `providerId: ''` (which the backend refuses as
// an identity edit, PROVIDER_ID_EDIT_FORBIDDEN).
describe('buildEditOfficerPayload', () => {
    const FORM = {
        username: 'somchai',
        providerId: '',
        email: ' officer@gacp-test.local ',
        password: 'Leftover#Pass2026',
        firstName: ' สมชาย ',
        lastName: 'ใจดี',
        role: 'document_reviewer',
    };

    it('carries profile fields only — never password, providerId or username', () => {
        const payload = buildEditOfficerPayload(FORM);
        expect(payload).toEqual({
            email: 'officer@gacp-test.local',
            firstName: 'สมชาย',
            lastName: 'ใจดี',
            role: 'document_reviewer',
        });
        expect(Object.keys(payload)).not.toContain('password');
    });
});

describe('page wiring (source-level — the behavior itself is pinned above)', () => {
    it('page.tsx imports the builder and the create path no longer posts raw formData', () => {
        const src = readFileSync(path.resolve(__dirname, '..', 'page.tsx'), 'utf8');
        expect(src).toMatch(/from '\.\/create-officer-payload'/);
        expect(src).toMatch(/buildCreateOfficerPayload\(/);
    });
});
