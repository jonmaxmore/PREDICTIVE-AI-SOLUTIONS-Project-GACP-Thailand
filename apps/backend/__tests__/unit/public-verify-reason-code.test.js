/**
 * Public verifier — machine reason codes + renewed-to-successor (ledger F-G4-57).
 *
 * GET /verify/:no already told a verifier WHY a certificate is not valid, but
 * only as free English prose (`data.reason`), and a certificate superseded by a
 * renewal (status 'renewed', Certificate.renewedCertificateId set by
 * services/renewal-service.js supersedeCertificate) came back with reason null:
 * "not valid", no word about the renewal, no pointer to the current document.
 *
 * This suite pins the ADDITIVE contract:
 *   data.reasonCode  — 'EXPIRED' | 'SUSPENDED' | 'REVOKED' | 'RENEWED' | null
 *   data.reason      — the SAME English strings as before, plus
 *                      'Certificate has been renewed' for the renewed case
 *   data.renewal     — { successorCertificateNumber } for a renewed row whose
 *                      renewedCertificateId resolves, else null. NOTHING else
 *                      about the successor leaks (no facts, no status).
 *
 * Harness: apps/backend/__tests__/unit/public-verify-revision.test.js — mocked
 * logger / rate limiter / prisma / cache-service over the REAL
 * certificate-service, so findSuccessorCertificateNumber is exercised for real.
 * Fixtures carry no documentHash / signature, so the crypto verdicts are the
 * unsigned ones and nothing here ever reads apps/backend/keys.
 */

'use strict';

const request = require('supertest');
const express = require('express');

jest.mock('../../shared/logger', () => {
    const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { ...log, createLogger: jest.fn(() => log), stream: { write: jest.fn() } };
});

jest.mock('../../middleware/rate-limiter', () => ({
    createRateLimiter: () => (_req, _res, next) => next(),
}));

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        certificate: { findUnique: jest.fn(), findFirst: jest.fn() },
        certificateRevision: { findMany: jest.fn(), findUnique: jest.fn() },
    },
}));

jest.mock('../../services/cache-service', () => ({
    invalidateAnalyticsCache: jest.fn().mockResolvedValue(undefined),
}));

const { prisma } = require('../../services/prisma-database');
const certificateService = require('../../services/certificate-service');
const { publicReasonFor } = require('../../routes/api/auth/public-verify-reason');
const publicRouter = require('../../routes/api/auth/public');

const CERT_NUMBER = 'GACP-TH-2569-A3F7B2';
const CERT_ID = 'cert-old-1';
const SUCCESSOR_ID = 'cert-new-1';
const SUCCESSOR_NUMBER = 'GACP-TH-2570-C41D9E';

const FUTURE = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000);

/**
 * The live row. No documentHash / signature on purpose: the reason-code
 * contract is independent of the crypto verdicts.
 */
function liveCert(overrides = {}) {
    return {
        id: CERT_ID,
        certificateNumber: CERT_NUMBER,
        verificationCode: 'A1B2C3D4',
        organizationId: 'org-1',
        status: 'active',
        isDeleted: false,
        revisionNo: 1,
        farmName: 'ฟาร์มสมุนไพรสมชาย',
        applicantName: 'สมชาย ใจดี',
        cropType: 'กัญชา',
        province: 'เชียงใหม่',
        standardName: 'GACP Thailand',
        issuedDate: new Date('2026-05-16T03:00:00Z'),
        expiryDate: FUTURE,
        renewedCertificateId: null,
        ...overrides,
    };
}

/**
 * The successor row as the id lookup sees it. Carries facts a leak would
 * expose, so the "nothing else about the successor" assertions have teeth.
 */
const SUCCESSOR_ROW = Object.freeze({
    id: SUCCESSOR_ID,
    certificateNumber: SUCCESSOR_NUMBER,
    status: 'active',
    farmName: 'ฟาร์มสมุนไพรสมชาย (ฉบับต่ออายุ)',
    province: 'เชียงราย',
});

/**
 * The mocked client must answer BOTH lookups the route now makes: the public
 * lookup by certificateNumber and the successor lookup by id.
 */
function mockRows({ live = null, successor = null } = {}) {
    prisma.certificate.findUnique.mockImplementation(async (args) => {
        const where = (args && args.where) || {};
        if (where.certificateNumber) {
            return where.certificateNumber === CERT_NUMBER ? live : null;
        }
        if (where.id) {
            return where.id === SUCCESSOR_ID ? successor : null;
        }
        return null;
    });
}

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/', publicRouter);
    return app;
}

beforeEach(() => {
    jest.clearAllMocks();
    prisma.certificate.findUnique.mockResolvedValue(null);
    prisma.certificateRevision.findMany.mockResolvedValue([]);
    prisma.certificateRevision.findUnique.mockResolvedValue(null);
});

describe('publicReasonFor — the one mapping from live state to the public reason', () => {
    it('(a) an active, unexpired certificate has no reason to report', () => {
        expect(publicReasonFor({ isExpired: false }, 'active')).toEqual({ code: null, reason: null });
    });

    it.each([
        ['suspended', 'SUSPENDED', 'Certificate is suspended'],
        ['revoked', 'REVOKED', 'Certificate has been revoked'],
        ['renewed', 'RENEWED', 'Certificate has been renewed'],
    ])('(b) stored status %s → %s', (stored, code, reason) => {
        expect(publicReasonFor({ isExpired: false }, stored)).toEqual({ code, reason });
    });

    it('(c) expiry wins over the stored status, as the endpoint has always answered', () => {
        expect(publicReasonFor({ isExpired: true }, 'active')).toEqual({
            code: 'EXPIRED',
            reason: 'Certificate has expired',
        });
        expect(publicReasonFor({ isExpired: true }, 'suspended')).toEqual({
            code: 'EXPIRED',
            reason: 'Certificate has expired',
        });
        expect(publicReasonFor({ isExpired: true }, 'renewed')).toEqual({
            code: 'EXPIRED',
            reason: 'Certificate has expired',
        });
    });

    it('(d) an unknown stored status is not invented into a code', () => {
        expect(publicReasonFor({ isExpired: false }, 'draft')).toEqual({ code: null, reason: null });
        expect(publicReasonFor({ isExpired: false }, undefined)).toEqual({ code: null, reason: null });
    });

    it('(e) the stored status is read case-insensitively, like the rest of the route', () => {
        expect(publicReasonFor({ isExpired: false }, 'REVOKED')).toEqual({
            code: 'REVOKED',
            reason: 'Certificate has been revoked',
        });
    });
});

describe('GET /verify/:no — data.reasonCode', () => {
    it('(f) an active certificate: reasonCode null, renewal null, verified true', async () => {
        mockRows({ live: liveCert() });
        const res = await request(buildApp()).get(`/verify/${CERT_NUMBER}`);

        expect(res.status).toBe(200);
        expect(res.body.verified).toBe(true);
        expect(res.body.valid).toBe(true);
        expect(res.body.data).toHaveProperty('reasonCode');
        expect(res.body.data.reasonCode).toBeNull();
        expect(res.body.data).toHaveProperty('renewal');
        expect(res.body.data.renewal).toBeNull();
        // Unchanged: an active certificate has never carried a reason.
        expect(res.body.data.reason).toBeNull();
    });

    it('(g) an expired certificate: EXPIRED, with the English string byte-identical', async () => {
        mockRows({ live: liveCert({ expiryDate: PAST }) });
        const res = await request(buildApp()).get(`/verify/${CERT_NUMBER}`);

        expect(res.status).toBe(200);
        expect(res.body.verified).toBe(false);
        expect(res.body.data.status).toBe('expired');
        expect(res.body.data.reasonCode).toBe('EXPIRED');
        expect(res.body.data.reason).toBe('Certificate has expired');
        expect(res.body.data.renewal).toBeNull();
        expect(res.body.data.certificate).toBeNull();
    });

    it('(h) a suspended certificate: SUSPENDED', async () => {
        mockRows({ live: liveCert({ status: 'suspended' }) });
        const res = await request(buildApp()).get(`/verify/${CERT_NUMBER}`);

        expect(res.status).toBe(200);
        expect(res.body.verified).toBe(false);
        expect(res.body.data.status).toBe('suspended');
        expect(res.body.data.reasonCode).toBe('SUSPENDED');
        expect(res.body.data.reason).toBe('Certificate is suspended');
        expect(res.body.data.renewal).toBeNull();
    });

    it('(i) a revoked certificate: REVOKED', async () => {
        mockRows({ live: liveCert({ status: 'revoked' }) });
        const res = await request(buildApp()).get(`/verify/${CERT_NUMBER}`);

        expect(res.status).toBe(200);
        expect(res.body.verified).toBe(false);
        expect(res.body.data.status).toBe('revoked');
        expect(res.body.data.reasonCode).toBe('REVOKED');
        expect(res.body.data.reason).toBe('Certificate has been revoked');
        expect(res.body.data.renewal).toBeNull();
    });

    it('(j) expiry still wins over the stored status on the wire', async () => {
        mockRows({ live: liveCert({ status: 'suspended', expiryDate: PAST }) });
        const res = await request(buildApp()).get(`/verify/${CERT_NUMBER}`);

        expect(res.body.data.status).toBe('expired');
        expect(res.body.data.reasonCode).toBe('EXPIRED');
        expect(res.body.data.reason).toBe('Certificate has expired');
    });
});

describe('GET /verify/:no — data.renewal (F-G4-57: a superseded certificate points at its successor)', () => {
    it('(k) renewed with a resolvable successor: RENEWED + the successor NUMBER only', async () => {
        mockRows({
            live: liveCert({ status: 'renewed', renewedCertificateId: SUCCESSOR_ID }),
            successor: { ...SUCCESSOR_ROW },
        });
        const res = await request(buildApp()).get(`/verify/${CERT_NUMBER}`);

        expect(res.status).toBe(200);
        expect(res.body.verified).toBe(false);
        expect(res.body.valid).toBe(false);
        expect(res.body.data.status).toBe('renewed');
        expect(res.body.data.reasonCode).toBe('RENEWED');
        // Was null before this change: the one existing value that moves.
        expect(res.body.data.reason).toBe('Certificate has been renewed');
        expect(res.body.data.renewal).toEqual({ successorCertificateNumber: SUCCESSOR_NUMBER });

        // The superseded certificate's own facts stay withheld (it is not active).
        expect(res.body.data.certificate).toBeNull();
        // And NOTHING else about the successor leaks: not its id, not its farm,
        // not its province, not its status.
        expect(res.text).not.toContain(SUCCESSOR_ID);
        expect(res.text).not.toContain('ฉบับต่ออายุ');
        expect(res.text).not.toContain('เชียงราย');

        // The successor is read by id, selecting the number and nothing else.
        const byId = prisma.certificate.findUnique.mock.calls
            .map(([args]) => args)
            .filter((args) => args && args.where && args.where.id);
        expect(byId).toHaveLength(1);
        expect(byId[0].where).toEqual({ id: SUCCESSOR_ID });
        expect(byId[0].select).toEqual({ certificateNumber: true });
    });

    it('(l) renewed whose successor row is gone: RENEWED reason, renewal null', async () => {
        mockRows({
            live: liveCert({ status: 'renewed', renewedCertificateId: 'cert-vanished' }),
            successor: { ...SUCCESSOR_ROW },
        });
        const res = await request(buildApp()).get(`/verify/${CERT_NUMBER}`);

        expect(res.status).toBe(200);
        expect(res.body.data.reasonCode).toBe('RENEWED');
        expect(res.body.data.reason).toBe('Certificate has been renewed');
        expect(res.body.data.renewal).toBeNull();
    });

    it('(m) renewed with no renewedCertificateId at all: renewal null, no id lookup', async () => {
        mockRows({ live: liveCert({ status: 'renewed', renewedCertificateId: null }) });
        const res = await request(buildApp()).get(`/verify/${CERT_NUMBER}`);

        expect(res.status).toBe(200);
        expect(res.body.data.reasonCode).toBe('RENEWED');
        expect(res.body.data.renewal).toBeNull();
        const byId = prisma.certificate.findUnique.mock.calls
            .map(([args]) => args)
            .filter((args) => args && args.where && args.where.id);
        expect(byId).toHaveLength(0);
    });

    it('(n) a NON-renewed row is never asked for a successor, even if the column is set', async () => {
        // A revoked row that once carried a renewal pointer must not advertise
        // a successor: only the 'renewed' supersession marker means "replaced".
        mockRows({
            live: liveCert({ status: 'revoked', renewedCertificateId: SUCCESSOR_ID }),
            successor: { ...SUCCESSOR_ROW },
        });
        const res = await request(buildApp()).get(`/verify/${CERT_NUMBER}`);

        expect(res.body.data.reasonCode).toBe('REVOKED');
        expect(res.body.data.renewal).toBeNull();
        expect(res.text).not.toContain(SUCCESSOR_NUMBER);
    });
});

describe('certificateService.findSuccessorCertificateNumber', () => {
    it('(o) returns the successor number and selects nothing else', async () => {
        prisma.certificate.findUnique.mockResolvedValue({ certificateNumber: SUCCESSOR_NUMBER });
        await expect(certificateService.findSuccessorCertificateNumber(SUCCESSOR_ID)).resolves.toBe(
            SUCCESSOR_NUMBER,
        );
        expect(prisma.certificate.findUnique).toHaveBeenCalledWith({
            where: { id: SUCCESSOR_ID },
            select: { certificateNumber: true },
        });
    });

    it('(p) answers null for a missing id, a missing row, and a row with no number', async () => {
        await expect(certificateService.findSuccessorCertificateNumber(null)).resolves.toBeNull();
        expect(prisma.certificate.findUnique).not.toHaveBeenCalled();

        prisma.certificate.findUnique.mockResolvedValueOnce(null);
        await expect(certificateService.findSuccessorCertificateNumber(SUCCESSOR_ID)).resolves.toBeNull();

        prisma.certificate.findUnique.mockResolvedValueOnce({ certificateNumber: null });
        await expect(certificateService.findSuccessorCertificateNumber(SUCCESSOR_ID)).resolves.toBeNull();
    });
});

/**
 * Fix round 1 (C-F1): a superseded certificate must never lose its successor
 * link. The renewal pointer is published for the STORED status 'renewed'
 * whatever the expiry does to the public status word — a renewed row that has
 * since passed its expiryDate answers reasonCode EXPIRED (expiry wins, as it
 * always has) and STILL carries data.renewal, so the page can send the citizen
 * to the current document instead of a dead end.
 */
describe('GET /verify/:no — an expired renewed row keeps its successor pointer (C-F1)', () => {
    it('(q) reasonCode EXPIRED, and data.renewal still names the successor', async () => {
        mockRows({
            live: liveCert({
                status: 'renewed',
                expiryDate: PAST,
                renewedCertificateId: SUCCESSOR_ID,
            }),
            successor: { ...SUCCESSOR_ROW },
        });
        const res = await request(buildApp()).get(`/verify/${CERT_NUMBER}`);

        expect(res.status).toBe(200);
        expect(res.body.verified).toBe(false);
        // Expiry wins over the stored status on the public word AND the code.
        expect(res.body.data.status).toBe('expired');
        expect(res.body.data.reasonCode).toBe('EXPIRED');
        expect(res.body.data.reason).toBe('Certificate has expired');
        // ...but the pointer to the current certificate survives.
        expect(res.body.data.renewal).toEqual({ successorCertificateNumber: SUCCESSOR_NUMBER });
        // Still nothing else about the successor.
        expect(res.text).not.toContain(SUCCESSOR_ID);
        expect(res.text).not.toContain('เชียงราย');
    });
});

/**
 * Fix round 1 (C-F2): the two commonest citizen failures — a number that is not
 * in the register at all, and a QR whose verification code does not match —
 * answered in English only. They now carry a machine code from the SAME table,
 * so the page can say them in Thai. The English `reason` strings are the ones
 * the endpoint has always sent and do not move.
 */
describe('GET /verify/:no — reason codes for the lookup failures (C-F2)', () => {
    it('(r) an unknown certificate number: NOT_FOUND, English reason unchanged', async () => {
        mockRows({ live: null });
        const res = await request(buildApp()).get('/verify/GACP-TH-2569-NOSUCH');

        expect(res.status).toBe(200);
        expect(res.body.verified).toBe(false);
        expect(res.body.valid).toBe(false);
        expect(res.body.data.status).toBe('invalid');
        expect(res.body.data.reason).toBe('Certificate not found');
        expect(res.body.data.reasonCode).toBe('NOT_FOUND');
    });

    it('(s) a QR whose verification code does not match: CODE_MISMATCH', async () => {
        mockRows({ live: liveCert() });
        const res = await request(buildApp()).get(`/verify/${CERT_NUMBER}?code=WRONGCODE`);

        expect(res.status).toBe(200);
        expect(res.body.verified).toBe(false);
        expect(res.body.valid).toBe(false);
        expect(res.body.data.status).toBe('invalid');
        expect(res.body.data.reason).toBe('Invalid verification code');
        expect(res.body.data.reasonCode).toBe('CODE_MISMATCH');
        // The mismatch branch still says nothing about the certificate itself.
        expect(res.body.data.certificate).toBeUndefined();
        expect(res.text).not.toContain('ฟาร์มสมุนไพรสมชาย');
    });

    it('(t) the matching verification code is still answered as before', async () => {
        mockRows({ live: liveCert() });
        const res = await request(buildApp()).get(`/verify/${CERT_NUMBER}?code=A1B2C3D4`);

        expect(res.body.verified).toBe(true);
        expect(res.body.data.reasonCode).toBeNull();
    });
});

/**
 * Fix round 1 (C-F3): the status table is a plain object, so a status that
 * happens to name something on Object.prototype ('constructor', 'toString',
 * '__proto__') used to resolve to an inherited value and be published as a
 * reason code. A status is only a code when the table OWNS the key.
 */
describe('publicReasonFor — prototype-chain keys are not statuses (C-F3)', () => {
    it.each(['constructor', 'toString', 'hasOwnProperty', 'valueOf', '__proto__'])(
        '(u) stored status %s reports no reason at all',
        (poisoned) => {
            expect(publicReasonFor({ isExpired: false }, poisoned)).toEqual({ code: null, reason: null });
        },
    );

    it('(v) and the poisoned status never reaches the wire as a code', async () => {
        mockRows({ live: liveCert({ status: 'constructor' }) });
        const res = await request(buildApp()).get(`/verify/${CERT_NUMBER}`);

        expect(res.status).toBe(200);
        expect(res.body.data.reasonCode).toBeNull();
        expect(res.body.data.reason).toBeNull();
    });
});
