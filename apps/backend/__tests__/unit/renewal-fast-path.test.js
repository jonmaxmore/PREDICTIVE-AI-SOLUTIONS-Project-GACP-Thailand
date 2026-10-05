/**
 * W12-2 — the renewal fast path.
 *
 * Operator ruling 2026-08-22, final (the change log @ 67ef3612):
 *   "ผมผิดเอง ต่ออายุ 30,000 ครั้งเดียว และไม่ตรวจเอกสาร นัดลงพื้นที่อย่างเดียว"
 * One 30,000 charge, NO document review, straight to the site visit.
 *
 * Before this change a renewal was a normal DRAFT that walked every state a new
 * application walks (renewal-service.js:294,308; routes/api/applications/
 * renewals.js:19-22 said so in prose: "travels the SAME canonical workflow").
 *
 * WHERE A RENEWAL NOW ENTERS, and why that state and not another:
 *   the scheduling queue is `status: 'AUDIT_FEE_PAID'`
 *   (services/audit-scheduling-service.js:255-270), and assignAuditor refuses
 *   anything else (:450). AUDIT_FEE_PAID is therefore the site-visit entry.
 *   A renewal is NOT created there: an application only reaches AUDIT_FEE_PAID
 *   through a settled payment (checkout-settlement-service.js:45 maps M2 →
 *   AUDIT_FEE_PAID — the only path; the slip twin retired 2026-09-11). Creating a
 *   renewal in AUDIT_FEE_PAID would walk it through the money gate for free.
 *   So a renewal is created in PENDING_AUDIT_FEE — the payment gate immediately
 *   before scheduling — and the existing, untouched settlement path carries it
 *   to AUDIT_FEE_PAID. No new edge, no change to any settlement code.
 *
 * SKIPPED by policy: SUBMITTED, PENDING_DOC_FEE, DOC_FEE_PAID,
 *   ASSIGNED_FOR_REVIEW, DOC_APPROVED — the document fee and the document review.
 * STILL ENFORCED: the phase-2 payment gate, scheduling, the onsite audit, the
 *   onsite-evidence gate before issuance, APPROVED → CERTIFIED.
 */

'use strict';

// The holder-capability gate (operator ruling 2026-10-03, via application-submit-guard)
// reads memberships on the real client; this stub-prisma suite is not about who may renew, so the gate
// lets everyone through. The gate itself is proven on a real Postgres in
// __tests__/integration/renewal-requires-submit-capability-real-postgres.test.js.
const mockAssertSubmitAllowed = jest.fn(async ({ application }) => ({ entityId: application.entityId }));
jest.mock('../../services/application-submit-guard', () => ({
        // One renewal per certificate (RENEWAL_ALREADY_IN_PROGRESS): none in flight here.
        findInFlightSuccession: async () => null,
        lockCertificateSuccessions: async () => {},
        RENEWAL_ALREADY_IN_PROGRESS: 'RENEWAL_ALREADY_IN_PROGRESS',
    assertSubmitAllowed: (...a) => mockAssertSubmitAllowed(...a),
    recordSubmitDenial: async () => {},
}));
jest.mock('../../services/holder-access', () => ({
    holderReadWhereIfScoped: () => ({}),
}));

const mockAuditLogger = { log: jest.fn().mockResolvedValue(null) };
jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: mockAuditLogger,
    AuditCategory: { APPLICATION: 'APPLICATION' },
    AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING' },
    ResourceType: { APPLICATION: 'APPLICATION' },
}));

const renewalService = require('../../services/renewal-service');
const { ALLOWED_TRANSITIONS } = require('../../services/workflow-transition-service');
const auditScheduling = require('../../services/audit-scheduling-service');

const ACTOR_ID = 'user-owner-1';
const CERT_ID = 'cert-1';
const SOURCE_APP_ID = 'app-source-1';

function futureIso(days = 30) {
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function makePrisma({ cert = {}, sourceApp = {} } = {}) {
    const created = { data: null };
    const certRow = {
        id: CERT_ID,
        userId: ACTOR_ID,
        applicationId: SOURCE_APP_ID,
        status: 'ACTIVE',
        expiryDate: futureIso(30),
        certificateNumber: 'GACP-TH-2569-ABCDEF',
        farmId: 'farm-1',
        organizationId: 'org-1',
        isDeleted: false,
        application: { entityId: 'entity-1' }, // R2 Task 8 fix round 1: the holder, via the relation
        ...cert,
    };
    const appRow = {
        id: SOURCE_APP_ID,
        healthId: 'health-1',
        entityId: 'entity-1',
        organizationId: 'org-1',
        areaType: 'OUTDOOR',
        applicationNumber: 'GACP-2569-0001',
        formData: { cultivationMethods: ['OUTDOOR'] },
        isDeleted: false,
        ...sourceApp,
    };
    return {
        created,
        // The renewal is filed by the acting user (operator ruling 2026-10-03).
        user: { findUnique: jest.fn(async ({ where }) => ({ canonicalId: `canon-${where.id}` })) },
        certificate: { findFirst: jest.fn().mockResolvedValue(certRow) },
        application: {
            findFirst: jest.fn().mockResolvedValue(appRow),
            create: jest.fn(async ({ data }) => {
                created.data = data;
                return { id: 'app-renewal-1', ...data };
            }),
        },
    };
}

async function createRenewal(prisma) {
    return renewalService.createRenewalApplication({
        originalCertificateId: CERT_ID,
        actorId: ACTOR_ID,
        holderScope: { userId: ACTOR_ID, readIds: ['entity-1'], editIds: ['entity-1'] }, // R2 Task 8 fix round 1
        prisma,
    });
}

beforeEach(() => {
    mockAuditLogger.log.mockClear();
});

describe('W12-2A — a renewal enters at the site-visit payment gate, not at DRAFT', () => {
    test('the created application is PENDING_AUDIT_FEE, not DRAFT', async () => {
        const prisma = makePrisma();
        await createRenewal(prisma);

        expect(prisma.created.data.status).toBe('PENDING_AUDIT_FEE');
        expect(prisma.created.data.formData.workflowState).toBe('PENDING_AUDIT_FEE');
    });

    test('the entry state is one settled payment away from the scheduling queue', async () => {
        const prisma = makePrisma();
        await createRenewal(prisma);

        // Asserted against the scheduler's own constant, not a literal: if the
        // queue moves to another state, this test says so instead of passing.
        const queueState = auditScheduling.SCHEDULING_QUEUE_STATUS;
        expect(queueState).toBe('AUDIT_FEE_PAID');
        expect([...ALLOWED_TRANSITIONS[prisma.created.data.status]]).toContain(queueState);
    });

    test('the entry state skips the document fee and the document review', async () => {
        const prisma = makePrisma();
        await createRenewal(prisma);

        const SKIPPED = ['SUBMITTED', 'PENDING_DOC_FEE',
            'DOC_FEE_PAID', 'ASSIGNED_FOR_REVIEW', 'DOC_APPROVED'];
        expect(SKIPPED).not.toContain(prisma.created.data.status);
        // and none of them is reachable onward from the entry state either, so
        // the renewal cannot be walked back into document review by accident.
        for (const skipped of SKIPPED) {
            expect([...ALLOWED_TRANSITIONS[prisma.created.data.status]]).not.toContain(skipped);
        }
    });
});

describe('W12-2B — the jump is recorded, never silent', () => {
    test('provenance is written onto the application itself', async () => {
        const prisma = makePrisma();
        await createRenewal(prisma);
        const fd = prisma.created.data.formData;

        expect(fd.renewalOf).toBe(CERT_ID);
        expect(fd.renewalOfCertificateNumber).toBe('GACP-TH-2569-ABCDEF');
        expect(fd.documentReviewSkipped).toBe(true);
        expect(fd.documentReviewSkipReason).toMatch(/RENEWAL_FAST_PATH/);
        expect(Array.isArray(fd.workflowStatesSkipped)).toBe(true);
        expect(fd.workflowStatesSkipped).toContain('ASSIGNED_FOR_REVIEW');
    });

    test('an audit-trail row records the skip, the certificate and the entry state', async () => {
        const prisma = makePrisma();
        await createRenewal(prisma);

        // F-G4-64 fix round 1: createRenewalApplication may now write a SECOND,
        // unrelated audit row — QUOTATION_ISSUE_FAILED — because the renewal
        // door goes through the same loud-issuance helper the two submit doors
        // use, and issuance fails against this suite's prisma stub (no
        // quotation delegate). This test is about the FAST-PATH row, so it
        // selects that row by name instead of counting every row in the
        // function.
        //
        // T12 review r0 F6: selecting by name alone let the count go
        // unwatched, so pin the WHOLE audit output of the function first. With
        // only the fast-path filter below, a deliberately wrong THIRD row added
        // to createRenewalApplication left this suite 15/15 green (mutation run
        // 2026-08-29, evidence/f-g4-64-task-12/fix-round-1/
        // f6-gap-mutant-old-assertion-green.txt). The renewal money path may
        // write these two actions and no others; a new one is a decision, not a
        // detail, and this line makes it fail here first.
        const actions = mockAuditLogger.log.mock.calls
            .map(([e]) => String(e.action))
            .sort();
        expect(actions).toEqual(['QUOTATION_ISSUE_FAILED', 'RENEWAL_FAST_PATH_ENTRY']);

        const fastPathRows = mockAuditLogger.log.mock.calls
            .map(([e]) => e)
            .filter((e) => /RENEWAL_FAST_PATH/.test(String(e.action)));
        expect(fastPathRows).toHaveLength(1);
        const entry = fastPathRows[0];
        expect(entry.category).toBe('APPLICATION');
        expect(entry.action).toMatch(/RENEWAL_FAST_PATH/);
        expect(entry.resourceType).toBe('APPLICATION');
        expect(entry.resourceId).toBe('app-renewal-1');
        expect(entry.actorId).toBe(ACTOR_ID);
        expect(entry.metadata.renewalOf).toBe(CERT_ID);
        expect(entry.metadata.entryState).toBe('PENDING_AUDIT_FEE');
        expect(entry.metadata.documentReviewSkipped).toBe(true);
    });

    test('a renewal whose quotation could not be issued says so to the caller', async () => {
        // T12 review r0 F6: the assertion above accepts a QUOTATION_ISSUE_FAILED
        // row without ever saying what it means. It means the renewal exists and
        // has no price of record yet, and the caller — the renewals route — is
        // told so it can decide what to say to คุณ. Neither thrown (the renewal
        // row is already committed and must not be rolled back) nor swallowed
        // (an unpayable renewal that nobody hears about is the F-G4-64 bug).
        // This suite's prisma stub deliberately has no quotation delegate, which
        // is what makes issuance fail here.
        const prisma = makePrisma();
        const result = await createRenewal(prisma);

        expect(result.quotation).toEqual({ issued: false, error: 'QUOTATION_ISSUE_FAILED' });
        expect(result.applicationId).toBe('app-renewal-1');
    });

    test('the audit payload satisfies every NOT NULL column on AuditLog', async () => {
        // The mock accepts anything; Postgres does not. A real press against the
        // live database on 2026-08-22 showed this insert FAILING because
        // actorRole was omitted and prisma/schema/audit.prisma declares it
        // `actorRole String` (NOT NULL). The row was lost and the best-effort
        // catch swallowed it, so the fast path ran with no audit trail at all.
        //
        // This test reads the REQUIRED columns out of the schema file and holds
        // the payload against them, so a mocked logger can never again hide a
        // shape the database will reject.
        const fs = require('fs');
        const path = require('path');
        const schema = fs.readFileSync(
            path.resolve(__dirname, '../../prisma/schema/audit.prisma'), 'utf8');
        const model = schema.slice(schema.indexOf('model AuditLog'));
        const body = model.slice(0, model.indexOf(String.fromCharCode(10) + '}'));

        // Columns the caller must supply: String (not String?), no @default,
        // and not part of the hash chain the logger fills in itself.
        const LOGGER_SUPPLIED = new Set([
            'id', 'logId', 'sequenceNumber', 'previousHash', 'currentHash',
            'hashAlgorithm', 'organizationId', 'createdAt', 'ipAddress', 'userAgent',
        ]);
        const required = [];
        for (const line of body.split(String.fromCharCode(10))) {
            const m = line.trim().match(/^([a-zA-Z][A-Za-z0-9_]*)\s+(String|Int|Json)(\s|$)/);
            if (!m) { continue; }
            const name = m[1];
            if (line.includes('@default') || line.includes('?')) { continue; }
            if (LOGGER_SUPPLIED.has(name)) { continue; }
            required.push(name);
        }
        expect(required).toContain('actorRole'); // the one that actually broke

        const prisma = makePrisma();
        await createRenewal(prisma);
        // Same reason as above: select the fast-path row by name, not by index.
        const entry = mockAuditLogger.log.mock.calls
            .map(([e]) => e)
            .find((e) => /RENEWAL_FAST_PATH/.test(String(e.action)));

        const missing = required.filter(
            (col) => entry[col] === undefined || entry[col] === null || entry[col] === '',
        );
        expect(missing).toEqual([]);
    });

    test('the application is still created when the audit sink is down', async () => {
        // Provenance also lives in formData, so an audit outage degrades the
        // trail but must never cost the applicant their renewal.
        mockAuditLogger.log.mockRejectedValueOnce(new Error('audit sink down'));
        const prisma = makePrisma();

        const result = await createRenewal(prisma);
        expect(result.applicationId).toBe('app-renewal-1');
        expect(prisma.created.data.formData.documentReviewSkipped).toBe(true);
    });
});

describe('W12-2C — the fast path is reachable only for a genuine, live renewal', () => {
    test('an expired certificate is refused, not fast-pathed', async () => {
        const prisma = makePrisma({ cert: { expiryDate: new Date(Date.now() - 1000).toISOString() } });
        await expect(createRenewal(prisma)).rejects.toMatchObject({ code: 'CERT_ALREADY_EXPIRED' });
        expect(prisma.application.create).not.toHaveBeenCalled();
    });

    test('a revoked (non-ACTIVE) certificate is refused', async () => {
        const prisma = makePrisma({ cert: { status: 'REVOKED' } });
        await expect(createRenewal(prisma)).rejects.toMatchObject({ code: 'CERT_NOT_ACTIVE' });
        expect(prisma.application.create).not.toHaveBeenCalled();
    });

    // Operator ruling 2026-10-03: the filer of the certificate is not asked; the submit
    // guard (SUBMIT_APPLICATION on the holder) decides, and refuses here.
    test('someone the submit guard refuses is refused, whoever filed the certificate', async () => {
        const prisma = makePrisma({ cert: { userId: 'someone-else' } });
        mockAssertSubmitAllowed.mockRejectedValueOnce(Object.assign(new Error('denied'), { statusCode: 403, code: 'ENTITY_PERMISSION_DENIED' }));
        await expect(createRenewal(prisma)).rejects.toMatchObject({ code: 'ENTITY_PERMISSION_DENIED' });
        expect(prisma.application.create).not.toHaveBeenCalled();
    });

    test('a missing certificate is refused', async () => {
        const prisma = makePrisma();
        prisma.certificate.findFirst.mockResolvedValue(null);
        await expect(createRenewal(prisma)).rejects.toMatchObject({ code: 'CERT_NOT_FOUND' });
        expect(prisma.application.create).not.toHaveBeenCalled();
    });
});

describe('W12-2D — a NON-renewal application still cannot skip document review', () => {
    test('DRAFT still leads only to SUBMITTED, and document review is still on the ordinary road', () => {
        // The fast path is an entry state chosen at creation by renewal-service
        // after it has validated the certificate. It adds no edge, so nothing
        // that starts at DRAFT gains a way around ASSIGNED_FOR_REVIEW.
        expect([...ALLOWED_TRANSITIONS.DRAFT]).toEqual(['SUBMITTED']);
        expect([...ALLOWED_TRANSITIONS.SUBMITTED]).toEqual(['PENDING_DOC_FEE']);
        expect([...ALLOWED_TRANSITIONS.DOC_FEE_PAID]).toEqual(['ASSIGNED_FOR_REVIEW']);
        expect([...ALLOWED_TRANSITIONS.DOC_APPROVED]).toEqual(['PENDING_AUDIT_FEE']);
    });

    test('no edge into the renewal entry state was added for ordinary applications', () => {
        // PENDING_AUDIT_FEE must remain reachable ONLY from DOC_APPROVED, i.e.
        // only after a real document review, for anything that is not created
        // there by renewal-service.
        const sources = Object.entries(ALLOWED_TRANSITIONS)
            .filter(([, targets]) => targets.has('PENDING_AUDIT_FEE'))
            .map(([from]) => from)
            .sort();
        // เหลือทางเดียวจริง ๆ แล้ว: ขา PHASE_2_SLIP_UNDER_REVIEW→PENDING_AUDIT_FEE
        // (สลิปถูกปฏิเสธแล้วย้อนกลับไปให้จ่ายใหม่) หายไปพร้อมสลิป 2026-09-11
        expect(sources).toEqual(['DOC_APPROVED']);
    });
});

describe('W12-2E — a renewal cannot reach CERTIFIED without an onsite audit', () => {
    test('every path from the renewal entry state to CERTIFIED runs through AUDIT_PASSED', () => {
        // Graph proof rather than a mock: remove the audit DECISION state from
        // the state machine and CERTIFIED must become unreachable from where a
        // renewal starts.
        //
        // AUDIT_PASSED and not AUDIT_CONFIRMED, and the difference is a real
        // finding, not a convenience: AUDIT_CONFIRMED is NOT a choke point.
        // The waiver-reopen edge EXPIRED -> CAR_PENDING (workflow-transition-
        // service.js:88, owner ruling 2026-07-08) reaches CAR_REVIEWING ->
        // AUDIT_PASSED without ever passing through AUDIT_CONFIRMED. Verified
        // against the live graph, both readings, in W12-RED.txt. So the state
        // machine alone does not guarantee that an onsite audit happened -
        // services/onsite-evidence-gate.js does, which is exactly why that gate
        // exists and why the next test pins it to the minting path.
        const reachableWithout = (blocked) => {
            const seen = new Set();
            const queue = ['PENDING_AUDIT_FEE'];
            while (queue.length) {
                const state = queue.shift();
                if (state === blocked || seen.has(state)) { continue; }
                seen.add(state);
                for (const next of ALLOWED_TRANSITIONS[state] || []) {
                    if (!seen.has(next)) { queue.push(next); }
                }
            }
            return seen;
        };

        expect(reachableWithout(null).has('CERTIFIED')).toBe(true);
        expect(reachableWithout('AUDIT_PASSED').has('CERTIFIED')).toBe(false);
        // and the only two ways into that decision state are the audit itself
        // or the corrective-action round that follows one.
        const intoDecision = Object.entries(ALLOWED_TRANSITIONS)
            .filter(([, targets]) => targets.has('AUDIT_PASSED'))
            .map(([from]) => from)
            .sort();
        expect(intoDecision).toEqual(['AUDIT_CONFIRMED', 'CAR_REVIEWING']);
    });

    test('the issuance evidence gate is still wired into certificate minting', () => {
        // The gate lives inside generateCertificate so every issuance path
        // crosses it (services/onsite-evidence-gate.js:1-34). Asserted on the
        // source so this suite fails if someone unhooks it, without needing a
        // live DB to mint a certificate.
        const fs = require('fs');
        const path = require('path');
        const src = fs.readFileSync(
            path.resolve(__dirname, '../../services/certificate-service.js'), 'utf8');
        expect(src).toMatch(/assertOnsiteEvidenceSufficient/);
    });
});
