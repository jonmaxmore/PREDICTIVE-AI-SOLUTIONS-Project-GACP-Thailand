'use strict';
/**
 * F-G4-64, fix round 2 (reviewer, minor 3) — door ORDER, not just door set.
 *
 * The spec orders the doors ownership -> payable status -> quotation gate ->
 * payment terms -> DRIFT CHECK -> adapter.assertReady() -> any write. Round 1
 * ran assertReady() and the re-entry lookup first and argued the invariant
 * ("nothing is minted before every refusal has had its chance") still held. It
 * did. What it cost is this: with the gateway unconfigured or mis-keyed,
 * assertReady() throws first, so an application whose live figure disagrees
 * with the document the applicant accepted produces a gateway error and NO
 * CRITICAL audit row and NO admin alert. The one condition the drift check
 * exists to surface stays invisible for as long as the gateway is down, which
 * is exactly the window in which nobody is watching the payment rail.
 *
 * This suite pins the order by making the gateway unusable and asserting the
 * price refusal still arrives, with its audit row and its human alert.
 *
 * Its own file rather than a case in checkout-requires-accepted-quotation:
 * the payment adapter has to be replaced wholesale here, and that suite mints
 * through the real adapter seam.
 */

// Placeholder credential, split so secret-literal scanners never match it.
process.env.STRIPE_SECRET_KEY = 'sk_test_' + 'x'.repeat(24);
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_' + 'x'.repeat(24);
process.env.STRIPE_CHECKOUT_ENABLED = 'true';
process.env.CONSENT_VERSION_PAYMENT_TERMS = 'payment-terms-th-v1.2';

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

/**
 * The gateway is DOWN for this whole suite: assertReady() throws the way
 * stripe-adapter throws when the secret key is absent, and createCheckoutSession
 * must never be reached at all.
 */
const mockCreateSession = jest.fn();
const gatewayDown = () => Object.assign(
    new Error('STRIPE_SECRET_KEY is not set'), { code: 'STRIPE_NOT_CONFIGURED' },
);
jest.mock('../../services/payment/payment-adapter', () => ({
    getPaymentAdapter: () => ({
        assertReady: () => { throw gatewayDown(); },
        createCheckoutSession: (...a) => mockCreateSession(...a),
    }),
    parseEvent: jest.fn(),
    assertRawBody: jest.fn(),
}));

const mockFindQuotations = jest.fn();
jest.mock('../../services/quotation-service', () => {
    const actual = jest.requireActual('../../services/quotation-service');
    return { ...actual, findQuotationsByApplicationId: (...a) => mockFindQuotations(...a) };
});

// The audit writer is NOT mocked (whole-branch review C6). A fully mocked
// audit-logger let this suite assert that the CRITICAL row "is written" while
// the payload it passed could never survive the schema: AuditLog.actorRole is
// NOT NULL and the call omitted it, so every real occurrence was dropped by the
// create and swallowed by log()'s catch. The real writer runs here over the
// mocked Prisma sink, and the assertion is on the ROW that reaches
// prisma.auditLog.create.
const mockNotifyDrift = jest.fn(async () => {});
jest.mock('../../services/notification/domain-helpers', () => ({
    notifyAdminCheckoutPriceDrift: (...a) => mockNotifyDrift(...a),
}));

const mockDb = {
    application: { findFirst: jest.fn() },
    checkoutOrder: {
        findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(),
    },
    invoice: { create: jest.fn(), update: jest.fn() },
    invoiceLineItem: { createMany: jest.fn(async () => ({ count: 3 })) },
    paymentTransaction: { create: jest.fn(), update: jest.fn() },
    quotation: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    userConsent: { findFirst: jest.fn() },
    // The audit chain's own sink: the hash-chain tail read, the advisory lock
    // and the insert the real auditLogger performs inside its transaction.
    auditLog: { findFirst: jest.fn(async () => null), create: jest.fn(async ({ data }) => data) },
    $executeRaw: jest.fn(async () => 1),
    $transaction: jest.fn(async (cb) => cb(mockDb)),
};
jest.mock('../../services/prisma-database', () => ({ prisma: mockDb }));

const fs = require('node:fs');
const path = require('node:path');

const { createCheckoutForApplication } =
    require('../../services/checkout/stripe-checkout-service');
const { buildAcceptanceSnapshot } = require('../../services/quotation-service');
const { ConsentVersions } = require('../../middleware/consent-manager');

/**
 * Every column of AuditLog that the database will refuse a NULL on and that no
 * `@default` fills in — read from the schema itself, so a column added later
 * with no default is asserted here without anybody remembering to.
 *
 * Excluded by construction: optional columns (`Type?`), columns carrying a
 * `@default(...)`, and the `organization` relation field (not a stored column).
 */
function requiredAuditColumns() {
    const schema = fs.readFileSync(
        path.join(__dirname, '..', '..', 'prisma', 'schema', 'audit.prisma'), 'utf8',
    );
    const model = schema.slice(schema.indexOf('model AuditLog {'));
    const body = model.slice(0, model.indexOf('\n}'));
    const columns = [];
    for (const raw of body.split('\n').slice(1)) {
        const line = raw.split('//')[0].trim();
        const m = /^(\w+)\s+(\w+)(\??)/.exec(line);
        if (!m) { continue; }
        const [, name, _type, optional] = m;
        if (optional === '?' || line.includes('@default') || line.includes('@relation')) { continue; }
        columns.push(name);
    }
    return columns;
}

const APPLICATION = {
    id: 'app-1',
    applicationNumber: 'APP-2026-000001',
    status: 'PENDING_DOC_FEE',
    healthId: 'HID-1',
    organizationId: 'org-1',
    totalAreaTypes: 1,
    cultivationScopeCount: 1,
    formData: { cultivationMethods: ['outdoor'] },
};

/** Accepted at a three-scope price while this application decomposes to one. */
function acceptedThreeScopeRow() {
    const row = {
        id: 'qt-1',
        quotationNumber: 'QT-PRD-2026-000001',
        issuerType: 'PLATFORM',
        status: 'ACCEPTED',
        subtotal: '99000.00',
        vat: '6930.00',
        totalAmount: '105930.00',
        validUntil: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        installments: [
            { phase: 'PHASE_1', amount: 17655, serviceFeeAmount: 16500, vatAmount: 1155, scopeCount: 3 },
            { phase: 'PHASE_2', amount: 88275, serviceFeeAmount: 82500, vatAmount: 5775, scopeCount: 3 },
        ],
    };
    return { ...row, acceptedSnapshot: buildAcceptanceSnapshot(row) };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockDb.auditLog.findFirst.mockResolvedValue(null);
    mockDb.auditLog.create.mockImplementation(async ({ data }) => data);
    mockNotifyDrift.mockResolvedValue(undefined);
    mockDb.$transaction.mockImplementation(async (cb) => cb(mockDb));
    mockDb.application.findFirst.mockResolvedValue(APPLICATION);
    mockDb.checkoutOrder.findFirst.mockResolvedValue(null);
    mockDb.userConsent.findFirst.mockResolvedValue({
        id: 'consent-1',
        version: ConsentVersions.PAYMENT_TERMS,
        granted: true,
        grantedAt: new Date('2026-08-28T03:00:00.000Z'),
    });
});

const call = () => createCheckoutForApplication({
    applicationId: 'app-1',
    milestone: 'M1',
    // `role` is what the route threads from req.user (canonicalRole || role);
    // the audit row's actorRole comes from here and from nowhere else.
    actor: { id: 'user-1', holderScope: { userId: 'user-1', readIds: ['ent-1'], editIds: ['ent-1'] }, healthId: 'HID-1', role: 'health' },
});

describe('the price refusal does not depend on the gateway being up', () => {
    it('a drifted charge is refused as CHECKOUT_PRICE_DRIFT even while the gateway is unconfigured', async () => {
        mockFindQuotations.mockResolvedValue({ dtam: null, platform: acceptedThreeScopeRow() });

        await expect(call()).rejects.toMatchObject({ code: 'CHECKOUT_PRICE_DRIFT', status: 409 });

        expect(mockDb.checkoutOrder.create).not.toHaveBeenCalled();
        expect(mockCreateSession).not.toHaveBeenCalled();
    });

    it('and the CRITICAL audit row and the admin alert are still written', async () => {
        mockFindQuotations.mockResolvedValue({ dtam: null, platform: acceptedThreeScopeRow() });

        await expect(call()).rejects.toMatchObject({ code: 'CHECKOUT_PRICE_DRIFT' });

        expect(mockDb.auditLog.create).toHaveBeenCalledTimes(1);
        expect(mockDb.auditLog.create.mock.calls[0][0].data).toEqual(expect.objectContaining({
            action: 'CHECKOUT_PRICE_DRIFT',
            severity: 'CRITICAL',
        }));
        expect(mockNotifyDrift).toHaveBeenCalledTimes(1);
    });

    it('the row it writes carries a value for every NOT NULL column of AuditLog', async () => {
        mockFindQuotations.mockResolvedValue({ dtam: null, platform: acceptedThreeScopeRow() });

        await expect(call()).rejects.toMatchObject({ code: 'CHECKOUT_PRICE_DRIFT' });

        expect(mockDb.auditLog.create).toHaveBeenCalledTimes(1);
        const { data } = mockDb.auditLog.create.mock.calls[0][0];
        const missing = requiredAuditColumns().filter(
            (column) => data[column] === undefined || data[column] === null,
        );
        expect(missing).toEqual([]);
    });

    it('names the role that asked for the charge, so the row says WHO was refused', async () => {
        mockFindQuotations.mockResolvedValue({ dtam: null, platform: acceptedThreeScopeRow() });

        await expect(call()).rejects.toMatchObject({ code: 'CHECKOUT_PRICE_DRIFT' });

        const { data } = mockDb.auditLog.create.mock.calls[0][0];
        expect(data.actorRole).toBe('health');
        expect(data.actorId).toBe('user-1');
    });

    it('an actor with no role on the token is recorded as UNKNOWN, never as NULL', async () => {
        mockFindQuotations.mockResolvedValue({ dtam: null, platform: acceptedThreeScopeRow() });

        await expect(createCheckoutForApplication({
            applicationId: 'app-1',
            milestone: 'M1',
            actor: { id: 'user-1', holderScope: { userId: 'user-1', readIds: ['ent-1'], editIds: ['ent-1'] }, healthId: 'HID-1' },
        })).rejects.toMatchObject({ code: 'CHECKOUT_PRICE_DRIFT' });

        expect(mockDb.auditLog.create.mock.calls[0][0].data.actorRole).toBe('UNKNOWN');
    });

    it('a charge that MATCHES still fails on the gateway, so nothing here made the rail more permissive', async () => {
        const row = {
            id: 'qt-1',
            quotationNumber: 'QT-PRD-2026-000001',
            issuerType: 'PLATFORM',
            status: 'ACCEPTED',
            subtotal: '33000.00',
            vat: '2310.00',
            totalAmount: '35310.00',
            validUntil: new Date(Date.now() + 7 * 24 * 3600 * 1000),
            installments: [
                { phase: 'PHASE_1', amount: 5885, serviceFeeAmount: 5500, vatAmount: 385, scopeCount: 1 },
                { phase: 'PHASE_2', amount: 29425, serviceFeeAmount: 27500, vatAmount: 1925, scopeCount: 1 },
            ],
        };
        mockFindQuotations.mockResolvedValue({
            dtam: null, platform: { ...row, acceptedSnapshot: buildAcceptanceSnapshot(row) },
        });

        await expect(call()).rejects.toMatchObject({ code: 'STRIPE_NOT_CONFIGURED' });

        expect(mockDb.checkoutOrder.create).not.toHaveBeenCalled();
        expect(mockDb.auditLog.create).not.toHaveBeenCalled();
    });
});
