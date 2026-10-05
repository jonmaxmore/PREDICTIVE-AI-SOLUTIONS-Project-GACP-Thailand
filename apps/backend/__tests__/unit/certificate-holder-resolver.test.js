/**
 * M1 (2026-08-15) — who holds a newly issued certificate is decided here, once:
 * application entity first, farm entity second, the person's frozen name last.
 * Pure resolver, no DB — runs anywhere (plan Task A3).
 */

const { resolveHolderForIssuance } = require('../../services/certificate-service');

describe('M1 resolveHolderForIssuance', () => {
    const person = { id: 'u1', firstName: 'สมชาย', lastName: 'ใจดี' };
    it('uses application entity displayName first', () => {
        const app = {
            applicant: person, submitterId: 'u2',
            entity: { displayName: 'วิสาหกิจชุมชนสมุนไพรบ้านนา', type: 'COMMUNITY_ENTERPRISE' },
        };
        const out = resolveHolderForIssuance(app, { entity: null });
        expect(out).toEqual({
            holderDisplayName: 'วิสาหกิจชุมชนสมุนไพรบ้านนา',
            holderType: 'COMMUNITY_ENTERPRISE', submittedByUserId: 'u2',
        });
    });
    it('falls back to farm entity, then to person name as LEGACY_PERSON', () => {
        const app = { applicant: person, submitterId: null, entity: null };
        expect(resolveHolderForIssuance(app, { entity: { displayName: 'ฟาร์ม A', type: 'JURISTIC' } }))
            .toEqual({ holderDisplayName: 'ฟาร์ม A', holderType: 'JURISTIC', submittedByUserId: 'u1' });
        expect(resolveHolderForIssuance(app, { entity: null }))
            .toEqual({ holderDisplayName: 'สมชาย ใจดี', holderType: 'LEGACY_PERSON', submittedByUserId: 'u1' });
    });
    it('never lets the providerId/SYSTEM leak into submittedByUserId', () => {
        const app = { applicant: person, submitterId: null, entity: null };
        const out = resolveHolderForIssuance(app, { entity: null }, 'SYSTEM');
        expect(out.submittedByUserId).toBe('u1');
    });
});
