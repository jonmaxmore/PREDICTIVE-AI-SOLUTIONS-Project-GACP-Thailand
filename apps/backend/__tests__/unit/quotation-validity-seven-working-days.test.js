/**
 * quotation-validity-seven-working-days.test.js
 *
 * Operator ruling, re-confirmed 2026-09-27: "ใบเสนอราคามีกำหนดยืนราคา 7 วันทำการ
 * นับจากวันที่ออก โดยไม่นับวันที่ออก". Replaces the retired 30-CALENDAR-day
 * DEFAULT_VALIDITY_DAYS in quotation-service.js. `validUntil` must now be
 * `addWorkingDays(issueDate, PAYMENT.QUOTATION_VALIDITY_BUSINESS_DAYS)`
 * (utils/working-days.js), evaluated in Asia/Bangkok, regardless of the
 * process TZ.
 *
 * Each case below is computed BY HAND against the Thai public-holiday tables
 * in utils/working-days.js (RECURRING_HOLIDAYS + EXTRA_HOLIDAYS_BY_YEAR[2026])
 * — the issue day itself never counts; addWorkingDays returns 23:59:59.999
 * Bangkok on the 7th qualifying working day after it.
 */

'use strict';

const path = require('path');

// Mirrors the mock-prisma harness in quotation-service.test.js (same shape,
// trimmed to only what issueQuotationsForApplication touches).
const makeMockPrisma = () => {
    const applications = new Map();
    const quotations = new Map();
    let quotationIdCounter = 0;
    function genId(prefix) {
        return `${prefix}-${(++quotationIdCounter).toString().padStart(4, '0')}`;
    }
    const client = {
        __seedApplication(app) {
            applications.set(app.id, { ...app });
        },
        application: {
            findUnique: jest.fn(async ({ where }) => {
                const a = applications.get(where.id);
                return a ? { ...a } : null;
            }),
        },
        quotation: {
            findMany: jest.fn(async ({ where }) => {
                const list = Array.from(quotations.values());
                return list.filter((q) => {
                    if (where.applicationId && q.applicationId !== where.applicationId) {
                        return false;
                    }
                    if (where.isDeleted === false && q.isDeleted) { return false; }
                    return true;
                });
            }),
            findFirst: jest.fn(async ({ where }) => {
                const list = Array.from(quotations.values());
                return list.find((q) => {
                    if (where.id && q.id !== where.id) { return false; }
                    if (where.isDeleted === false && q.isDeleted) { return false; }
                    return true;
                }) || null;
            }),
            create: jest.fn(async ({ data }) => {
                const id = genId('qt');
                const row = {
                    id,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    isDeleted: false,
                    acceptedAt: null,
                    rejectedAt: null,
                    notes: null,
                    applicantNotes: null,
                    updatedBy: null,
                    ...data,
                };
                quotations.set(id, row);
                return { ...row };
            }),
            update: jest.fn(async ({ where, data }) => {
                const existing = quotations.get(where.id);
                if (!existing) { throw new Error('quotation not found'); }
                const next = { ...existing, ...data, updatedAt: new Date() };
                quotations.set(where.id, next);
                return { ...next };
            }),
        },
    };
    client.$transaction = jest.fn(async (cb) => (
        typeof cb === 'function' ? cb(client) : null
    ));
    return client;
};

let mockPrisma;
jest.mock('../../services/prisma-database', () => ({
    get prisma() { return mockPrisma; },
}));

function loadService() {
    delete require.cache[require.resolve(
        path.join(__dirname, '..', '..', 'services', 'quotation-service'),
    )];
    delete require.cache[require.resolve(
        path.join(__dirname, '..', '..', 'services', 'receipt-numbering-service'),
    )];
    return require(path.join(__dirname, '..', '..', 'services', 'quotation-service'));
}

const APP_ID = '22222222-2222-2222-2222-222222222222';
const ORG_ID = 'org-qt7';

function seedApp(mp) {
    mp.__seedApplication({
        id: APP_ID,
        formData: { cultivationMethods: ['outdoor'] },
        totalAreaTypes: 1,
        organizationId: ORG_ID,
        isDeleted: false,
    });
}

beforeEach(() => {
    mockPrisma = makeMockPrisma();
    seedApp(mockPrisma);
});

afterEach(() => {
    jest.useRealTimers();
});

describe('[quotation-service] validUntil = issueDate + 7 working days (Bangkok)', () => {
    // Case 1 — issued on a Friday.
    // Fri 2026-09-18 (no Thai public holiday nearby). Counting forward,
    // skipping only Sat/Sun (no holiday falls in this run):
    //   1 Mon 09-21, 2 Tue 09-22, 3 Wed 09-23, 4 Thu 09-24, 5 Fri 09-25,
    //   6 Mon 09-28, 7 Tue 09-29
    // => validUntil = Tue 2026-09-29 23:59:59.999 Bangkok (UTC+7)
    //               = 2026-09-29T16:59:59.999Z
    test('Friday issue date lands on the 7th working day, skipping the weekend', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-09-18T09:00:00.000+07:00'));
        const svc = loadService();

        const { company } = await svc.issueQuotationsForApplication(APP_ID, {});

        expect(new Date(company.validUntil).toISOString()).toBe('2026-09-29T16:59:59.999Z');
    });

    // Case 2 — issued the day before a run of Thai public holidays.
    // Mon 2026-07-27. RECURRING_HOLIDAYS '07-28' (วันเฉลิมพระชนมพรรษา ร.10) and
    // EXTRA_HOLIDAYS_BY_YEAR[2026] '2026-07-29' + '2026-07-30' (วันอาสาฬหบูชา /
    // วันเข้าพรรษา) make Tue 28, Wed 29, Thu 30 all holidays. Counting forward:
    //   Tue 07-28 holiday (skip), Wed 07-29 holiday (skip), Thu 07-30 holiday (skip)
    //   1 Fri 07-31, [Sat 08-01 / Sun 08-02 weekend skip],
    //   2 Mon 08-03, 3 Tue 08-04, 4 Wed 08-05, 5 Thu 08-06, 6 Fri 08-07,
    //   [Sat 08-08 / Sun 08-09 weekend skip], 7 Mon 08-10
    // => validUntil = Mon 2026-08-10 23:59:59.999 Bangkok (UTC+7)
    //               = 2026-08-10T16:59:59.999Z
    test('issue date just before a run of Thai public holidays skips all of them', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-07-27T09:00:00.000+07:00'));
        const svc = loadService();

        const { company } = await svc.issueQuotationsForApplication(APP_ID, {});

        expect(new Date(company.validUntil).toISOString()).toBe('2026-08-10T16:59:59.999Z');
    });

    // Case 3 — issued inside the Bangkok 00:00-07:00 window, which is still the
    // PREVIOUS calendar day in UTC. Fri 2026-09-18 02:00 Bangkok is
    // 2026-09-17T19:00:00.000Z — a naive UTC-day read would see Thu 09-17 and
    // compute a day early. The Bangkok-zoned reader must still see Friday and
    // produce the SAME result as Case 1.
    // => validUntil = Tue 2026-09-29 23:59:59.999 Bangkok = 2026-09-29T16:59:59.999Z
    test('Bangkok 00:00-07:00 window (previous UTC day) still reads as the Bangkok day', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-09-17T19:00:00.000Z'));
        const svc = loadService();

        const { company } = await svc.issueQuotationsForApplication(APP_ID, {});

        expect(new Date(company.validUntil).toISOString()).toBe('2026-09-29T16:59:59.999Z');
    });
});
