/**
 * Documents approved, and then nothing.
 *
 * `DOC_APPROVED → PENDING_AUDIT_FEE` is an automatic chain: the applicant cannot
 * ask to pay the audit fee, the system has to open it. That chain lives in
 * workflow-side-effects.js and is reached only from the generic
 * workflow-transitions-handler — the older door.
 *
 * The per-slot document-decision door added on 2026-09-05 writes DOC_APPROVED
 * through the status writer and stops there. Walked on a real database the same
 * day: the officer accepted all nine papers, the filing reached DOC_APPROVED, and
 * it stayed there. No job picks it up either — payment-closure-job only CLOSES
 * applications already sitting in PENDING_AUDIT_FEE, it never puts one there.
 *
 * So an approval through the new screen is the end of the road: the applicant is
 * told their documents passed and is never asked for the audit fee.
 *
 * The consequences of a document approval are the same whichever door decided it,
 * so they belong in ONE place that both doors call, rather than copied into the
 * new one where the two can drift.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const sideEffects = require('../../routes/api/provider/handlers/workflow-side-effects');

const DECISION_DOOR = fs.readFileSync(
    path.join(__dirname, '..', '..', 'routes', 'api', 'provider', 'document-reviews.js'),
    'utf8',
);

describe('the consequences of a document approval live in one shared place', () => {
    test('the side-effects module exports them', () => {
        expect(typeof sideEffects.applyDocumentApprovalConsequences).toBe('function');
    });

    test('the per-slot decision door calls that shared function', () => {
        // Not "contains the string PENDING_AUDIT_FEE" — that would pass on a
        // copy-paste of the chain into this door, which is the drift being avoided.
        expect(DECISION_DOOR).toContain('applyDocumentApprovalConsequences');
    });

    test('it advances DOC_APPROVED to PENDING_AUDIT_FEE', async () => {
        const writes = [];
        await sideEffects.applyDocumentApprovalConsequences({
            prisma: {},
            applicationId: 'app-1',
            actorId: 'officer-1',
            actorRole: 'document_reviewer',
            formData: {},
            workflowHistory: [],
            writeApplicationStatus: async (args) => { writes.push(args); },
            bulkUpdateRevisionDeadlineStatus: async () => {},
        });

        expect(writes).toHaveLength(1);
        expect(writes[0].fromStatus).toBe('DOC_APPROVED');
        expect(writes[0].toStatus).toBe('PENDING_AUDIT_FEE');
    });

    test('it closes the revision deadlines the approval settles', async () => {
        const closed = [];
        await sideEffects.applyDocumentApprovalConsequences({
            prisma: {},
            applicationId: 'app-1',
            actorId: 'officer-1',
            actorRole: 'document_reviewer',
            formData: {},
            workflowHistory: [],
            writeApplicationStatus: async () => {},
            bulkUpdateRevisionDeadlineStatus: async (args) => { closed.push(args); },
        });

        expect(closed).toHaveLength(1);
        expect(closed[0].applicationId).toBe('app-1');
        expect(closed[0].data.status).toBe('APPROVED');
    });

    // ── F-G4-71, operator ruling 2026-09-06: option ก ────────────────────────
    //
    // Asked who should issue the งวดที่ 2 document — automatically on document
    // approval (ก), by extending the payments-page self-heal (ข), or by a finance
    // officer at a new door (ค) — the operator answered "ก".
    //
    // Measured before: an application reaching PENDING_AUDIT_FEE with no quotation row
    // meets QUOTATION_NOT_ISSUED at the checkout gate and its applicant cannot pay at
    // all. The submit door issues one, so the ordinary path was covered; the four shapes
    // the ledger lists are the ones that arrive without having gone through it.
    //
    // Issuance is idempotent — a filing that already carries a quotation gets the same
    // row back — so this is a guarantee, not a second document.
    test('it issues the quotation, so the audit fee it just opened can actually be paid', async () => {
        const issued = [];
        await sideEffects.applyDocumentApprovalConsequences({
            prisma: {},
            applicationId: 'app-1',
            actorId: 'officer-1',
            actorRole: 'document_reviewer',
            formData: {},
            workflowHistory: [],
            writeApplicationStatus: async () => {},
            bulkUpdateRevisionDeadlineStatus: async () => {},
            issueQuotationOnSubmit: async (args) => { issued.push(args); return { issued: true }; },
        });

        expect(issued).toHaveLength(1);
        expect(issued[0].application.id).toBe('app-1');
        // The system opened this, not the officer — the audit trail must not read as
        // though a person issued a price.
        expect(issued[0].actorRole).toBe('system');
    });

    test('it does NOT issue when the status write failed — no price for a transition that did not happen', async () => {
        const issued = [];
        await sideEffects.applyDocumentApprovalConsequences({
            prisma: {},
            applicationId: 'app-1',
            actorId: 'officer-1',
            actorRole: 'document_reviewer',
            formData: {},
            workflowHistory: [],
            writeApplicationStatus: async () => { throw new Error('db gone'); },
            bulkUpdateRevisionDeadlineStatus: async () => {},
            issueQuotationOnSubmit: async (args) => { issued.push(args); return { issued: true }; },
        });

        expect(issued).toHaveLength(0);
    });

    test('an issuance failure never un-does the approval', async () => {
        // Same discipline as everything else in this function: DOC_APPROVED has
        // committed. A billing hiccup must be logged, not thrown back at an officer who
        // would press the button again.
        const result = await sideEffects.applyDocumentApprovalConsequences({
            prisma: {},
            applicationId: 'app-1',
            actorId: 'officer-1',
            actorRole: 'document_reviewer',
            formData: {},
            workflowHistory: [],
            writeApplicationStatus: async () => {},
            bulkUpdateRevisionDeadlineStatus: async () => {},
            issueQuotationOnSubmit: async () => { throw new Error('numbering down'); },
        });

        expect(result.chained).toBe(true);
        expect(result.quotationIssued).toBe(false);
    });

    test('a failure to open the fee does not throw at the caller', async () => {
        // The status write that made DOC_APPROVED has already committed. Throwing
        // here would 500 a decision that DID happen and the officer would press
        // again — the same discipline the notification branches use.
        await expect(sideEffects.applyDocumentApprovalConsequences({
            prisma: {},
            applicationId: 'app-1',
            actorId: 'officer-1',
            actorRole: 'document_reviewer',
            formData: {},
            workflowHistory: [],
            writeApplicationStatus: async () => { throw new Error('db gone'); },
            bulkUpdateRevisionDeadlineStatus: async () => {},
        })).resolves.toBeDefined();
    });
});
