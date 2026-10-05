/**
 * Task 6 (document pre-check): the wiring — `services/document-precheck/service.js`
 * (enqueueForUpload / runPrecheck / loadReference / acknowledge), the Bull
 * processor `jobs/document-precheck-processor.js`, the `document-precheck`
 * queue in `services/queue-service.js`, and the hook on
 * POST /api/applications/draft-documents.
 *
 * The database here is an in-memory stand-in (this is the unit layer); the
 * same flows run against a real Postgres, real extract and real tesseract in
 * __tests__/integration/document-precheck-flow.test.js. `evaluate` is the
 * REAL rule layer — only extraction (file → text) is replaced, so the flags
 * asserted below are the ones the catalog really produces.
 *
 * Retry decision pinned here (Task 6 dispatch, decision 3): an error thrown by
 * extraction (PRECHECK_TIMEOUT, OCR failure, the PDF child dying) is retried
 * once by the queue — the row stays PENDING and the error is rethrown — and
 * on the final attempt the row becomes FAILED with the failure flag. Any other
 * error (reference load, evaluate, the write) is not retried: FAILED at once.
 */

'use strict';

const express = require('express');
const request = require('supertest');
const fs = require('fs');
const path = require('path');

// ── in-memory database ───────────────────────────────────────────────────────

const mockDb = { prechecks: [], flags: [], applications: new Map(), entities: new Map() };
let mockIdSeq = 0;

function mockMatches(row, where) {
    return Object.entries(where || {}).every(([key, cond]) => {
        if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
            if ('not' in cond) {
                return row[key] !== cond.not;
            }
            if ('in' in cond) {
                return cond.in.includes(row[key]);
            }
        }
        return row[key] === cond;
    });
}

function mockProject(row, select) {
    if (row === null || row === undefined) {
        return null;
    }
    if (!select) {
        return { ...row };
    }
    const out = {};
    for (const [key, spec] of Object.entries(select)) {
        if (spec === true) {
            out[key] = row[key];
        } else if (spec && typeof spec === 'object' && spec.select) {
            out[key] = mockProject(row[key], spec.select);
        }
    }
    return out;
}

function mockRefuseInclude(args) {
    if (args && args.include) {
        throw new Error('document-precheck must use explicit selects, never include');
    }
}

const mockPrisma = {
    documentPrecheck: {
        create: jest.fn(async (args) => {
            mockRefuseInclude(args);
            const { data, select } = args;
            if (mockDb.prechecks.some((r) => r.documentId === data.documentId)) {
                throw Object.assign(new Error('Unique constraint failed on documentId'), { code: 'P2002' });
            }
            const row = {
                id: `pc-${++mockIdSeq}`,
                extractMethod: null,
                ocrConfidence: null,
                pageCount: null,
                extractedText: null,
                applicantAcknowledgedAt: null,
                completedAt: null,
                createdAt: new Date(),
                ...data,
            };
            mockDb.prechecks.push(row);
            return mockProject(row, select);
        }),
        findUnique: jest.fn(async (args) => {
            mockRefuseInclude(args);
            const row = mockDb.prechecks.find((r) => r.id === args.where.id);
            if (!row) {
                return null;
            }
            return mockProject({ ...row, application: mockDb.applications.get(row.applicationId) || null }, args.select);
        }),
        updateMany: jest.fn(async ({ where, data }) => {
            let count = 0;
            for (const row of mockDb.prechecks) {
                if (mockMatches(row, where)) {
                    Object.assign(row, data);
                    count += 1;
                }
            }
            return { count };
        }),
    },
    documentPrecheckFlag: {
        create: jest.fn(async ({ data }) => {
            const row = { id: `fl-${++mockIdSeq}`, evidenceSnippet: null, ...data };
            mockDb.flags.push(row);
            return { id: row.id };
        }),
        createMany: jest.fn(async ({ data }) => {
            for (const d of data) {
                mockDb.flags.push({ id: `fl-${++mockIdSeq}`, evidenceSnippet: null, ...d });
            }
            return { count: data.length };
        }),
    },
    application: {
        findUnique: jest.fn(async (args) => {
            mockRefuseInclude(args);
            return mockProject(mockDb.applications.get(args.where.id) || null, args.select);
        }),
    },
    entity: {
        findUnique: jest.fn(async (args) => {
            mockRefuseInclude(args);
            return mockProject(mockDb.entities.get(args.where.id) || null, args.select);
        }),
    },
    // Fix round 1 (M2): the per-(application, slot) advisory lock is a raw statement.
    $executeRaw: jest.fn(async () => 1),
    $transaction: jest.fn(async (fn) => fn(mockPrisma)),
};

jest.mock('../../../services/prisma-database', () => ({ prisma: mockPrisma }));

// ── extraction (file → text) is the one piece replaced here ──────────────────

const mockExtract = jest.fn();
jest.mock('../../../services/document-precheck/extract', () => ({
    extractDocument: (...args) => mockExtract(...args),
}));

// ── queue ────────────────────────────────────────────────────────────────────

const mockQueueRef = { current: null };
jest.mock('../../../services/queue-service', () => ({
    getPrecheckQueue: () => mockQueueRef.current,
}));

// ── logger: captured, so the tests can prove no national ID is ever logged ──

const mockLogCalls = [];
jest.mock('../../../shared/logger', () => {
    const record = (level) => jest.fn((...args) => mockLogCalls.push({ level, args }));
    const l = { debug: record('debug'), info: record('info'), warn: record('warn'), error: record('error') };
    return { ...l, createLogger: jest.fn(() => l) };
});

// ── the route's own dependencies (same set the other draft-documents suites mock) ──

jest.mock('../../../middleware/auth-middleware', () => {
    const asHealthUser = (req, _res, next) => {
        req.user = { id: 'user-1', role: 'health', canonicalRole: 'health', healthId: 'health-1' };
        return next();
    };
    return { authenticateHealth: asHealthUser, authenticateAny: asHealthUser, authenticateProvider: asHealthUser };
});

jest.mock('../../../services/application-service', () => ({
    resolveHealthIdentity: jest.fn(),
    deleteDraft: jest.fn(),
    findApplicationByIdForHealth: jest.fn(),
    findLatestOpenDraftForHealth: jest.fn(),
    findPersonalEntityForHealthIdentity: jest.fn(),
    healDraftEntityColumns: jest.fn(),
    createDraftForHealth: jest.fn(),
    updateApplicantDraftColumns: jest.fn(),
    findDraftForSubmit: jest.fn(),
    getApplicationSlice: jest.fn(),
    findUserOrganizationId: jest.fn(),
    getApplicantReadinessSnapshot: jest.fn(),
    getLatestOpenDraftForApplicant: jest.fn(),
}));

jest.mock('../../../services/entity-service', () => ({
    ...jest.requireActual('../../../services/entity-service'),
    assertCapability: jest.fn(),
    ensureEntityFromApplicantData: jest.fn(),
}));

jest.mock('../../../services/fee-service', () => ({
    calculatePhase1Fee: jest.fn(() => ({})),
    calculatePhase2Fee: jest.fn(() => ({})),
}));

jest.mock('../../../services/application-document-sync', () => ({
    syncApplicationDocument: jest.fn(async () => null),
    removeApplicationDocument: jest.fn(async () => undefined),
}));

jest.mock('../../../services/application-status-writer', () => ({ writeApplicationStatus: jest.fn() }));
jest.mock('../../../services/quotation-service', () => ({ issueQuotationsForApplication: jest.fn().mockResolvedValue(null) }));
jest.mock('../../../services/notification-service', () => ({
    createNotification: jest.fn().mockResolvedValue(null),
    createBulkNotifications: jest.fn().mockResolvedValue({ count: 0 }),
}));
jest.mock('../../../services/working-days-service', () => ({
    addWorkingDays: jest.fn((d) => d),
    loadHolidaySet: jest.fn().mockResolvedValue(new Set()),
}));
jest.mock('../../../shared/workflow-event-builder', () => ({
    buildWorkflowEvent: jest.fn((event) => ({ ...event, id: 'wf-1' })),
}));
jest.mock('../../../routes/api/helpers/applications-helpers', () => ({
    mapHealthApplication: jest.fn((app) => app),
    getHealthScopeOptions: jest.fn((user) => ({ healthId: user?.healthId, strictHealthScope: true })),
    getActorIdentity: jest.fn((user) => user?.id || null),
}));
jest.mock('../../../routes/api/helpers/application-constants', () => ({
    MASTER_STEPS: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    AUDITOR_ROLES: new Set(['auditor', 'admin']),
    REJECTABLE_STATUSES: new Set(['SUBMITTED']),
    REVISION_DECISION_TYPES: new Set(['DOC_REVISION']),
    asObject: (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {}),
    asArray: (v) => (Array.isArray(v) ? v : []),
    upper: (v) => String(v || '').toUpperCase(),
    ensureApplicationNumber: jest.fn(() => 'APP-TEST-001'),
    isMissingApplicationCommentsTableError: jest.fn(() => false),
    mergeMasterSteps: jest.fn(() => ({})),
    validateMasterSubmission: jest.fn(() => ({ isValid: true, missingByStep: {} })),
}));
jest.mock('../../../routes/api/preview/preview-utils', () => ({
    normalizeDocuments: jest.fn(() => []),
    summarizeCompletion: jest.fn(() => ({ isComplete: true, missingFields: [] })),
}));
jest.mock('../../../validation/application-schemas', () => ({
    validateStep: jest.fn(() => ({ success: true, errors: [] })),
    validateAllSteps: jest.fn(() => ({ isValid: true, errorsByStep: {} })),
}));
jest.mock('../../../routes/api/applications/application-listing-handlers', () => require('express').Router());
jest.mock('../../../routes/api/applications/application-workflow-handlers', () => require('express').Router());

const service = require('../../../services/document-precheck/service');
const processPrecheckJob = require('../../../jobs/document-precheck-processor');

const FAILURE_FLAG = {
    check: 'READABILITY',
    result: 'UNREADABLE',
    reasonTH: 'ตรวจอัตโนมัติไม่สำเร็จ เจ้าหน้าที่จะตรวจเอง',
};

// A syntactically valid (mod-11) 13-digit Thai ID — test data, not a person.
const CITIZEN_ID = '1005615372816';
const THIRTEEN_DIGITS_RE = /\d{13}/;

const ORG = 'org-1';
const APP_INDIVIDUAL = 'app-ind';
const APP_JURISTIC = 'app-jur';

function seedApplications() {
    mockDb.entities.set('ent-ind', { id: 'ent-ind', type: 'INDIVIDUAL', displayName: 'นายสมชาย ใจดี', juristicId: null, payload: null, thaiCitizenId: CITIZEN_ID });
    mockDb.entities.set('ent-jur', {
        id: 'ent-jur',
        type: 'JURISTIC',
        displayName: 'บริษัท สมุนไพรไทย จำกัด',
        juristicId: '0105560000018',
        payload: { director: { name: 'นางสาวสมหญิง รักดี', idCard: CITIZEN_ID } },
        thaiCitizenId: null,
    });
    mockDb.applications.set(APP_INDIVIDUAL, {
        id: APP_INDIVIDUAL,
        healthId: 'health-1',
        entityId: 'ent-ind',
        organizationId: ORG,
        applicant: { firstName: 'สมชาย', lastName: 'ใจดี' },
        entity: mockDb.entities.get('ent-ind'),
    });
    mockDb.applications.set(APP_JURISTIC, {
        id: APP_JURISTIC,
        healthId: 'health-2',
        entityId: 'ent-jur',
        organizationId: ORG,
        applicant: { firstName: 'สมหญิง', lastName: 'รักดี' },
        entity: mockDb.entities.get('ent-jur'),
    });
}

function makeQueue() {
    return { add: jest.fn(async () => ({ id: 'job-1' })) };
}

function upload(overrides = {}) {
    return {
        applicationId: APP_INDIVIDUAL,
        organizationId: ORG,
        documentId: `doc-${++mockIdSeq}`,
        slotId: 'land_deed',
        absPath: '/uploads/application-drafts/deed.pdf',
        mimeType: 'application/pdf',
        ...overrides,
    };
}

function textExtraction(text) {
    return { method: 'TEXT_LAYER', pageCount: 1, pages: [{ text, confidence: 100 }], truncated: false };
}

function rowOf(id) {
    return mockDb.prechecks.find((r) => r.id === id);
}

function flagsOf(id) {
    return mockDb.flags.filter((f) => f.precheckId === id);
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function timeoutError() {
    return Object.assign(new Error('document-precheck extraction exceeded 60000ms'), { code: 'PRECHECK_TIMEOUT' });
}

beforeEach(() => {
    jest.clearAllMocks();
    mockDb.prechecks.length = 0;
    mockDb.flags.length = 0;
    mockDb.applications.clear();
    mockDb.entities.clear();
    mockLogCalls.length = 0;
    seedApplications();
    mockQueueRef.current = makeQueue();
    mockExtract.mockReset();
});

describe('enqueueForUpload', () => {
    test('a slot outside CATALOG (sop_cultivation) creates no row and adds no job', async () => {
        const result = await service.enqueueForUpload(upload({ slotId: 'sop_cultivation' }));

        expect(result).toBeNull();
        expect(mockDb.prechecks).toHaveLength(0);
        expect(mockQueueRef.current.add).not.toHaveBeenCalled();
    });

    test('a land_deed upload creates a PENDING row at RULES_VERSION and adds one job carrying the file', async () => {
        const args = upload();
        const result = await service.enqueueForUpload(args);

        expect(result).toEqual({ precheckId: expect.any(String) });
        const row = rowOf(result.precheckId);
        expect(row).toMatchObject({
            status: 'PENDING',
            rulesVersion: service.RULES_VERSION,
            applicationId: APP_INDIVIDUAL,
            organizationId: ORG,
            documentId: args.documentId,
            // stored as the canonical upload slot id — the vocabulary
            // ApplicationDocumentReview.slotId uses — not the posted spelling
            slotId: 'land_rights',
        });
        expect(service.RULES_VERSION).toBe(1);
        expect(mockQueueRef.current.add).toHaveBeenCalledTimes(1);
        // Fix round 1 (I1): the Bull job id IS the pre-check id, so the stale sweep
        // can ask the queue whether this row's job is still waiting.
        expect(mockQueueRef.current.add).toHaveBeenCalledWith(
            { precheckId: result.precheckId, absPath: args.absPath, mimeType: args.mimeType },
            { jobId: result.precheckId },
        );
    });

    test('a re-upload into the same slot (any spelling) supersedes the earlier row; other slots are untouched', async () => {
        const first = await service.enqueueForUpload(upload({ slotId: 'land_deed' }));
        const other = await service.enqueueForUpload(upload({ slotId: 'house_reg' }));
        const second = await service.enqueueForUpload(upload({ slotId: 'LAND_TITLE' }));

        expect(rowOf(first.precheckId).status).toBe('SUPERSEDED');
        expect(rowOf(second.precheckId).status).toBe('PENDING');
        expect(rowOf(other.precheckId).status).toBe('PENDING');
    });

    test('enqueue-failure: queue.add throws → the row is FAILED with exactly the failure flag, and the call resolves', async () => {
        mockQueueRef.current.add.mockRejectedValueOnce(new Error('Redis connection refused'));

        const result = await service.enqueueForUpload(upload());

        const row = rowOf(result.precheckId);
        expect(row.status).toBe('FAILED');
        expect(row.completedAt).toBeInstanceOf(Date);
        const flags = flagsOf(result.precheckId);
        expect(flags).toHaveLength(1);
        expect(flags[0]).toMatchObject({ ...FAILURE_FLAG, organizationId: ORG });
    });

    test('the queue not initialised (no Redis) is the same failure: FAILED + the failure flag', async () => {
        mockQueueRef.current = null;

        const result = await service.enqueueForUpload(upload());

        expect(rowOf(result.precheckId).status).toBe('FAILED');
        expect(flagsOf(result.precheckId)).toEqual([expect.objectContaining(FAILURE_FLAG)]);
    });

    // Fix round 1 (I2): an unreachable Redis held Bull's add for ~40 s (reviewer's
    // measurement, blackholed host). The add is raced against ENQUEUE_TIMEOUT_MS.
    test('a queue add that never settles is given up after ENQUEUE_TIMEOUT_MS (2 s): FAILED + the failure flag', async () => {
        mockQueueRef.current.add.mockImplementation(() => new Promise(() => {}));

        const started = Date.now();
        const result = await service.enqueueForUpload(upload());
        const elapsed = Date.now() - started;

        expect(service.ENQUEUE_TIMEOUT_MS).toBe(2000);
        expect(elapsed).toBeGreaterThanOrEqual(1900);
        expect(elapsed).toBeLessThan(3000);
        expect(rowOf(result.precheckId).status).toBe('FAILED');
        expect(flagsOf(result.precheckId)).toEqual([expect.objectContaining(FAILURE_FLAG)]);
    }, 10000);

    // Fix round 1 (M2): two concurrent uploads into one slot must not both stay
    // PENDING under READ COMMITTED — the supersede+insert holds an advisory lock
    // keyed on (applicationId, canonical slot). Proven on real Postgres in the
    // integration suite; here: the lock is taken inside the same transaction, first.
    test('supersede + insert take pg_advisory_xact_lock on (applicationId, canonical slot) first, inside the transaction', async () => {
        const order = [];
        mockPrisma.$executeRaw.mockImplementationOnce(async () => {
            order.push('lock');
            return 1;
        });
        mockPrisma.documentPrecheck.updateMany.mockImplementationOnce(async () => {
            order.push('supersede');
            return { count: 0 };
        });

        await service.enqueueForUpload(upload({ slotId: 'LAND_TITLE' }));

        expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
        const [strings, ...values] = mockPrisma.$executeRaw.mock.calls[0];
        expect(strings.join('?')).toContain('pg_advisory_xact_lock');
        expect(values).toEqual([APP_INDIVIDUAL, 'land_rights']);
        expect(order).toEqual(['lock', 'supersede']);
    });
});

// Fix round 1 (M1): Tasks 7/8 reach CATALOG through this one function.
describe('catalogKeyFor', () => {
    test('maps every spelling of an in-scope slot (old key, canonical v2 id, alias) to its CATALOG key; others to null', () => {
        expect(service.catalogKeyFor('land_deed')).toBe('land_deed');
        expect(service.catalogKeyFor('land_rights')).toBe('land_deed');
        expect(service.catalogKeyFor('LAND_TITLE')).toBe('land_deed');
        expect(service.catalogKeyFor('id_house_reg')).toBe('id_card');
        expect(service.catalogKeyFor('juristic_reg_6m')).toBe('company_reg');
        expect(service.catalogKeyFor('landlord_consent')).toBe('land_consent');
        expect(service.catalogKeyFor('prev_cert_original')).toBe('previous_cert');
        expect(service.catalogKeyFor('house_reg')).toBe('house_reg');
        expect(service.catalogKeyFor('land_lease')).toBe('land_lease');
        expect(service.catalogKeyFor('sop_cultivation')).toBeNull();
        expect(service.catalogKeyFor('')).toBeNull();
        expect(service.catalogKeyFor(undefined)).toBeNull();
    });
});

describe('runPrecheck', () => {
    const DEED_TEXT = 'โฉนดที่ดิน เลขที่ 1234 ผู้ถือกรรมสิทธิ์ นายสมชาย ใจดี';

    async function pendingDeed(overrides = {}) {
        const args = upload(overrides);
        const { precheckId } = await service.enqueueForUpload(args);
        return { precheckId, args };
    }

    test('land_deed: DONE with exactly the checks CATALOG defines for it (no VALIDITY rule → 4 flags)', async () => {
        const { precheckId, args } = await pendingDeed();
        mockExtract.mockResolvedValueOnce(textExtraction(DEED_TEXT));

        await service.runPrecheck(precheckId, { absPath: args.absPath, mimeType: args.mimeType });

        expect(mockExtract).toHaveBeenCalledWith(args.absPath, args.mimeType, expect.objectContaining({ timeoutMs: expect.any(Number), maxPages: expect.any(Number) }));
        const row = rowOf(precheckId);
        expect(row).toMatchObject({
            status: 'DONE',
            extractMethod: 'TEXT_LAYER',
            ocrConfidence: 100,
            pageCount: 1,
            extractedText: DEED_TEXT,
        });
        expect(row.completedAt).toBeInstanceOf(Date);
        const flags = flagsOf(precheckId);
        expect(flags.map((f) => f.check).sort()).toEqual(['CROSS_MATCH', 'DOC_TYPE', 'READABILITY', 'SIGNATURE']);
        expect(flags.every((f) => f.organizationId === ORG)).toBe(true);
        expect(flags.find((f) => f.check === 'DOC_TYPE').result).toBe('MATCH');
        expect(flags.find((f) => f.check === 'CROSS_MATCH').result).toBe('MATCH');
    });

    // Fix round 1 (M3): Postgres text columns refuse U+0000; a text-layer PDF
    // can carry it, and the DONE write then failed and the row ended FAILED.
    test('a NUL character in the extracted text is stripped before the write: DONE, text and flags carry no NUL', async () => {
        const { precheckId, args } = await pendingDeed();
        mockExtract.mockResolvedValueOnce(textExtraction('โฉนด\u0000ที่ดิน นายสมชาย\u0000 ใจดี'));

        await service.runPrecheck(precheckId, args);

        const row = rowOf(precheckId);
        expect(row.status).toBe('DONE');
        expect(row.extractedText).toBe('โฉนดที่ดิน นายสมชาย ใจดี');
        for (const f of flagsOf(precheckId)) {
            expect(`${f.reasonTH}${f.evidenceSnippet || ''}`).not.toContain('\u0000');
        }
        expect(flagsOf(precheckId).find((f) => f.check === 'DOC_TYPE').result).toBe('MATCH');
    });

    test('OCR confidence is the mean of the page confidences; NONE stores null text and null confidence', async () => {
        const ocr = await pendingDeed();
        mockExtract.mockResolvedValueOnce({
            method: 'OCR',
            pageCount: 2,
            pages: [{ text: 'โฉนดที่ดิน', confidence: 80 }, { text: 'นายสมชาย ใจดี', confidence: 90 }],
            truncated: false,
        });
        await service.runPrecheck(ocr.precheckId, ocr.args);
        expect(rowOf(ocr.precheckId).ocrConfidence).toBe(85);
        expect(rowOf(ocr.precheckId).extractedText).toBe('โฉนดที่ดิน\nนายสมชาย ใจดี');

        const none = await pendingDeed({ slotId: 'house_reg' });
        mockExtract.mockResolvedValueOnce({ method: 'NONE', pageCount: 0, pages: [], truncated: false });
        await service.runPrecheck(none.precheckId, none.args);
        expect(rowOf(none.precheckId)).toMatchObject({ status: 'DONE', extractMethod: 'NONE', ocrConfidence: null, extractedText: null });
    });

    test('a row that is no longer PENDING exits without extracting (the supersede guard)', async () => {
        const a = await pendingDeed();
        await pendingDeed(); // B supersedes A

        await service.runPrecheck(a.precheckId, a.args);

        expect(mockExtract).not.toHaveBeenCalled();
        expect(rowOf(a.precheckId).status).toBe('SUPERSEDED');
        expect(flagsOf(a.precheckId)).toHaveLength(0);
    });

    test('precheck-supersede-race: B arrives while A is extracting → A\'s flags are discarded and A stays SUPERSEDED', async () => {
        const a = await pendingDeed();
        const gate = deferred();
        mockExtract.mockReturnValueOnce(gate.promise);

        const running = service.runPrecheck(a.precheckId, a.args);
        await new Promise((r) => setImmediate(r)); // A has loaded its PENDING row and is extracting
        expect(mockExtract).toHaveBeenCalledTimes(1);

        const b = await pendingDeed(); // upload B for the same slot
        gate.resolve(textExtraction(DEED_TEXT));
        await running;

        expect(rowOf(a.precheckId).status).toBe('SUPERSEDED');
        expect(flagsOf(a.precheckId)).toHaveLength(0);
        expect(rowOf(b.precheckId).status).toBe('PENDING');
    });

    test('extraction PRECHECK_TIMEOUT on a non-final attempt rethrows and leaves the row PENDING for the retry', async () => {
        const { precheckId, args } = await pendingDeed();
        mockExtract.mockRejectedValueOnce(timeoutError());

        await expect(service.runPrecheck(precheckId, { ...args, isFinalAttempt: false })).rejects.toMatchObject({ code: 'PRECHECK_TIMEOUT' });

        expect(rowOf(precheckId).status).toBe('PENDING');
        expect(flagsOf(precheckId)).toHaveLength(0);
    });

    test('an OCR failure on the final attempt → FAILED + the failure flag, and does not throw', async () => {
        const { precheckId, args } = await pendingDeed();
        mockExtract.mockRejectedValueOnce(new Error('document-precheck OCR failed: tessdata missing'));

        await expect(service.runPrecheck(precheckId, { ...args, isFinalAttempt: true })).resolves.toBeUndefined();

        expect(rowOf(precheckId).status).toBe('FAILED');
        expect(flagsOf(precheckId)).toEqual([expect.objectContaining({ ...FAILURE_FLAG, organizationId: ORG })]);
    });

    test('a non-extraction exception (reference load) → FAILED + the flag at once, even on a non-final attempt', async () => {
        const { precheckId, args } = await pendingDeed();
        mockExtract.mockResolvedValueOnce(textExtraction(DEED_TEXT));
        mockPrisma.application.findUnique.mockRejectedValueOnce(new Error('connection reset'));

        await expect(service.runPrecheck(precheckId, { ...args, isFinalAttempt: false })).resolves.toBeUndefined();

        expect(rowOf(precheckId).status).toBe('FAILED');
        expect(flagsOf(precheckId)).toEqual([expect.objectContaining(FAILURE_FLAG)]);
    });

    test('the processor: attempt 1 of 2 fails → rethrows, PENDING; attempt 2 of 2 fails → FAILED + flag. Nothing is left PENDING', async () => {
        const { precheckId, args } = await pendingDeed();
        const job = (attemptsMade) => ({ data: { precheckId, absPath: args.absPath, mimeType: args.mimeType }, attemptsMade, opts: { attempts: 2 } });
        mockExtract.mockRejectedValue(timeoutError());

        await expect(processPrecheckJob(job(0))).rejects.toMatchObject({ code: 'PRECHECK_TIMEOUT' });
        expect(rowOf(precheckId).status).toBe('PENDING');

        await expect(processPrecheckJob(job(1))).resolves.toBeUndefined();
        expect(rowOf(precheckId).status).toBe('FAILED');
        expect(flagsOf(precheckId)).toEqual([expect.objectContaining(FAILURE_FLAG)]);
        expect(mockDb.prechecks.filter((r) => r.status === 'PENDING')).toHaveLength(0);
    });

    test('failPrecheck (the queue\'s last-resort failed handler) marks a still-PENDING row FAILED and leaves a DONE row alone', async () => {
        const stuck = await pendingDeed();
        await service.failPrecheck(stuck.precheckId);
        expect(rowOf(stuck.precheckId).status).toBe('FAILED');
        expect(flagsOf(stuck.precheckId)).toEqual([expect.objectContaining(FAILURE_FLAG)]);

        const done = await pendingDeed({ slotId: 'house_reg' });
        mockExtract.mockResolvedValueOnce(textExtraction('ทะเบียนบ้าน นายสมชาย ใจดี'));
        await service.runPrecheck(done.precheckId, done.args);
        const flagCount = flagsOf(done.precheckId).length;
        await service.failPrecheck(done.precheckId);
        expect(rowOf(done.precheckId).status).toBe('DONE');
        expect(flagsOf(done.precheckId)).toHaveLength(flagCount);
    });
});

describe('loadReference', () => {
    test('INDIVIDUAL: applicant name, entity type, and only the last 4 digits of the citizen ID — never the full ID', async () => {
        const reference = await service.loadReference(APP_INDIVIDUAL);

        expect(reference).toEqual({ entityType: 'INDIVIDUAL', applicantName: 'สมชาย ใจดี', citizenIdLast4: CITIZEN_ID.slice(-4) });
        expect(JSON.stringify(reference)).not.toMatch(THIRTEEN_DIGITS_RE);

        // explicit selects: the application query never asks for the national ID;
        // the one entity query that does asks for nothing else
        const appSelect = mockPrisma.application.findUnique.mock.calls[0][0].select;
        expect(JSON.stringify(appSelect)).not.toContain('thaiCitizenId');
        expect(appSelect.entity.select).toEqual({ type: true, displayName: true, juristicId: true, payload: true });
        expect(appSelect.applicant.select).toEqual({ firstName: true, lastName: true });
        expect(mockPrisma.entity.findUnique).toHaveBeenCalledTimes(1);
        expect(mockPrisma.entity.findUnique.mock.calls[0][0].select).toEqual({ thaiCitizenId: true });
    });

    test('JURISTIC: entity name, juristic ID and the director\'s name from payload.director — the director\'s ID card is not carried', async () => {
        const reference = await service.loadReference(APP_JURISTIC);

        expect(reference).toEqual({
            entityType: 'JURISTIC',
            entityName: 'บริษัท สมุนไพรไทย จำกัด',
            juristicId: '0105560000018',
            directorName: 'นางสาวสมหญิง รักดี',
            applicantName: 'สมหญิง รักดี',
        });
        expect(JSON.stringify(reference)).not.toContain(CITIZEN_ID);
        expect(mockPrisma.entity.findUnique).not.toHaveBeenCalled();
    });

    test('a whole run never writes the full citizen ID to a log line, a flag, or the reference', async () => {
        const { precheckId } = await service.enqueueForUpload(upload({ slotId: 'id_card' }));
        mockExtract.mockResolvedValueOnce(textExtraction(`บัตรประจำตัวประชาชน ${CITIZEN_ID} นายสมชาย ใจดี`));

        await service.runPrecheck(precheckId, { absPath: '/x.png', mimeType: 'image/png' });

        expect(rowOf(precheckId).status).toBe('DONE');
        const flags = flagsOf(precheckId);
        expect(flags.find((f) => f.check === 'CROSS_MATCH').result).toBe('MATCH');
        for (const f of flags) {
            expect(`${f.reasonTH} ${f.evidenceSnippet || ''}`).not.toMatch(THIRTEEN_DIGITS_RE);
        }
        expect(JSON.stringify(mockLogCalls)).not.toContain(CITIZEN_ID);
    });
});

describe('acknowledge', () => {
    test('the owner sets applicantAcknowledgedAt once; a second call keeps the first time', async () => {
        const { precheckId } = await service.enqueueForUpload(upload());

        await service.acknowledge(precheckId, 'health-1');
        const first = rowOf(precheckId).applicantAcknowledgedAt;
        expect(first).toBeInstanceOf(Date);

        await new Promise((r) => setTimeout(r, 5));
        await service.acknowledge(precheckId, 'health-1');
        expect(rowOf(precheckId).applicantAcknowledgedAt).toBe(first);
    });

    test('anyone else is refused (FORBIDDEN) and nothing is written; an unknown id is NOT_FOUND', async () => {
        const { precheckId } = await service.enqueueForUpload(upload());

        await expect(service.acknowledge(precheckId, 'health-2')).rejects.toMatchObject({ code: 'FORBIDDEN' });
        await expect(service.acknowledge(precheckId, undefined)).rejects.toMatchObject({ code: 'FORBIDDEN' });
        expect(rowOf(precheckId).applicantAcknowledgedAt).toBeNull();
        await expect(service.acknowledge('pc-none', 'health-1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
});

describe('retireForDocument', () => {
    // Final review I2. The real clearing runs on Postgres in
    // __tests__/integration/document-precheck-flow.test.js; here: it is never
    // run without the application AND organisation that bind it — updateMany
    // is not narrowed by the tenant extension, and an undefined key in a Prisma
    // where clause means "any".
    test.each([
        ['no organizationId', { applicationId: 'app-1' }],
        ['no applicationId', { organizationId: 'org-1' }],
        ['no owner at all', undefined],
    ])('%s → refused before any write', async (_label, owner) => {
        const file = upload();
        const { precheckId } = await service.enqueueForUpload(file);

        await expect(service.retireForDocument(file.documentId, owner)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
        expect(rowOf(precheckId).status).toBe('PENDING');
    });
});

describe('queue-service: the document-precheck queue', () => {
    function loadQueueServiceWithFakeBull() {
        const created = [];
        let result;
        jest.isolateModules(() => {
            jest.doMock('bull', () => jest.fn().mockImplementation((name, url, opts) => {
                const handlers = {};
                const q = {
                    name,
                    opts,
                    process: jest.fn(),
                    add: jest.fn(async () => ({})),
                    on: jest.fn((event, fn) => {
                        handlers[event] = fn;
                        return q;
                    }),
                    handlers,
                };
                created.push(q);
                return q;
            }));
            jest.doMock('../../../jobs/sla-processor', () => jest.fn());
            result = jest.requireActual('../../../services/queue-service');
        });
        return { queueService: result, created };
    }

    test('initQueues creates document-precheck with the brief\'s job options and a sandboxed processor file — even though pdf-processor.js is absent', () => {
        const { queueService, created } = loadQueueServiceWithFakeBull();

        queueService.initQueues();

        const q = created.find((c) => c.name === 'document-precheck');
        expect(q).toBeDefined();
        expect(q.opts.defaultJobOptions).toEqual({ attempts: 2, backoff: 30000, timeout: 120000, removeOnComplete: 500 });
        const processorPath = path.resolve(__dirname, '../../../jobs/document-precheck-processor.js');
        expect(q.process).toHaveBeenCalledWith(1, processorPath);
        expect(fs.existsSync(processorPath)).toBe(true);
        expect(queueService.getPrecheckQueue()).toBe(q);
    });

    test('a job that failed its LAST attempt is marked FAILED; a failure with a retry left is not', async () => {
        const { queueService, created } = loadQueueServiceWithFakeBull();
        queueService.initQueues();
        const q = created.find((c) => c.name === 'document-precheck');

        const retryLeft = await service.enqueueForUpload(upload({ slotId: 'house_reg' }));
        const exhausted = await service.enqueueForUpload(upload());

        // Bull emits `failed` after moveToFailed: a job with a retry left sits in
        // `delayed`/`wait` (isFailed false), a spent one in `failed` (isFailed true).
        await q.handlers.failed({ id: 'j1', data: { precheckId: retryLeft.precheckId }, attemptsMade: 1, opts: { attempts: 2 }, isFailed: async () => false }, new Error('boom'));
        await q.handlers.failed({ id: 'j2', data: { precheckId: exhausted.precheckId }, attemptsMade: 2, opts: { attempts: 2 }, isFailed: async () => true }, new Error('boom'));

        expect(rowOf(retryLeft.precheckId).status).toBe('PENDING');
        expect(rowOf(exhausted.precheckId).status).toBe('FAILED');
        expect(flagsOf(exhausted.precheckId)).toEqual([expect.objectContaining(FAILURE_FLAG)]);
    });

    // Final review I1: Bull 4.16.5 lib/queue.js:1061 fails a job that stalled
    // past maxStalledCount WITHOUT counting an attempt — attemptsMade stays
    // below attempts, yet the job is in the `failed` set and never runs again.
    test('a job Bull failed for stalling past its limit (attemptsMade < attempts, isFailed true) is marked FAILED', async () => {
        const { queueService, created } = loadQueueServiceWithFakeBull();
        queueService.initQueues();
        const q = created.find((c) => c.name === 'document-precheck');

        const stalled = await service.enqueueForUpload(upload());
        const stallJob = { id: 'j3', data: { precheckId: stalled.precheckId }, attemptsMade: 0, opts: { attempts: 2 }, isFailed: jest.fn(async () => true) };

        await q.handlers.failed(stallJob, new Error('job stalled more than allowable limit'));

        expect(rowOf(stalled.precheckId).status).toBe('FAILED');
        expect(flagsOf(stalled.precheckId)).toEqual([expect.objectContaining(FAILURE_FLAG)]);
        expect(stallJob.isFailed).toHaveBeenCalled();
    });

    test('when Redis cannot say the job state, the stall message still marks FAILED and a retry-left failure still does not', async () => {
        const { queueService, created } = loadQueueServiceWithFakeBull();
        queueService.initQueues();
        const q = created.find((c) => c.name === 'document-precheck');
        const unreadable = async () => {
            throw new Error('redis down');
        };

        const stalled = await service.enqueueForUpload(upload());
        const retryLeft = await service.enqueueForUpload(upload({ slotId: 'house_reg' }));

        await q.handlers.failed({ id: 'j4', data: { precheckId: stalled.precheckId }, attemptsMade: 0, opts: { attempts: 2 }, isFailed: unreadable }, new Error('job stalled more than allowable limit'));
        await q.handlers.failed({ id: 'j5', data: { precheckId: retryLeft.precheckId }, attemptsMade: 1, opts: { attempts: 2 }, isFailed: unreadable }, new Error('boom'));

        expect(rowOf(stalled.precheckId).status).toBe('FAILED');
        expect(rowOf(retryLeft.precheckId).status).toBe('PENDING');
    });

    test('a `failed` event with no job (Bull could not load it) is ignored without throwing', async () => {
        const { queueService, created } = loadQueueServiceWithFakeBull();
        queueService.initQueues();
        const q = created.find((c) => c.name === 'document-precheck');

        await expect(Promise.resolve(q.handlers.failed(null, new Error('job stalled more than allowable limit')))).resolves.toBeUndefined();
    });
});

describe('POST /draft-documents — the pre-check hook', () => {
    const applicationService = require('../../../services/application-service');
    const storageService = require('../../../services/storage-service');
    const applicationsRouter = require('../../../routes/api/applications/applications');
    const DRAFT_DIR = path.join(storageService.BASE_UPLOAD_DIR, 'application-drafts');
    const createdFiles = new Set();
    let draftDocuments = [];

    function buildApp() {
        const app = express();
        app.use(express.json());
        app.use('/api/applications', applicationsRouter);
        app.use((err, _req, res, _next) => res.status(500).json({ success: false, error: 'INTERNAL', message: err.message }));
        return app;
    }

    function realisticPdf(bytes = 14029) {
        const header = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n', 'utf8');
        return Buffer.concat([header, Buffer.alloc(Math.max(0, bytes - header.length), 0x20)]);
    }

    function listDraftDir() {
        try {
            return new Set(fs.readdirSync(DRAFT_DIR));
        } catch {
            return new Set();
        }
    }

    async function post(slotId) {
        const before = listDraftDir();
        const res = await request(buildApp())
            .post('/api/applications/draft-documents')
            .field('slotId', slotId)
            .field('stepKey', 'documents')
            .attach('file', realisticPdf(), { filename: 'deed.pdf', contentType: 'application/pdf' });
        [...listDraftDir()].filter((name) => !before.has(name)).forEach((name) => createdFiles.add(name));
        return res;
    }

    beforeEach(() => {
        draftDocuments = [];
        applicationService.resolveHealthIdentity.mockResolvedValue({ userId: 'user-1', healthId: 'health-1' });
        applicationService.findApplicationByIdForHealth.mockResolvedValue(null);
        applicationService.findLatestOpenDraftForHealth.mockImplementation(async () => ({
            id: APP_INDIVIDUAL,
            applicationNumber: 'APP-2026-000001',
            status: 'DRAFT',
            entityId: 'ent-ind',
            submitterId: 'user-1',
            organizationId: ORG,
            formData: { draftDocuments },
            workflowHistory: [],
        }));
        applicationService.updateApplicantDraftColumns.mockImplementation(async (_id, patch) => {
            draftDocuments = patch.formData.draftDocuments;
            return { id: APP_INDIVIDUAL, formData: patch.formData };
        });
    });

    afterAll(() => {
        for (const name of createdFiles) {
            try {
                fs.unlinkSync(path.join(DRAFT_DIR, name));
            } catch {
                /* best-effort */
            }
        }
    });

    function expectUploadBody(res) {
        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            success: true,
            data: {
                applicationId: APP_INDIVIDUAL,
                draftId: APP_INDIVIDUAL,
                documentId: expect.any(String),
                fileName: 'deed.pdf',
                fileUrl: expect.any(String),
                mimeType: 'application/pdf',
                size: 14029,
            },
        });
    }

    test('an in-scope upload creates a PENDING pre-check for exactly this document and adds the job', async () => {
        const res = await post('land_deed');

        expectUploadBody(res);
        expect(mockDb.prechecks).toHaveLength(1);
        expect(mockDb.prechecks[0]).toMatchObject({ status: 'PENDING', documentId: res.body.data.documentId, slotId: 'land_rights', applicationId: APP_INDIVIDUAL, organizationId: ORG });
        const job = mockQueueRef.current.add.mock.calls[0][0];
        expect(job.mimeType).toBe('application/pdf');
        expect(path.isAbsolute(job.absPath)).toBe(true);
        expect(fs.existsSync(job.absPath)).toBe(true);
    });

    test('enqueue-failure-still-uploads: the queue add throws → 200 with the unchanged body, and the row is FAILED with the failure flag', async () => {
        mockQueueRef.current.add.mockRejectedValue(new Error('Redis connection refused'));

        const res = await post('land_deed');

        expectUploadBody(res);
        expect(mockDb.prechecks).toHaveLength(1);
        expect(mockDb.prechecks[0].status).toBe('FAILED');
        expect(flagsOf(mockDb.prechecks[0].id)).toEqual([expect.objectContaining(FAILURE_FLAG)]);
    });

    test('I2: a queue add that never settles (unreachable Redis) → the route answers 200 unchanged within ~2 s, and the row is FAILED', async () => {
        mockQueueRef.current.add.mockImplementation(() => new Promise(() => {}));

        const started = Date.now();
        const res = await post('land_deed');
        const elapsed = Date.now() - started;

        expectUploadBody(res);
        expect(elapsed).toBeLessThan(3000);
        expect(mockDb.prechecks).toHaveLength(1);
        expect(mockDb.prechecks[0].status).toBe('FAILED');
        expect(flagsOf(mockDb.prechecks[0].id)).toEqual([expect.objectContaining(FAILURE_FLAG)]);
    }, 10000);

    test('even enqueueForUpload itself throwing (database down) leaves the upload response unchanged', async () => {
        mockPrisma.$transaction.mockRejectedValueOnce(new Error('database down'));

        const res = await post('land_deed');

        expectUploadBody(res);
    });

    test('an out-of-scope slot uploads exactly as before and creates no pre-check', async () => {
        const res = await post('sop_cultivation');

        expectUploadBody(res);
        expect(mockDb.prechecks).toHaveLength(0);
        expect(mockQueueRef.current.add).not.toHaveBeenCalled();
    });
});
