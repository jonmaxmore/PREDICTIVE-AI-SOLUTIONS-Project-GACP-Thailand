'use strict';
/**
 * RED-first, Tier C (F-G4-64, spec §4 proofs 1, 2 and 4).
 *
 * Before this change these three cases PASS while describing a defect, which is
 * the point of pasting them first:
 *   1. a checkout session is created while the quotation is still PENDING;
 *   2. a checkout session is created when there is NO quotation at all
 *      (this is application A2: 35,310 THB, two receipts, an active
 *      certificate, no pricing document - register.md B);
 *   4. a checkout session is created when the amount does not match the
 *      figures the applicant accepted.
 * After the change all three must REFUSE, and nothing may be minted.
 *
 * Q4 payment-terms disclosure follows coordinator ruling 2 (2026-08-28): ONE
 * consent namespace. The card rail asks the same UserConsent ledger the slip
 * rail asks, versioned by ConsentVersions.PAYMENT_TERMS - a client-supplied
 * "I accepted" object is NOT a door. checkout_orders records the version the
 * order was created under and the instant copied from the consent row.
 *
 * Mock scaffold follows stripe-checkout-engine.test.js. Every env-driven
 * predicate is pinned at file top rather than inherited from apps/backend/.env.
 */

// Placeholder credential, split so secret-literal scanners never match it.
process.env.STRIPE_SECRET_KEY = 'sk_test_' + 'x'.repeat(24);
// PromptPay QR step: a checkout now also needs a publishable key of the same
// mode (fail-closed otherwise). Placeholder, split like the secret above.
process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_' + 'x'.repeat(24);
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_' + 'x'.repeat(24);
process.env.STRIPE_CHECKOUT_ENABLED = 'true';
// consent-manager resolves ConsentVersions at require time; pin it so this
// suite asserts a known string instead of whatever the box's .env carries.
process.env.CONSENT_VERSION_PAYMENT_TERMS = 'payment-terms-th-v1.2';

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

const mockIntentCreate = jest.fn();
jest.mock('stripe', () => jest.fn(() => ({
    paymentIntents: {
        create: (...a) => mockIntentCreate(...a),
        // Review I-1: a re-entered order's intent is retrieved and reused.
        retrieve: async (id) => ({ id, status: 'requires_action', client_secret: `${id}_secret` }),
    },
    webhooks: { constructEvent: jest.fn() },
})));

const mockFindQuotations = jest.fn();
jest.mock('../../services/quotation-service', () => {
    const actual = jest.requireActual('../../services/quotation-service');
    return {
        ...actual,
        findQuotationsByApplicationId: (...a) => mockFindQuotations(...a),
    };
});

const mockAuditLog = jest.fn(async () => ({}));
jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: (...a) => mockAuditLog(...a) },
    AuditCategory: { PAYMENT: 'PAYMENT' },
    AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING', ERROR: 'ERROR', CRITICAL: 'CRITICAL' },
    ResourceType: { APPLICATION: 'APPLICATION', PAYMENT: 'PAYMENT' },
}));

// Fix round 1 (reviewer, major 2): the CHECKOUT_PRICE_DRIFT copy ends
// "เจ้าหน้าที่ได้รับแจ้งแล้ว" and gives the applicant no other action, while the
// only record the code wrote was one audit row (swallowed on failure, null-ed on
// an org-resolve failure, and otherwise a console line). The refusal has to
// reach a human who can act, so the helper is mocked here and asserted - the
// same pattern T7 uses to make the identical sentence true for
// QUOTATION_ISSUE_FAILED.
const mockNotifyDrift = jest.fn(async () => {});
jest.mock('../../services/notification/domain-helpers', () => ({
    notifyAdminCheckoutPriceDrift: (...a) => mockNotifyDrift(...a),
}));

const mockDb = {
    application: { findFirst: jest.fn() },
    // updateMany, not update: the re-entry binding carries a status predicate
    // so a concurrently SETTLED order is never re-opened (fix round 2, major 1).
    checkoutOrder: {
        findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(),
    },
    invoice: { create: jest.fn(), update: jest.fn() },
    invoiceLineItem: { createMany: jest.fn(async () => ({ count: 3 })) },
    paymentTransaction: { create: jest.fn(), update: jest.fn() },
    // T1 added the model; the mock must carry it or a missing-model TypeError
    // gets caught by the gate and read as "policy refused" (synthesis 5.7).
    quotation: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    // Same trap on the consent side: no model -> the terms gate refuses for the
    // wrong reason. Both gates are fail-closed, so both mocks must be real.
    userConsent: { findFirst: jest.fn() },
    $transaction: jest.fn(async (cb) => cb(mockDb)),
};
jest.mock('../../services/prisma-database', () => ({ prisma: mockDb }));

const { createCheckoutForApplication } =
    require('../../services/checkout/stripe-checkout-service');
const { buildAcceptanceSnapshot, canonicalSnapshotHash } =
    require('../../services/quotation-service');
const { ConsentVersions } = require('../../middleware/consent-manager');

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

/** The register's QT-PRD-2026-000001, priced for one scope. */
const ROW = {
    id: 'qt-1',
    quotationNumber: 'QT-PRD-2026-000001',
    issuerType: 'PLATFORM',
    status: 'PENDING',
    subtotal: '33000.00',
    vat: '2310.00',
    totalAmount: '35310.00',
    validUntil: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    installments: [
        { phase: 'PHASE_1', amount: 5885, serviceFeeAmount: 5500, vatAmount: 385, scopeCount: 1 },
        { phase: 'PHASE_2', amount: 29425, serviceFeeAmount: 27500, vatAmount: 1925, scopeCount: 1 },
    ],
};

function acceptedRow(overrides = {}) {
    const row = { ...ROW, status: 'ACCEPTED', ...overrides };
    return { ...row, acceptedSnapshot: overrides.acceptedSnapshot ?? buildAcceptanceSnapshot(row) };
}

/**
 * The same document accepted at a THREE-scope price: PHASE_1 is 17,655 while
 * this application's live decomposition is one scope (5,885). One fixture for
 * every drift case so the mint door and the re-entry door are proved against
 * the identical disagreement.
 */
function acceptedThreeScopeRow() {
    return acceptedRow({
        installments: [
            { phase: 'PHASE_1', amount: 17655, serviceFeeAmount: 16500, vatAmount: 1155, scopeCount: 3 },
            { phase: 'PHASE_2', amount: 88275, serviceFeeAmount: 82500, vatAmount: 5775, scopeCount: 3 },
        ],
    });
}

/** A drain-window order: minted before the gate existed, so nothing binds it. */
/**
 * An order minted under the gate and still inside the drain window.
 *
 * The columns read `dtam 5,000 / net 500 / vat 385` until 2026-09-11. The
 * charge was always 5,885 and still is — but the operator retired the
 * state/platform split, so `breakdownForMilestone` now writes the whole
 * ค่าบริการ into `platform_fee_net` and 0 into the dtam column. Left at the old
 * spelling this fixture asserts that a matching order drifts, which is the
 * opposite of what it exists to pin.
 *
 * The real orders that carry the old spelling are covered in the report: a
 * PENDING_PAYMENT order minted before the change is refused on re-entry as
 * CHECKOUT_PRICE_DRIFT even though its total never moved. That is the gate
 * doing its job on columns it can no longer interpret, and it is an operator
 * call (backfill the open orders, or let them expire), not one this test makes.
 */
function drainWindowOrder(overrides = {}) {
    return {
        id: 'co-old',
        applicationId: 'app-1',
        milestone: 'M1',
        status: 'PENDING_PAYMENT',
        platformFeeNet: '5500.00',
        platformFeeVat: '385.00',
        platformFeeGross: '5885.00',
        totalPayableAmount: '5885.00',
        stripePaymentIntentId: 'pi_1',
        quotationId: null,
        quotationSnapshotHash: null,
        ...overrides,
    };
}

/** A granted PAYMENT_TERMS consent at the CURRENT version - the slip rail's ledger. */
const GRANTED_AT = new Date('2026-08-28T03:00:00.000Z');
function grantedConsent(overrides = {}) {
    return {
        id: 'consent-1',
        version: ConsentVersions.PAYMENT_TERMS,
        granted: true,
        grantedAt: GRANTED_AT,
        updatedAt: GRANTED_AT,
        ...overrides,
    };
}

function armMint() {
    mockDb.checkoutOrder.findFirst.mockResolvedValue(null);
    mockDb.checkoutOrder.create.mockImplementation(async ({ data }) => ({ id: 'co-1', ...data }));
    mockDb.invoice.create.mockImplementation(async ({ data }) => ({ id: 'inv-1', ...data }));
    mockDb.paymentTransaction.create.mockImplementation(async ({ data }) => ({ id: 'pt-1', ...data }));
    mockDb.checkoutOrder.update.mockImplementation(async ({ data }) => ({ id: 'co-1', ...data }));
    mockDb.checkoutOrder.updateMany.mockResolvedValue({ count: 1 });
    mockIntentCreate.mockResolvedValue({ id: 'pi_1', client_secret: 'pi_1_secret', status: 'requires_payment_method' });
}

beforeEach(() => {
    jest.clearAllMocks();
    // clearAllMocks forgets the CALLS, not the implementations: a test that
    // arms a failing audit or notification sink would leak that failure into
    // every test after it. Re-arm both explicitly.
    mockAuditLog.mockResolvedValue({});
    mockNotifyDrift.mockResolvedValue(undefined);
    mockDb.$transaction.mockImplementation(async (cb) => cb(mockDb));
    mockDb.invoiceLineItem.createMany.mockResolvedValue({ count: 3 });
    mockDb.application.findFirst.mockResolvedValue(APPLICATION);
    mockDb.userConsent.findFirst.mockResolvedValue(grantedConsent());
    armMint();
});

const call = (over = {}) => createCheckoutForApplication({
    applicationId: 'app-1',
    milestone: 'M1',
    actor: { id: 'user-1', holderScope: { userId: 'user-1', readIds: ['ent-1'], editIds: ['ent-1'] }, healthId: 'HID-1' },
    ...over,
});

describe('RED proof 1 - a PENDING quotation must not be payable', () => {
    it('refuses with QUOTATION_NOT_ACCEPTED and mints nothing', async () => {
        mockFindQuotations.mockResolvedValue({ dtam: null, platform: { ...ROW } });
        await expect(call()).rejects.toMatchObject({ code: 'QUOTATION_NOT_ACCEPTED', status: 409 });
        expect(mockDb.checkoutOrder.create).not.toHaveBeenCalled();
        expect(mockIntentCreate).not.toHaveBeenCalled();
    });
});

describe('RED proof 2 - no quotation at all must not be payable (application A2)', () => {
    it('refuses with QUOTATION_NOT_ISSUED and mints nothing', async () => {
        mockFindQuotations.mockResolvedValue({ dtam: null, platform: null });
        await expect(call()).rejects.toMatchObject({ code: 'QUOTATION_NOT_ISSUED', status: 409 });
        expect(mockDb.checkoutOrder.create).not.toHaveBeenCalled();
        expect(mockIntentCreate).not.toHaveBeenCalled();
    });
});

describe('RED proof 4 - a charge that differs from the accepted snapshot must not be created', () => {
    it('refuses with CHECKOUT_PRICE_DRIFT, writes an audit row, and mints nothing', async () => {
        // The applicant accepted a 3-scope price; the live decomposition for
        // this application is 1 scope. This is exactly channel A of
        // synthesis.md 3.3 (checkout does not pass options.scopeCount): today
        // it charges the smaller amount silently.
        mockFindQuotations.mockResolvedValue({ dtam: null, platform: acceptedThreeScopeRow() });
        await expect(call()).rejects.toMatchObject({ code: 'CHECKOUT_PRICE_DRIFT', status: 409 });
        expect(mockDb.checkoutOrder.create).not.toHaveBeenCalled();
        expect(mockIntentCreate).not.toHaveBeenCalled();
        expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({
            action: 'CHECKOUT_PRICE_DRIFT',
        }));
    });
});

describe('the accepted path', () => {
    it('mints the order, bound to the quotation and to the hash of what was accepted', async () => {
        const row = acceptedRow();
        mockFindQuotations.mockResolvedValue({ dtam: null, platform: row });
        const result = await call();
        const created = mockDb.checkoutOrder.create.mock.calls[0][0].data;
        expect(created.quotationId).toBe('qt-1');
        expect(created.quotationSnapshotHash).toBe(canonicalSnapshotHash(row.acceptedSnapshot));
        // Ruling 2: the version is the consent namespace's own current value,
        // not a string the client sent.
        expect(created.paymentTermsVersion).toBe(ConsentVersions.PAYMENT_TERMS);
        expect(created.paymentTermsVersion).toBe('payment-terms-th-v1.2');
        expect(created.paymentTermsAcceptedAt).toBeInstanceOf(Date);
        expect(created.paymentTermsAcceptedAt.toISOString()).toBe(GRANTED_AT.toISOString());
        // The money is untouched: same fee-service decomposition as before.
        expect(created.totalPayableAmount).toBe(5885);
        expect(result.quotationNumber).toBe('QT-PRD-2026-000001');
    });

    it('records the acceptance hash the row already stores when it has one', async () => {
        const row = { ...acceptedRow(), acceptedSnapshotHash: 'stored-hash-1' };
        mockFindQuotations.mockResolvedValue({ dtam: null, platform: row });
        await call();
        const created = mockDb.checkoutOrder.create.mock.calls[0][0].data;
        expect(created.quotationSnapshotHash).toBe('stored-hash-1');
    });

    it('refuses without a granted payment-terms consent (Q4, now on this rail too)', async () => {
        mockFindQuotations.mockResolvedValue({ dtam: null, platform: acceptedRow() });
        mockDb.userConsent.findFirst.mockResolvedValue(null);
        await expect(call()).rejects.toMatchObject({ code: 'PAYMENT_TERMS_NOT_ACCEPTED', status: 409 });
        expect(mockDb.checkoutOrder.create).not.toHaveBeenCalled();
        expect(mockIntentCreate).not.toHaveBeenCalled();
    });

    it('a client-supplied acknowledgment is not a door: only the consent ledger opens it', async () => {
        mockFindQuotations.mockResolvedValue({ dtam: null, platform: acceptedRow() });
        mockDb.userConsent.findFirst.mockResolvedValue(null);
        await expect(call({
            paymentTermsAccepted: { version: 'payment-terms-th-v1.2', acceptedAt: new Date().toISOString() },
        })).rejects.toMatchObject({ code: 'PAYMENT_TERMS_NOT_ACCEPTED', status: 409 });
        expect(mockDb.checkoutOrder.create).not.toHaveBeenCalled();
    });

    it('a consent granted under an OLDER terms version does not satisfy the gate', async () => {
        mockFindQuotations.mockResolvedValue({ dtam: null, platform: acceptedRow() });
        mockDb.userConsent.findFirst.mockResolvedValue(grantedConsent({ version: '1.0.0' }));
        await expect(call()).rejects.toMatchObject({ code: 'PAYMENT_TERMS_NOT_ACCEPTED', status: 409 });
        expect(mockDb.checkoutOrder.create).not.toHaveBeenCalled();
    });

    it('an INVOICED quotation with no snapshot (a repaired pre-gate row) passes the gate but is not drift-checked', async () => {
        mockFindQuotations.mockResolvedValue({
            dtam: null, platform: { ...ROW, status: 'INVOICED', acceptedSnapshot: null },
        });
        const result = await call();
        expect(result.checkoutOrderId).toBe('co-1');
        const created = mockDb.checkoutOrder.create.mock.calls[0][0].data;
        expect(created.quotationId).toBe('qt-1');
        expect(created.quotationSnapshotHash).toBeNull();
    });
});

describe('DRAFT is no longer an M1-payable state', () => {
    it('refuses CHECKOUT_MILESTONE_NOT_PAYABLE before it even looks for a quotation', async () => {
        mockDb.application.findFirst.mockResolvedValue({ ...APPLICATION, status: 'DRAFT' });
        mockFindQuotations.mockResolvedValue({ dtam: null, platform: acceptedRow() });
        await expect(call()).rejects.toMatchObject({ code: 'CHECKOUT_MILESTONE_NOT_PAYABLE', status: 409 });
        expect(mockFindQuotations).not.toHaveBeenCalled();
    });
});

describe('re-entry is gated too', () => {
    it('an existing PENDING_PAYMENT order cannot be re-entered while the quotation is PENDING', async () => {
        mockDb.checkoutOrder.findFirst.mockResolvedValue(
            drainWindowOrder({ stripePaymentIntentId: 'pi_old' }));
        mockFindQuotations.mockResolvedValue({ dtam: null, platform: { ...ROW } });
        await expect(call()).rejects.toMatchObject({ code: 'QUOTATION_NOT_ACCEPTED' });
        expect(mockIntentCreate).not.toHaveBeenCalled();
    });

    // Fix round 1 (reviewer, major 1). Acceptance was gated on re-entry; the
    // PRICE was not. A drain-window order holds 5,885 while the document the
    // applicant has now accepted prices PHASE_1 at 17,655 (a scope revision
    // after issuance, open F-G4-70). Without this the applicant is handed the
    // old PaymentIntent for the smaller figure, with no refusal, no audit row,
    // and quotation_id still NULL so T6 cannot close the quotation from it.
    it('a drain-window order priced below the accepted document is refused, not re-entered', async () => {
        mockDb.checkoutOrder.findFirst.mockResolvedValue(drainWindowOrder());
        mockFindQuotations.mockResolvedValue({ dtam: null, platform: acceptedThreeScopeRow() });

        await expect(call()).rejects.toMatchObject({ code: 'CHECKOUT_PRICE_DRIFT', status: 409 });

        // Nothing was minted, nothing was asked of the gateway, and the stale
        // order was not touched.
        expect(mockIntentCreate).not.toHaveBeenCalled();
        expect(mockDb.checkoutOrder.create).not.toHaveBeenCalled();
        expect(mockDb.checkoutOrder.update).not.toHaveBeenCalled();
        // A refused re-entry binds nothing either: the refusal is raised before
        // the provenance stamp, so a drifted order never gains a quotation id
        // that would say the charge was checked and accepted.
        expect(mockDb.checkoutOrder.updateMany).not.toHaveBeenCalled();
        expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({
            action: 'CHECKOUT_PRICE_DRIFT',
            metadata: expect.objectContaining({
                acceptedPhaseTotal: '17655.00',
                livePhaseTotal: '5885.00',
                // Which door refused, so a human reading the row can tell a
                // stale order from a fresh mint without re-deriving it.
                entry: 'RE_ENTRY',
            }),
        }));
        expect(mockNotifyDrift).toHaveBeenCalledTimes(1);
    });

    // Pin (born green): the check must be a no-op for every order minted under
    // the gate, or this fix would close the door on paying applicants.
    it('an order that matches the accepted document is still re-entered, not refused', async () => {
        mockDb.checkoutOrder.findFirst.mockResolvedValue(drainWindowOrder());
        mockFindQuotations.mockResolvedValue({ dtam: null, platform: acceptedRow() });

        const result = await call();

        expect(result.checkoutOrderId).toBe('co-old');
        expect(result.breakdown.totalPayableAmount).toBe(5885);
        expect(mockDb.checkoutOrder.create).not.toHaveBeenCalled();
        expect(mockAuditLog).not.toHaveBeenCalled();
        expect(mockNotifyDrift).not.toHaveBeenCalled();
    });

    // Fix round 2 (reviewer, major 1). The comparison guarded both doors; the
    // BINDING guarded only the mint. So a drain-window order passed the drift
    // check, was handed back, paid and SETTLED with quotation_id still NULL —
    // and the closure probe this plan specifies joins
    // `checkout_orders o JOIN quotations q ON q.id = o.quotation_id`, an INNER
    // JOIN that drops the row, so the probe reports PASS while that quotation
    // never reaches INVOICED and nothing records which priced document those
    // baht collected against. The comparison has just proved which document and
    // which figures this charge answers to; writing it down is four columns.
    it('a matching drain-window order is bound to the document it was just checked against', async () => {
        const row = acceptedRow();
        mockDb.checkoutOrder.findFirst.mockResolvedValue(drainWindowOrder());
        mockFindQuotations.mockResolvedValue({ dtam: null, platform: row });

        const result = await call();

        expect(result.checkoutOrderId).toBe('co-old');
        expect(mockDb.checkoutOrder.updateMany).toHaveBeenCalledWith({
            // The status predicate is load-bearing: settlement can commit
            // between the read above and this write, and a SETTLED order must
            // never be re-opened by a provenance stamp.
            where: { id: 'co-old', status: 'PENDING_PAYMENT' },
            data: {
                quotationId: 'qt-1',
                quotationSnapshotHash: canonicalSnapshotHash(row.acceptedSnapshot),
                paymentTermsVersion: ConsentVersions.PAYMENT_TERMS,
                paymentTermsAcceptedAt: GRANTED_AT,
            },
        });
        // Provenance only: no money column is in that payload, and nothing new
        // is minted.
        expect(mockDb.checkoutOrder.create).not.toHaveBeenCalled();
    });

    // Pin (born green): the stamp is a repair, not a rewrite on every press. An
    // order that ALREADY names the document the gate just returned is left
    // alone - one UPDATE per re-entry on an unchanged row is noise on a money
    // table.
    it('an order that already names the same quotation is not re-stamped', async () => {
        mockDb.checkoutOrder.findFirst.mockResolvedValue(drainWindowOrder({ quotationId: 'qt-1' }));
        mockFindQuotations.mockResolvedValue({ dtam: null, platform: acceptedRow() });

        await call();

        expect(mockDb.checkoutOrder.updateMany).not.toHaveBeenCalled();
    });

    // Fix round 3 (reviewer r2, minor 2). The stamp fired on a NULL pointer
    // only, so an order pointing at a SUPERSEDED document kept that pointer
    // while the charge had just been compared against a DIFFERENT document's
    // snapshot. That is reachable through the path the catalogue itself
    // prescribes: CHECKOUT_PRICE_DRIFT tells staff to re-issue, and
    // `quotations_application_issuer_live_uq` (partial on isDeleted=false)
    // makes a re-issue a soft-delete plus a NEW id. The applicant then pays an
    // order naming a soft-deleted row, and T6's close plus the closure probe's
    // `JOIN quotations q ON q.id = o.quotation_id` land on the wrong document.
    it('an order naming a different quotation is re-stamped to the one just checked', async () => {
        const live = acceptedRow({ id: 'qt-2' });
        // The superseded row this order was minted against; the gate returns
        // qt-2, and the figures agree, or the drift refusal above would have
        // fired before this line.
        mockDb.checkoutOrder.findFirst.mockResolvedValue(drainWindowOrder({
            quotationId: 'qt-1',
            quotationSnapshotHash: 'hash-of-the-superseded-document',
        }));
        mockFindQuotations.mockResolvedValue({ dtam: null, platform: live });

        const result = await call();

        expect(result.checkoutOrderId).toBe('co-old');
        expect(mockDb.checkoutOrder.updateMany).toHaveBeenCalledWith({
            where: { id: 'co-old', status: 'PENDING_PAYMENT' },
            data: {
                quotationId: 'qt-2',
                quotationSnapshotHash: canonicalSnapshotHash(live.acceptedSnapshot),
                paymentTermsVersion: ConsentVersions.PAYMENT_TERMS,
                paymentTermsAcceptedAt: GRANTED_AT,
            },
        });
        expect(mockDb.checkoutOrder.create).not.toHaveBeenCalled();
    });
});

describe('the drift refusal reaches a human, because its copy says it did', () => {
    // Fix round 1 (reviewer, major 2).
    it('notifies the admin queue with both figures and the document number', async () => {
        mockFindQuotations.mockResolvedValue({ dtam: null, platform: acceptedThreeScopeRow() });

        await expect(call()).rejects.toMatchObject({ code: 'CHECKOUT_PRICE_DRIFT' });

        expect(mockNotifyDrift).toHaveBeenCalledWith(expect.objectContaining({
            applicationId: 'app-1',
            applicationNumber: 'APP-2026-000001',
            quotationNumber: 'QT-PRD-2026-000001',
            acceptedPhaseTotal: '17655.00',
            livePhaseTotal: '5885.00',
        }));
    });

    it('still notifies, and still refuses, when the audit row cannot be written', async () => {
        mockFindQuotations.mockResolvedValue({ dtam: null, platform: acceptedThreeScopeRow() });
        mockAuditLog.mockRejectedValue(new Error('audit sink down'));

        await expect(call()).rejects.toMatchObject({ code: 'CHECKOUT_PRICE_DRIFT', status: 409 });

        expect(mockNotifyDrift).toHaveBeenCalledTimes(1);
        expect(mockDb.checkoutOrder.create).not.toHaveBeenCalled();
    });

    it('still refuses when the notification sink is down', async () => {
        mockFindQuotations.mockResolvedValue({ dtam: null, platform: acceptedThreeScopeRow() });
        mockNotifyDrift.mockRejectedValue(new Error('notification sink down'));

        await expect(call()).rejects.toMatchObject({ code: 'CHECKOUT_PRICE_DRIFT', status: 409 });
        expect(mockIntentCreate).not.toHaveBeenCalled();
    });
});

describe('a snapshot that is silent about the instalment being charged', () => {
    // Fix round 1 (reviewer, minor 3): `accepted` was null both for "no
    // snapshot" (legacy row, correctly not compared) and for "this snapshot
    // does not price this phase", and the second case skipped the check
    // entirely - a fail-open branch inside a check whose whole purpose is to be
    // fail-closed. Reachable by construction: quotation-service builds PHASE_2
    // only for a renewal, so a renewal document says nothing about PHASE_1.
    //
    // Fix round 2 (reviewer, minor 2): the code raised here used to be
    // QUOTATION_PHASE_NOT_PRICED, which was minted for the PDF renderer and
    // tells the applicant "ระบบจึงไม่ออกเอกสาร" plus a next action about opening
    // another instalment's DOCUMENT. This door refuses a PAYMENT, so it needs
    // its own row and its own copy.
    it('refuses CHECKOUT_PHASE_NOT_PRICED rather than charging against a silent document', async () => {
        const phase2Only = acceptedRow({
            installments: [
                { phase: 'PHASE_2', amount: 29425, serviceFeeAmount: 27500, vatAmount: 1925, scopeCount: 1 },
            ],
        });
        mockFindQuotations.mockResolvedValue({ dtam: null, platform: phase2Only });

        await expect(call()).rejects.toMatchObject({ code: 'CHECKOUT_PHASE_NOT_PRICED', status: 409 });
        expect(mockDb.checkoutOrder.create).not.toHaveBeenCalled();
        expect(mockIntentCreate).not.toHaveBeenCalled();
    });
});

describe('the comparison is on value, not on how the snapshot was serialised', () => {
    // Fix round 1 (reviewer, minor 7): String(5000) is '5000', not '5000.00',
    // so a snapshot whose money fields are numbers made every checkout for that
    // application refuse and write a CRITICAL audit row asserting a mismatch
    // that does not exist - fail-closed, but a self-inflicted payment outage.
    it('a snapshot whose money fields are numbers is not a drift', async () => {
        mockFindQuotations.mockResolvedValue({
            dtam: null,
            platform: acceptedRow({
                acceptedSnapshot: {
                    quotationNumber: 'QT-PRD-2026-000001',
                    currency: 'THB',
                    installments: [{
                        phase: 'PHASE_1',
                        amount: 5885,
                        serviceFeeAmount: 5500,
                        vatAmount: 385,
                        phaseTotal: 5885,
                    }],
                },
            }),
        });

        const result = await call();

        expect(result.breakdown.totalPayableAmount).toBe(5885);
        expect(mockAuditLog).not.toHaveBeenCalled();
        expect(mockNotifyDrift).not.toHaveBeenCalled();
    });
});
