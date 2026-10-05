/**
 * F-APPV2-02 — the door that ACCEPTS the applicant's answer about which law judges them.
 *
 * `shared/form-data-ownership.js` has said from the day the keys existed that
 * `requestType` and `certScope` are the server's to write, because both can REMOVE
 * requirements, and that "the wizard asks the question (T5); the door that accepts the
 * answer is what writes it, after checking it". Step 1 asks. Nothing checked. So every
 * filing was judged NEW / PLANTING no matter what the applicant chose — a ต่ออายุ was
 * judged as a first application, and a การแปรรูป filing was never asked for the
 * controlled-herb licence that only PROCESSING carries.
 *
 * The two dimensions are NOT symmetrical, and this suite pins the asymmetry:
 *
 *   certScope   — measured against the seeded register, exactly ONE rule keys off it
 *                 (LICENCE_PT11 requires PROCESSING) and NO rule requires
 *                 PLANTING. PLANTING is also the default. So honouring the applicant's
 *                 answer can only ADD a requirement. It needs no external proof.
 *
 *   requestType — RENEWAL and REPLACEMENT are judged by two rows instead of the whole
 *                 ส่วนที่ ๓ set. Honouring that answer REMOVES requirements, so it is
 *                 granted only against a certificate this platform issued, that is still
 *                 live, and that belongs to the person asking.
 *
 * And the refusal may never break the draft: the wizard autosaves every few seconds, so a
 * half-typed certificate number must leave the applicant on the STRICTEST reading (NEW,
 * which asks for more papers) with a notice — never a 422 that stops the save.
 */
'use strict';

const { resolveLawDimensions } = require('../../services/application-law-dimensions');

const OWNER = 'user-owner';
const LIVE_CERT = {
    id: 'cert-1',
    certificateNumber: 'GACP-TH-2569-ABC123',
    userId: OWNER,
    status: 'active',
    expiryDate: new Date(Date.now() + 90 * 86400000),
    // The holder: the entity on the application the certificate was issued from.
    application: { entityId: 'entity-holder' },
};

// A renewal also needs SUBMIT_APPLICATION on the holder (operator ruling 2026-10-03); the
// permission engine reads the membership and the grants on the client it is given.
function prismaWith(cert, membership = { id: 'm-1', role: 'OWNER', permissions: [], status: 'ACTIVE' }) {
    return {
        certificate: { findFirst: jest.fn(async () => cert) },
        entityMembership: { findUnique: jest.fn(async () => membership) },
        entityMemberPermissionGrant: { findMany: jest.fn(async () => []) },
    };
}

const base = { actorUserId: OWNER, stored: {}, filingEntityId: 'entity-holder' };

describe('certScope — the applicant answers, and the answer can only ask for more', () => {
    test('PROCESSING is honoured, because only PROCESSING adds a rule', async () => {
        const { dimensions } = await resolveLawDimensions({
            ...base, prisma: prismaWith(null), claimed: { certScope: 'PROCESSING' },
        });
        expect(dimensions.certScope).toBe('PROCESSING');
    });

    test('PLANTING is honoured too — it is the default either way', async () => {
        const { dimensions } = await resolveLawDimensions({
            ...base, prisma: prismaWith(null), claimed: { certScope: 'PLANTING' },
        });
        expect(dimensions.certScope).toBe('PLANTING');
    });

    test('a word nobody filed law for does not become the law', async () => {
        const { dimensions } = await resolveLawDimensions({
            ...base, prisma: prismaWith(null), claimed: { certScope: 'SOMETHING_ELSE' },
        });
        expect(dimensions.certScope).toBeUndefined();
    });

    test('saying nothing does not erase what was already stored', async () => {
        const { dimensions } = await resolveLawDimensions({
            ...base, prisma: prismaWith(null), stored: { certScope: 'PROCESSING' }, claimed: {},
        });
        expect(dimensions.certScope).toBeUndefined();
    });
});

describe('requestType — RENEWAL and REPLACEMENT are granted only against a real certificate', () => {
    test('NEW needs no proof, and CLEARS any linkage a previous answer left behind', async () => {
        const { dimensions, notice } = await resolveLawDimensions({
            ...base,
            prisma: prismaWith(LIVE_CERT),
            stored: { renewalOf: 'cert-1', renewalOfCertificateNumber: 'GACP-TH-2569-ABC123' },
            claimed: { requestType: 'NEW' },
        });
        expect(dimensions.requestType).toBe('NEW');
        expect(dimensions.renewalOf).toBeNull();
        expect(dimensions.replacementOf).toBeNull();
        expect(dimensions.renewalOfCertificateNumber).toBeNull();
        expect(notice).toBeNull();
    });

    test('RENEWAL against a live certificate the caller owns writes the linkage', async () => {
        const prisma = prismaWith(LIVE_CERT);
        const { dimensions, notice } = await resolveLawDimensions({
            ...base,
            prisma,
            claimed: { requestType: 'RENEWAL', previousCertificateNumber: 'GACP-TH-2569-ABC123' },
        });
        expect(dimensions.requestType).toBe('RENEWAL');
        expect(dimensions.renewalOf).toBe('cert-1');
        expect(dimensions.renewalOfCertificateNumber).toBe('GACP-TH-2569-ABC123');
        expect(dimensions.replacementOf).toBeNull();
        expect(notice).toBeNull();
        // Looked up by NUMBER — the applicant never hands over an internal id.
        expect(prisma.certificate.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ certificateNumber: 'GACP-TH-2569-ABC123' }),
        }));
    });

    test('RENEWAL typed from the paper (GACP-DTAM-…) finds the certificate and stores the canonical number', async () => {
        const prisma = prismaWith(LIVE_CERT);
        const { dimensions } = await resolveLawDimensions({
            ...base, prisma,
            claimed: { requestType: 'RENEWAL', previousCertificateNumber: ' GACP-DTAM-2569-ABC123 ' },
        });
        expect(dimensions.renewalOf).toBe('cert-1');
        expect(dimensions.renewalOfCertificateNumber).toBe('GACP-TH-2569-ABC123');
        expect(prisma.certificate.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ certificateNumber: 'GACP-TH-2569-ABC123' }),
        }));
    });

    test('REPLACEMENT writes replacementOf, not renewalOf — they are different claims', async () => {
        const { dimensions } = await resolveLawDimensions({
            ...base,
            prisma: prismaWith(LIVE_CERT),
            claimed: { requestType: 'REPLACEMENT', previousCertificateNumber: 'GACP-TH-2569-ABC123' },
        });
        expect(dimensions.requestType).toBe('REPLACEMENT');
        expect(dimensions.replacementOf).toBe('cert-1');
        expect(dimensions.renewalOf).toBeNull();
    });

    // Operator ruling 2026-10-03: who filed the previous certificate does not matter;
    // same holder + SUBMIT_APPLICATION on it is enough.
    test('a certificate another member filed is accepted when the holder matches and the caller may submit', async () => {
        const { dimensions, notice } = await resolveLawDimensions({
            ...base,
            prisma: prismaWith({ ...LIVE_CERT, userId: 'user-other' }),
            claimed: { requestType: 'RENEWAL', previousCertificateNumber: 'GACP-TH-2569-ABC123' },
        });
        expect(dimensions.requestType).toBe('RENEWAL');
        expect(dimensions.renewalOf).toBe('cert-1');
        expect(notice).toBeNull();
    });

    // ── every way the claim fails lands on the SAME safe answer ──────────────
    test.each([
        ['no number typed yet', prismaWith(LIVE_CERT), {}, 'PREVIOUS_CERTIFICATE_REQUIRED'],
        ['a number nobody issued', prismaWith(null), { previousCertificateNumber: 'GACP-TH-2569-NOPE' }, 'PREVIOUS_CERTIFICATE_NOT_FOUND'],
        ['a revoked certificate', prismaWith({ ...LIVE_CERT, status: 'revoked' }), { previousCertificateNumber: 'GACP-TH-2569-ABC123' }, 'PREVIOUS_CERTIFICATE_NOT_ACTIVE'],
        ['an expired certificate', prismaWith({ ...LIVE_CERT, expiryDate: new Date(Date.now() - 86400000) }), { previousCertificateNumber: 'GACP-TH-2569-ABC123' }, 'PREVIOUS_CERTIFICATE_EXPIRED'],
        ["a certificate of another holder", prismaWith({ ...LIVE_CERT, application: { entityId: 'entity-other' } }), { previousCertificateNumber: 'GACP-TH-2569-ABC123' }, 'PREVIOUS_CERTIFICATE_OTHER_HOLDER'],
        ['a certificate with no holder', prismaWith({ ...LIVE_CERT, application: { entityId: null } }), { previousCertificateNumber: 'GACP-TH-2569-ABC123' }, 'PREVIOUS_CERTIFICATE_OTHER_HOLDER'],
        ['a VIEWER of the holder', prismaWith(LIVE_CERT, { id: 'm-1', role: 'VIEWER', permissions: [], status: 'ACTIVE' }), { previousCertificateNumber: 'GACP-TH-2569-ABC123' }, 'PREVIOUS_CERTIFICATE_NO_SUBMIT_RIGHT'],
        ['no membership in the holder', prismaWith(LIVE_CERT, null), { previousCertificateNumber: 'GACP-TH-2569-ABC123' }, 'PREVIOUS_CERTIFICATE_NO_SUBMIT_RIGHT'],
    ])('RENEWAL with %s falls back to NEW and says why', async (_label, prisma, extra, code) => {
        const { dimensions, notice } = await resolveLawDimensions({
            ...base, prisma, claimed: { requestType: 'RENEWAL', ...extra },
        });
        // The STRICTEST reading, not the one that was asked for: NEW is judged by the
        // whole ส่วนที่ ๓ set, so an unproven claim costs the applicant nothing but a
        // longer document list.
        expect(dimensions.requestType).toBe('NEW');
        expect(dimensions.renewalOf).toBeNull();
        expect(dimensions.replacementOf).toBeNull();
        expect(notice.code).toBe(code);
        // The farmer reads this, so it is Thai and it names the next action.
        expect(notice.messageTh).toMatch(/[ก-๙]/);
    });

    // A replacement also removes requirements, so it follows the same holder rule
    // (operator ruling 2026-10-03).
    test.each([
        ['a certificate of another holder', prismaWith({ ...LIVE_CERT, application: { entityId: 'entity-other' } }), 'PREVIOUS_CERTIFICATE_OTHER_HOLDER'],
        ['a VIEWER of the holder', prismaWith(LIVE_CERT, { id: 'm-1', role: 'VIEWER', permissions: [], status: 'ACTIVE' }), 'PREVIOUS_CERTIFICATE_NO_SUBMIT_RIGHT'],
    ])('REPLACEMENT with %s falls back to NEW and says why', async (_label, prisma, code) => {
        const { dimensions, notice } = await resolveLawDimensions({
            ...base, prisma, claimed: { requestType: 'REPLACEMENT', previousCertificateNumber: 'GACP-TH-2569-ABC123' },
        });
        expect(dimensions.requestType).toBe('NEW');
        expect(dimensions.replacementOf).toBeNull();
        expect(notice.code).toBe(code);
    });

    test('an unverified claim NEVER throws — the autosave must still save', async () => {
        await expect(resolveLawDimensions({
            ...base,
            prisma: { certificate: { findFirst: jest.fn(async () => { throw new Error('db down'); }) } },
            claimed: { requestType: 'RENEWAL', previousCertificateNumber: 'GACP-TH-2569-ABC123' },
        })).resolves.toMatchObject({ dimensions: { requestType: 'NEW' } });
    });

    test('saying nothing about the request type leaves the filing untouched', async () => {
        const { dimensions, notice } = await resolveLawDimensions({
            ...base, prisma: prismaWith(LIVE_CERT), stored: { requestType: 'RENEWAL', renewalOf: 'cert-1' }, claimed: {},
        });
        expect(dimensions).toEqual({});
        expect(notice).toBeNull();
    });
});

describe('what the resolver may return at all', () => {
    test('it writes ONLY server-owned keys — never an applicant field', () => {
        const { SERVER_OWNED_FORM_DATA_KEYS } = require('../../shared/form-data-ownership');
        const { LAW_DIMENSION_KEYS } = require('../../services/application-law-dimensions');
        for (const key of LAW_DIMENSION_KEYS) {
            expect(SERVER_OWNED_FORM_DATA_KEYS).toContain(key);
        }
    });
});
