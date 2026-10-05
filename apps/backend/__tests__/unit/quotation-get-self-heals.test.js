'use strict';
/**
 * GET /api/applications/:id/quotations re-issues, once, under control
 * (spec 3.4).
 *
 * The self-heal is deliberately narrow, and fix round 1 (reviewer MAJOR M2)
 * narrowed it further, because "past DRAFT" is not a window — it is everything
 * that ever happens to an application. REJECTED, EXPIRED, CANCEL_EXPIRED,
 * CERTIFIED and long-settled applications all sit past DRAFT, and the
 * population is real: filings from before Tier 18 (2026-05-16) and revision-door
 * filings from before the 2026-08-18 fix have no quotation row at all, which is
 * why a repair script exists. An accountant opening the billing screen of a
 * rejected 2026-06 application would have minted it a brand-new PENDING
 * quotation at today's rates, with a fresh QT-PRD number off the legal
 * sequence, unwithdrawable (soft delete only).
 *
 * So the door is now: the APPLICANT-OWNER is asking (a provider read never
 * mints), and the application is inside the pre-certification payable window —
 * the same window the card rail will actually take money in
 * (stripe-checkout-service PAYABLE_STATES, minus DRAFT). Anything else reads
 * without writing.
 *
 * The race is settled by the database, not by this function: the partial unique
 * index quotations_application_issuer_live_uq refuses the second row and
 * issueQuotationsForApplication reads back the winner
 * (quotation-issuance-idempotency.test.js).
 *
 * ACCEPTED LIMITATION, written into the row itself: a late issue prices at the
 * rate table AS IT IS NOW, because that table has no effective date
 * (config/business-rules.js:112-154). That is ledger F-G4-69 and is NOT fixed
 * here. The `notes` field says so, so nobody later reads the row as though it
 * had been priced on the submission date.
 */
const mockIssue = jest.fn();
const mockFind = jest.fn();
const mockReissue = jest.fn();
jest.mock('../../services/quotation-service', () => ({
    findQuotationsByApplicationId: (...a) => mockFind(...a),
    issueQuotationsForApplication: (...a) => mockIssue(...a),
    reissueLapsedQuotation: (...a) => mockReissue(...a),
}));
jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: () => l };
});
const mockAuditLog = jest.fn(async () => ({}));
jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: (...a) => mockAuditLog(...a) },
    AuditCategory: { APPLICATION: 'APPLICATION' },
    AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING', ERROR: 'ERROR' },
    ResourceType: { APPLICATION: 'APPLICATION' },
}));

const { ensureQuotationForIssuedApplication } =
    require('../../services/quotation-issuance-on-submit');
const { PAYABLE_STATES } = require('../../services/checkout/stripe-checkout-service');

beforeEach(() => jest.clearAllMocks());

/** The applicant-owner asking about a payable application — the only minting case. */
const OWNER = { actorId: 'user-1', actorRole: 'health' };

test('a DRAFT application is never quoted by the self-heal', async () => {
    mockFind.mockResolvedValue({ dtam: null, platform: null });
    const out = await ensureQuotationForIssuedApplication({
        application: { id: 'app-1', status: 'DRAFT', applicationNumber: 'APP-1' },
        ...OWNER,
    });
    expect(out).toEqual({ dtam: null, platform: null });
    expect(mockIssue).not.toHaveBeenCalled();
});

test('an application past DRAFT with no quotation is issued one, marked ISSUED_LATE', async () => {
    mockFind.mockResolvedValueOnce({ dtam: null, platform: null })
        .mockResolvedValueOnce({ dtam: null, platform: { id: 'qt-1', notes: 'ISSUED_LATE: MISSING_AT_READ' } });
    mockIssue.mockResolvedValue({ company: { id: 'qt-1' }, dtam: null, platform: { id: 'qt-1' } });
    const out = await ensureQuotationForIssuedApplication({
        application: { id: 'app-1', status: 'PENDING_DOC_FEE', applicationNumber: 'APP-1' },
        ...OWNER,
    });
    expect(mockIssue).toHaveBeenCalledWith('app-1', expect.objectContaining({
        notes: expect.stringContaining('ISSUED_LATE'),
    }));
    expect(out.platform.id).toBe('qt-1');
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({
        action: 'QUOTATION_ISSUED_LATE',
    }));
});

test('an application that already has a quotation is left completely alone', async () => {
    mockFind.mockResolvedValue({ dtam: null, platform: { id: 'qt-1', status: 'ACCEPTED' } });
    await ensureQuotationForIssuedApplication({
        application: { id: 'app-1', status: 'PENDING_DOC_FEE', applicationNumber: 'APP-1' },
        ...OWNER,
    });
    expect(mockIssue).not.toHaveBeenCalled();
});

test('a self-heal failure returns the empty result rather than failing the read', async () => {
    mockFind.mockResolvedValue({ dtam: null, platform: null });
    mockIssue.mockRejectedValue(new Error('numbering down'));
    const out = await ensureQuotationForIssuedApplication({
        application: { id: 'app-1', status: 'PENDING_DOC_FEE', applicationNumber: 'APP-1' },
        ...OWNER,
    });
    expect(out).toEqual({ dtam: null, platform: null });
});

/**
 * Fix round 1 (reviewer m1). The post-issue re-read was `return` without
 * `await` inside the try, so its rejection escaped the catch and broke the
 * "never rejects" contract the docstring states — and it did so AFTER the row
 * had been minted, so the applicant got a 500 from a read that had just
 * succeeded in writing. The old suite could not catch it: its mockFind always
 * resolved.
 */
test('a re-read that fails AFTER the row was minted still does not fail the read', async () => {
    mockFind.mockResolvedValueOnce({ dtam: null, platform: null })
        .mockRejectedValueOnce(new Error('read replica gone'));
    mockIssue.mockResolvedValue({ company: { id: 'qt-1' }, dtam: null, platform: { id: 'qt-1' } });
    const out = await ensureQuotationForIssuedApplication({
        application: { id: 'app-1', status: 'PENDING_DOC_FEE', applicationNumber: 'APP-1' },
        ...OWNER,
    });
    expect(out).toEqual({ dtam: null, platform: null });
});

/**
 * Fix round 1 (reviewer MAJOR M2, half 1) — a PROVIDER read never mints.
 *
 * The GET handler lets every provider role through with no ownership check
 * (routes/api/applications/quotations.js), and it is a state-changing GET
 * behind sameSite:'lax' cookie auth, so a link in an email can fire it. An
 * accountant, reviewer or auditor opening a billing screen must be able to see
 * that an application has no price of record — not create one by looking.
 */
describe('only the applicant-owner can make a read mint a document', () => {
    const PROVIDER_ROLES = ['admin', 'account', 'account_platform', 'document_reviewer', 'auditor'];

    test.each(PROVIDER_ROLES)('a %s read is a read, not an issuance', async (role) => {
        mockFind.mockResolvedValue({ dtam: null, platform: null });
        const out = await ensureQuotationForIssuedApplication({
            application: { id: 'app-1', status: 'PENDING_DOC_FEE', applicationNumber: 'APP-1' },
            actorId: 'user-9',
            actorRole: role,
        });
        expect(out).toEqual({ dtam: null, platform: null });
        expect(mockIssue).not.toHaveBeenCalled();
    });

    test('a caller with no role at all does not mint either', async () => {
        mockFind.mockResolvedValue({ dtam: null, platform: null });
        await ensureQuotationForIssuedApplication({
            application: { id: 'app-1', status: 'PENDING_DOC_FEE', applicationNumber: 'APP-1' },
        });
        expect(mockIssue).not.toHaveBeenCalled();
    });
});

/**
 * Fix round 1 (reviewer MAJOR M2, half 2) — the status ceiling.
 *
 * The window is DERIVED from the card rail's own PAYABLE_STATES rather than
 * retyped, so it cannot drift away from the states in which money is actually
 * taken. DRAFT is subtracted: an application still being written has no price
 * of record by design.
 */
describe('only an application inside the payable window is quoted late', () => {
    // Fix round 4 (R3). The window was PAYABLE_STATES.M1 ∪ M2 minus DRAFT,
    // which includes DOC_APPROVED and PENDING_AUDIT_FEE — two states that mean
    // งวดที่ 1 HAS ALREADY BEEN COLLECTED. issueQuotationsForApplication has no
    // notion of what is already paid: for a non-renewal it always emits
    // [PHASE_1, PHASE_2] at the full 35,310, so an unquoted application in
    // those states was handed a brand-new document billing money the applicant
    // had already transferred. Late issuance is now only for the window where
    // nothing has been paid yet.
    const PAYABLE = [...PAYABLE_STATES.M1].filter((s) => s !== 'DRAFT');

    test.each(PAYABLE)('%s is inside the window, so a missing quotation is healed', async (status) => {
        mockFind.mockResolvedValueOnce({ dtam: null, platform: null })
            .mockResolvedValueOnce({ dtam: null, platform: { id: 'qt-1' } });
        mockIssue.mockResolvedValue({ company: { id: 'qt-1' }, dtam: null, platform: { id: 'qt-1' } });
        await ensureQuotationForIssuedApplication({
            application: { id: 'app-1', status, applicationNumber: 'APP-1' },
            ...OWNER,
        });
        expect(mockIssue).toHaveBeenCalledTimes(1);
    });

    // Terminal and post-payment states. None of these will ever produce a
    // payment on either rail, so a priced document minted for them is a
    // document nobody can withdraw and nobody will pay.
    const OUTSIDE = [
        'REJECTED', 'EXPIRED', 'CANCEL_EXPIRED', 'CERTIFIED', 'REVOKED',
        'DOC_FEE_PAID', 'AUDIT_FEE_PAID', 'AUDIT_PASSED', 'REVISION_REQUESTED',
        // R3: phase 1 is already collected in both of these, so a fresh
        // two-phase document would bill money the applicant has already paid.
        // The refusal an unquoted M2-payable application meets is the gate's
        // QUOTATION_NOT_ISSUED plus the admin alert; the missing staff re-issue
        // door is ledger F-G4-71.
        'DOC_APPROVED', 'PENDING_AUDIT_FEE',
    ];

    test.each(OUTSIDE)('%s is outside the window, so the read stays a read', async (status) => {
        mockFind.mockResolvedValue({ dtam: null, platform: null });
        const out = await ensureQuotationForIssuedApplication({
            application: { id: 'app-1', status, applicationNumber: 'APP-1' },
            ...OWNER,
        });
        expect(out).toEqual({ dtam: null, platform: null });
        expect(mockIssue).not.toHaveBeenCalled();
    });

    test('the window is the card rail\'s own M1 list, not a second list', () => {
        // If somebody adds an M1-payable state to stripe-checkout-service, this
        // module must follow it without an edit here.
        const { SELF_HEAL_STATUSES } = require('../../services/quotation-issuance-on-submit');
        expect([...SELF_HEAL_STATUSES].sort()).toEqual(PAYABLE.sort());
    });

    test('no state in which งวดที่ 1 has been collected can mint a document', () => {
        const { SELF_HEAL_STATUSES } = require('../../services/quotation-issuance-on-submit');
        for (const paid of PAYABLE_STATES.M2) {
            expect(`${paid}: ${SELF_HEAL_STATUSES.has(paid)}`).toBe(`${paid}: false`);
        }
    });
});

/**
 * The GET door composes `{ id, ...(app || {}) }`, so an application that does
 * not exist (or a caller that read no status) arrives here with no status at
 * all. "Past DRAFT" cannot be proved of it, so the self-heal does not fire:
 * quotation-service would refuse it anyway (APPLICATION_NOT_FOUND /
 * APPLICATION_DELETED), and the refusal would be logged as a late-issue failure
 * on every read, which makes that log line mean nothing.
 */
test('an application whose status is unknown is not quoted', async () => {
    mockFind.mockResolvedValue({ dtam: null, platform: null });
    const out = await ensureQuotationForIssuedApplication({
        application: { id: 'app-does-not-exist' },
        ...OWNER,
    });
    expect(out).toEqual({ dtam: null, platform: null });
    expect(mockIssue).not.toHaveBeenCalled();
});

/**
 * Same NOT NULL trap as the submit door's failure record: an audit row written
 * without actorRole is not written at all (prisma/schema/audit.prisma:25,
 * middleware/audit-logger.js:388). A late issue is a priced-today event that a
 * reviewer must be able to find, so its row has to land.
 */
test('the ISSUED_LATE record carries the CALLER\'s role, not a default', async () => {
    // Fix round 1 (reviewer m2): the previous assertion accepted "some
    // non-empty string", which the 'UNKNOWN' fallback satisfies — so it passed
    // even if the caller's role were never forwarded at all. The audit trail of
    // a priced-today document has to name who caused it.
    mockFind.mockResolvedValue({ dtam: null, platform: null });
    mockIssue.mockResolvedValue({ company: { id: 'qt-1' }, dtam: null, platform: { id: 'qt-1' } });
    await ensureQuotationForIssuedApplication({
        application: { id: 'app-1', status: 'PENDING_DOC_FEE', applicationNumber: 'APP-1' },
        actorId: 'user-7',
        actorRole: 'health',
    });
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({
        action: 'QUOTATION_ISSUED_LATE',
        actorRole: 'health',
        actorId: 'user-7',
    }));
});

/**
 * ── A lapsed offer is treated as absent, and replaced exactly once (R1) ──────
 *
 * The acceptance door now refuses a quotation past `validUntil`
 * (quotation-service.markQuotationAccepted), which without this branch would
 * leave the applicant holding a document they cannot accept, cannot pay
 * against, and which no staff surface can re-issue — the copy would name an
 * action the product does not perform. So the read that renders the payments
 * page retires the lapsed row and issues its replacement, in one transaction,
 * and says so in the replacement's own notes.
 */
describe('a lapsed, still-unaccepted quotation is replaced by the read', () => {
    const LAPSED = new Date('2026-07-01T00:00:00.000Z');
    const OPEN = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    const lapsedRow = (over = {}) => ({
        id: 'qt-old',
        applicationId: 'app-1',
        issuerType: 'PLATFORM',
        quotationNumber: 'QT-PRD-2026-000001',
        status: 'PENDING',
        validUntil: LAPSED,
        ...over,
    });
    const freshRow = {
        id: 'qt-new',
        applicationId: 'app-1',
        issuerType: 'PLATFORM',
        quotationNumber: 'QT-PRD-2026-000002',
        status: 'PENDING',
        validUntil: OPEN,
        notes: 'REISSUED_AFTER_EXPIRY:QT-PRD-2026-000001',
    };

    test('the lapsed row is retired, a replacement is issued, and the trail names both', async () => {
        mockFind.mockResolvedValue({ dtam: null, platform: lapsedRow() });
        mockReissue.mockResolvedValue({ company: freshRow, dtam: null, platform: freshRow });

        const out = await ensureQuotationForIssuedApplication({
            application: { id: 'app-1', status: 'PENDING_DOC_FEE', applicationNumber: 'APP-1' },
            ...OWNER,
        });

        expect(mockReissue).toHaveBeenCalledTimes(1);
        expect(mockReissue).toHaveBeenCalledWith('app-1', expect.objectContaining({
            lapsed: expect.objectContaining({ id: 'qt-old' }),
        }));
        expect(out.platform.id).toBe('qt-new');
        expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({
            action: 'QUOTATION_REISSUED_AFTER_EXPIRY',
            actorRole: 'health',
            metadata: expect.objectContaining({ replacedQuotationNumber: 'QT-PRD-2026-000001' }),
        }));
        // Never both: a replacement is an issuance of its own kind.
        expect(mockIssue).not.toHaveBeenCalled();
    });

    test('exactly once: the next read sees the replacement and leaves it alone', async () => {
        mockFind.mockResolvedValueOnce({ dtam: null, platform: lapsedRow() });
        mockReissue.mockResolvedValue({ company: freshRow, dtam: null, platform: freshRow });
        await ensureQuotationForIssuedApplication({
            application: { id: 'app-1', status: 'PENDING_DOC_FEE', applicationNumber: 'APP-1' },
            ...OWNER,
        });

        mockFind.mockResolvedValue({ dtam: null, platform: freshRow });
        const second = await ensureQuotationForIssuedApplication({
            application: { id: 'app-1', status: 'PENDING_DOC_FEE', applicationNumber: 'APP-1' },
            ...OWNER,
        });

        expect(mockReissue).toHaveBeenCalledTimes(1);
        expect(second.platform.id).toBe('qt-new');
    });

    test('an ACCEPTED row past its validity is an agreement, not a lapsed offer', async () => {
        mockFind.mockResolvedValue({ dtam: null, platform: lapsedRow({ status: 'ACCEPTED' }) });
        const out = await ensureQuotationForIssuedApplication({
            application: { id: 'app-1', status: 'PENDING_DOC_FEE', applicationNumber: 'APP-1' },
            ...OWNER,
        });
        expect(mockReissue).not.toHaveBeenCalled();
        expect(out.platform.id).toBe('qt-old');
    });

    test('a PROVIDER read never replaces a document either', async () => {
        mockFind.mockResolvedValue({ dtam: null, platform: lapsedRow() });
        await ensureQuotationForIssuedApplication({
            application: { id: 'app-1', status: 'PENDING_DOC_FEE', applicationNumber: 'APP-1' },
            actorId: 'user-9', actorRole: 'account',
        });
        expect(mockReissue).not.toHaveBeenCalled();
    });

    test('a lapsed row on an application outside the window is left as it is', async () => {
        mockFind.mockResolvedValue({ dtam: null, platform: lapsedRow() });
        await ensureQuotationForIssuedApplication({
            application: { id: 'app-1', status: 'CERTIFIED', applicationNumber: 'APP-1' },
            ...OWNER,
        });
        expect(mockReissue).not.toHaveBeenCalled();
    });

    /**
     * A pre-W14 application holds a PAIR (DTAM + PLATFORM) that between them
     * price the whole bill. Replacing them produces ONE W14 document, which is
     * a repricing decision, not a repair — so the heal declines it and the pair
     * is left for a human.
     */
    test('a lapsed pre-W14 PAIR is not silently repriced into one document', async () => {
        mockFind.mockResolvedValue({
            dtam: lapsedRow({ id: 'qt-dtam', issuerType: 'DTAM', quotationNumber: 'QT-DTAM-2569-000001' }),
            platform: lapsedRow(),
        });
        await ensureQuotationForIssuedApplication({
            application: { id: 'app-1', status: 'PENDING_DOC_FEE', applicationNumber: 'APP-1' },
            ...OWNER,
        });
        expect(mockReissue).not.toHaveBeenCalled();
        expect(mockIssue).not.toHaveBeenCalled();
    });

    test('a failed replacement never fails the read', async () => {
        mockFind.mockResolvedValue({ dtam: null, platform: lapsedRow() });
        mockReissue.mockRejectedValue(new Error('numbering down'));
        const out = await ensureQuotationForIssuedApplication({
            application: { id: 'app-1', status: 'PENDING_DOC_FEE', applicationNumber: 'APP-1' },
            ...OWNER,
        });
        expect(out.platform.id).toBe('qt-old');
    });

    /**
     * Fix round 1 of the final round (reviewer BLOCKER).
     *
     * R3 narrowed the late-MINT window to M1, and the replacement branch was
     * sitting BELOW that check, so it was unreachable for a RENEWAL: a renewal
     * is created at PENDING_AUDIT_FEE (services/renewal-service.js) with one
     * PLATFORM quotation valid 7 working days
     * (config/business-rules.js PAYMENT.QUOTATION_VALIDITY_BUSINESS_DAYS).
     * Past that window the acceptance door refused it
     * (QUOTATION_EXPIRED), the gate refused it, no staff surface can issue one
     * (ledger F-G4-71) — the renewal was unacceptable and unpayable for ever,
     * and QUOTATION_EXPIRED's copy named a replacement the product never
     * performed.
     *
     * So the replacement branch gets its OWN predicate. What R3 forbids in an
     * M2-payable state is MINTING: issueQuotationsForApplication has no notion
     * of what is already paid and would bill งวดที่ 1 again. REPLACING a row
     * that prices งวดที่ 2 only bills exactly what the retired row billed, and
     * only while nothing of it has been invoiced. A lapsed row in the same
     * state that prices BOTH งวด is still left alone, because its replacement
     * would re-bill งวดที่ 1 — the harm R3 exists to stop.
     */
    describe('an M2-payable application: only a งวดที่ 2 only offer may be replaced', () => {
        const pricing = (...phases) => phases.map((phase) => ({ phase, amount: 1 }));

        test.each([...PAYABLE_STATES.M2])(
            '%s: a lapsed offer pricing งวดที่ 2 only is replaced by an identical one',
            async (status) => {
                mockFind.mockResolvedValue({
                    dtam: null,
                    platform: lapsedRow({ installments: pricing('PHASE_2'), phase2InvoicedAt: null }),
                });
                mockReissue.mockResolvedValue({ company: freshRow, dtam: null, platform: freshRow });

                const out = await ensureQuotationForIssuedApplication({
                    application: { id: 'app-1', status, applicationNumber: 'APP-1' },
                    ...OWNER,
                });

                expect(mockReissue).toHaveBeenCalledTimes(1);
                expect(out.platform.id).toBe('qt-new');
                // A replacement, never a mint: the mint is what would re-bill.
                expect(mockIssue).not.toHaveBeenCalled();
                expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({
                    action: 'QUOTATION_REISSUED_AFTER_EXPIRY',
                }));
            },
        );

        test.each([...PAYABLE_STATES.M2])(
            '%s: a lapsed offer pricing BOTH งวด is left alone, its replacement would re-bill งวดที่ 1',
            async (status) => {
                mockFind.mockResolvedValue({
                    dtam: null,
                    platform: lapsedRow({ installments: pricing('PHASE_1', 'PHASE_2') }),
                });

                const out = await ensureQuotationForIssuedApplication({
                    application: { id: 'app-1', status, applicationNumber: 'APP-1' },
                    ...OWNER,
                });

                expect(mockReissue).not.toHaveBeenCalled();
                expect(mockIssue).not.toHaveBeenCalled();
                expect(out.platform.id).toBe('qt-old');
            },
        );

        test('a งวดที่ 2 only offer whose instalment is already invoiced is not replaced', async () => {
            mockFind.mockResolvedValue({
                dtam: null,
                platform: lapsedRow({
                    installments: pricing('PHASE_2'),
                    phase2InvoicedAt: new Date('2026-07-15T00:00:00.000Z'),
                }),
            });

            await ensureQuotationForIssuedApplication({
                application: { id: 'app-1', status: 'PENDING_AUDIT_FEE', applicationNumber: 'APP-1' },
                ...OWNER,
            });

            expect(mockReissue).not.toHaveBeenCalled();
            expect(mockIssue).not.toHaveBeenCalled();
        });

        test('a row that records no instalments at all is not replaced here', async () => {
            // A legacy row says nothing about what it prices, so nothing can be
            // proved about what its replacement would bill: fail closed.
            mockFind.mockResolvedValue({ dtam: null, platform: lapsedRow({ installments: null }) });

            await ensureQuotationForIssuedApplication({
                application: { id: 'app-1', status: 'DOC_APPROVED', applicationNumber: 'APP-1' },
                ...OWNER,
            });

            expect(mockReissue).not.toHaveBeenCalled();
            expect(mockIssue).not.toHaveBeenCalled();
        });

        test('the widening is M2 only: a CERTIFIED application is still left alone', async () => {
            mockFind.mockResolvedValue({
                dtam: null,
                platform: lapsedRow({ installments: pricing('PHASE_2') }),
            });

            await ensureQuotationForIssuedApplication({
                application: { id: 'app-1', status: 'CERTIFIED', applicationNumber: 'APP-1' },
                ...OWNER,
            });

            expect(mockReissue).not.toHaveBeenCalled();
        });

        test('a provider read still never replaces an M2 renewal offer', async () => {
            mockFind.mockResolvedValue({
                dtam: null,
                platform: lapsedRow({ installments: pricing('PHASE_2') }),
            });

            await ensureQuotationForIssuedApplication({
                application: { id: 'app-1', status: 'PENDING_AUDIT_FEE', applicationNumber: 'APP-1' },
                actorId: 'user-9', actorRole: 'account',
            });

            expect(mockReissue).not.toHaveBeenCalled();
        });
    });
});
