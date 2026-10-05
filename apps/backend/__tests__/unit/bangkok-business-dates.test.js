'use strict';

/**
 * Business dates are Bangkok dates, whatever clock zone the process runs in.
 * Audit 2026-09-17: CODE-01, CODE-X1 (backend), DOMA-10, and the VAT period.
 *
 * The backend image sets no TZ, so production runs on UTC. Anything that reads
 * a calendar day from the process clock (getDate/getMonth/getFullYear,
 * setHours) is a day early for every instant between 00:00 and 06:59 in
 * Bangkok: a receipt paid at 01:30 on 17 Sep 2569 printed 16 Sep. This host
 * runs on Asia/Bangkok, which is why the rest of the suite never saw it.
 *
 * Setting process.env.TZ inside a jest test does not reach ICU (jest hands the
 * test a copy of process.env), so the checks that depend on the clock zone run
 * in a fresh node process started with TZ=UTC — the same zone the containers
 * use. The first test proves that process really is on UTC, so nothing below
 * can pass just because this machine happens to be in Thailand.
 *
 * Holiday dates are checked against the sources listed above
 * EXTRA_HOLIDAYS_BY_YEAR in utils/working-days.js:
 *   - special days 2 มิ.ย. 68, 11 ส.ค. 68, 2 ม.ค. 69: มติ ครม. 12 พ.ย. 2567.
 *   - 2569: the government holiday list as republished (1 มิ.ย. ชดเชยวันวิสาขบูชา,
 *     29 ก.ค. อาสาฬหบูชา, 30 ก.ค. เข้าพรรษา, 7 ธ.ค. ชดเชยวันพ่อแห่งชาติ).
 *   - 2570: ประกาศธนาคารแห่งประเทศไทย ที่ 37/2569 (ราชกิจจานุเบกษา
 *     25 ส.ค. 2569): 22 ก.พ. ชดเชยวันมาฆบูชา, 19 ก.ค. ชดเชยวันอาสาฬหบูชา,
 *     3 พ.ค. / 25 ต.ค. / 6 ธ.ค. ชดเชย.
 */

const path = require('path');
const { execFileSync } = require('child_process');

const BACKEND_ROOT = path.resolve(__dirname, '../..');
const RESULT_MARK = '@@BANGKOK_DATES_RESULT@@';

// 01:30 on 17 Sep 2569 in Bangkok. Still 16 Sep in UTC.
const AFTER_MIDNIGHT_BKK = '2026-09-16T18:30:00.000Z';
// 01:30 on 1 Jan 2570 in Bangkok. Still 31 Dec 2569 in UTC.
const NEW_YEAR_BKK = '2026-12-31T18:30:00.000Z';
// 00:30 on 1 Jan 2570 in Bangkok — the clock the numbering checks stop at.
const NEW_YEAR_0030_BKK = '2026-12-31T17:30:00.000Z';

/**
 * Run `body` (an async function body that returns JSON-able data) in a new
 * node process whose clock zone is UTC. Modules are required relative to
 * apps/backend. Some modules log to stdout while loading, so the result is
 * read from behind a marker rather than from the whole of stdout.
 */
function underUtc(body) {
    const script = [
        // One broken value must not hide the others: `safe` reports a throw as
        // data, and the assertion on that value fails on its own.
        'const safe = (fn) => { try { return fn(); } catch (e) { return `THREW: ${e.message}`; } };',
        '(async () => {',
        body,
        '})().then(',
        `  (out) => { process.stdout.write('\\n${RESULT_MARK}' + JSON.stringify(out)); process.exit(0); },`,
        '  (err) => { process.stderr.write(String(err && err.stack || err)); process.exit(1); },',
        ');',
    ].join('\n');
    const stdout = execFileSync(process.execPath, ['-e', script], {
        cwd: BACKEND_ROOT,
        env: { ...process.env, TZ: 'UTC' },
        encoding: 'utf8',
        timeout: 60_000,
    });
    return JSON.parse(stdout.slice(stdout.lastIndexOf(RESULT_MARK) + RESULT_MARK.length));
}

describe('the checks below really run on a UTC clock', () => {
    it('the child process reads 16 Sep for an instant that is 17 Sep in Bangkok', () => {
        const out = underUtc(`
            return {
                zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                localDay: new Date('${AFTER_MIDNIGHT_BKK}').getDate(),
            };
        `);
        expect(out).toEqual({ zone: 'UTC', localDay: 16 });
    });
});

describe('CODE-01 — Thai document dates are the Bangkok date on a UTC server', () => {
    let out;
    beforeAll(() => {
        out = underUtc(`
            const T = new Date('${AFTER_MIDNIGHT_BKK}');
            const NY = new Date('${NEW_YEAR_BKK}');
            const thaiFormat = require('./utils/thai-format');
            const thaiNumerals = require('./utils/thai-numerals');
            const receipt = require('./services/receipt-numbering-service');
            const invoiceTpl = require('./services/pdf/invoice-template-service');
            const certTpl = require('./services/pdf/certificate-template-service');
            const lotLabel = require('./services/pdf/lot-label-template-service');
            const katorlor1 = require('./services/pdf/katorlor1-template-service');
            const carReport = require('./services/pdf/car-report-service');
            const auditReport = require('./services/pdf/audit-report-service');

            const pick = (obj, keys) => Object.fromEntries(keys.map((k) => [k, obj[k]]));
            return {
                short: safe(() => thaiFormat.formatThaiDate(T)),
                full: safe(() => thaiFormat.formatThaiDateFull(T)),
                fullNewYear: safe(() => thaiFormat.formatThaiDateFull(NY)),
                numerals: safe(() => thaiNumerals.formatThaiDate(T)),
                platformReceiptDate: safe(() => receipt.formatReceiptVariablesForIssuer('PLATFORM', { issueDate: T }).issueDate),
                cert: safe(() => pick(certTpl.buildCertificateContext({
                    certificateNumber: 'GACP-TH-2569-A3F7B2',
                    issuedDate: T,
                    expiryDate: new Date('2029-09-16T18:30:00.000Z'),
                    revisionNo: 2,
                    revisedAt: T,
                }), ['ISSUE_DATE_TH', 'EXPIRY_DATE_TH', 'ISSUED_DATE_TH', 'ISSUED_DATE_SHORT', 'REVISION_LINE'])),
                lotLabel: safe(() => lotLabel._internals.formatThaiDate(new Date('2026-12-04T18:30:00.000Z'))),
                katorlor1: safe(() => katorlor1.renderKatorlor1Html({ submittedAt: T, formData: {} }, {})),
                carHtml: safe(() => carReport.generateCARHTML({
                    carNumber: 'CAR-2569-0001', auditDate: T, issuedAt: T,
                    deadline: new Date('2026-12-15T16:59:59.999Z'), failedItems: [],
                })),
                auditHtml: safe(() => auditReport.generateAuditReportHTML({
                    auditNumber: 'AUD-1', scheduledDate: T, createdAt: T, responses: [], categoryScores: [],
                })),
            };
        `);
    });

    it('utils/thai-format prints 17 Sep 2569, not 16', () => {
        expect(out.short).toBe('17 ก.ย. 2569');
        expect(out.full).toBe('17 กันยายน 2569');
        expect(out.fullNewYear).toBe('1 มกราคม 2570');
    });

    it('utils/thai-numerals prints the Thai-digit date (certificate body) for the Bangkok day', () => {
        expect(out.numerals).toBe('๑๗ กันยายน พุทธศักราช ๒๕๖๙');
    });

    it('the tax-invoice / receipt issue date is the Bangkok day', () => {
        expect(out.platformReceiptDate).toBe('17 กันยายน 2569');
    });

    it('the certificate prints its issue, expiry and revision dates as Bangkok days', () => {
        expect(out.cert).toEqual({
            ISSUE_DATE_TH: '๑๗ กันยายน พุทธศักราช ๒๕๖๙',
            EXPIRY_DATE_TH: '๑๗ กันยายน พุทธศักราช ๒๕๗๒',
            ISSUED_DATE_TH: '17 กันยายน 2569',
            ISSUED_DATE_SHORT: '17/09/2569',
            REVISION_LINE: 'ฉบับแก้ไขครั้งที่ 1 · 17 ก.ย. 2569',
        });
    });

    it('the lot label prints the Bangkok day, still zero-padded', () => {
        expect(out.lotLabel).toBe('05 ธ.ค. 2569');
    });

    it('the กทล.1 form prints the Bangkok filing day', () => {
        expect(out.katorlor1).toContain('วันที่ยื่น 17 กันยายน 2569');
        expect(out.katorlor1).not.toContain('16 กันยายน 2569');
    });

    it('the CAR and audit reports print Bangkok days', () => {
        expect(out.carHtml).toContain('17 กันยายน 2569');
        expect(out.carHtml).toContain('15 ธันวาคม 2569');
        expect(out.carHtml).not.toContain('16 กันยายน 2569');
        expect(out.auditHtml).toContain('17 กันยายน 2569');
        expect(out.auditHtml).not.toContain('16 กันยายน 2569');
    });
});

describe('number year = printed year — the code mints the numbers on a UTC clock at 00:30 on 1 Jan 2570 in Bangkok', () => {
    // Operator 2026-09-26 ("เวลาไทยทั้งหมด"): every document number year is the
    // Bangkok year of the instant the document prints. Nothing here is handed a
    // number: the child process's clock is stopped at 00:30 Bangkok on 1 Jan
    // 2570 (still 31 Dec 2569 on the UTC clock), and each number is minted by
    // the code's own default path, then printed by the code's own template.
    let out;
    beforeAll(() => {
        out = underUtc(`
            const RealDate = Date;
            const FIXED = RealDate.parse('${NEW_YEAR_0030_BKK}');
            global.Date = class extends RealDate {
                constructor(...args) { super(...(args.length ? args : [FIXED])); }
                static now() { return FIXED; }
            };
            const receipt = require('./services/receipt-numbering-service');
            const invoiceTpl = require('./services/pdf/invoice-template-service');
            const certTpl = require('./services/pdf/certificate-template-service');
            const { thaiYear } = require('./shared/harvest-identifiers');
            const carReport = require('./services/pdf/car-report-service');
            const docNumbering = require('./services/document-numbering');
            const quoteService = safe(() => require('./services/quote-service'));

            // A sequence table that always hands out 1 — only the year matters here.
            const prismaClient = {
                receiptSequence: { upsert: async () => ({ counter: 1 }) },
                $transaction: async (fn) => fn(prismaClient),
            };
            const now = new Date();
            const taxInvoiceNo = (await receipt.allocateReceiptNumber({ issuer: 'PLATFORM', prismaClient })).number;
            const settledNo = (await receipt.allocateReceiptNumber({ issuer: 'PLATFORM', dateOrYear: now, prismaClient })).number;
            const creditNoteNo = (await receipt.allocateReceiptNumber({ issuer: 'CREDIT_NOTE_PLATFORM', dateOrYear: now, prismaClient })).number;
            const pick = (obj, keys) => Object.fromEntries(keys.map((k) => [k, obj[k]]));
            const certNo = 'GACP-TH-' + thaiYear() + '-A3F7B2';
            return {
                clockIsUtcDec31: [RealDate.prototype.getDate.call(now), now.toISOString()],
                taxInvoiceNo, settledNo, creditNoteNo,
                taxInvoice: safe(() => pick(invoiceTpl.buildReceiptContext({
                    serviceType: 'CERTIFICATION_CHECKOUT_M1',
                    totalAmount: 107,
                    receiptNumber: taxInvoiceNo,
                    receiptIssuedAt: now,
                }), ['RECEIPT_NUMBER', 'ISSUE_DATE', 'YEAR_BE_TH'])),
                creditNote: safe(() => pick(invoiceTpl.buildAdjustmentNoteContext({
                    createdAt: now,
                    subtotal: 100, vat: 7, totalAmount: 107,
                    originalInvoice: { serviceType: 'CERTIFICATION_CHECKOUT_M1', invoiceNumber: 'TAX-PRD-2026-000001', paidAt: new Date('${AFTER_MIDNIGHT_BKK}') },
                }, { docNumber: creditNoteNo, docTypeTh: 'ใบลดหนี้', docTypeEn: 'Credit Note' }),
                ['ISSUE_DATE', 'YEAR_BE_TH', 'ORIGINAL_INVOICE_DATE'])),
                certNo,
                cert: safe(() => pick(certTpl.buildCertificateContext({
                    certificateNumber: certNo,
                    issuedDate: now,
                    expiryDate: new Date('2027-12-31T17:30:00.000Z'),
                }), ['ISSUED_DATE_TH', 'ISSUED_DATE_SHORT'])),
                carNo: safe(() => carReport.generateCARNumber('AUD-1')),
                buddhistYear: safe(() => docNumbering.getBuddhistYear()),
                christianYear: safe(() => docNumbering.getChristianYear()),
                quoteNo: typeof quoteService === 'string' ? quoteService : safe(() => quoteService.generateInvoiceNumberRandom()),
            };
        `);
    });

    it('the child clock really is 31 Dec on UTC and 1 Jan 00:30 in Bangkok', () => {
        expect(out.clockIsUtcDec31).toEqual([31, '2026-12-31T17:30:00.000Z']);
    });

    it('the tax invoice minted now is TAX-PRD-2027-… and prints 1 Jan 2570, tax year ๒๕๗๐', () => {
        expect(out.taxInvoiceNo).toBe('TAX-PRD-2027-000001');
        expect(out.settledNo).toBe('TAX-PRD-2027-000001');
        expect(out.taxInvoice).toEqual({
            RECEIPT_NUMBER: 'TAX-PRD-2027-000001',
            ISSUE_DATE: '1 ม.ค. 2570',
            YEAR_BE_TH: '๒๕๗๐',
        });
    });

    it('the credit note minted now is CN-PRD-2027-… and prints 2570; the original invoice keeps its own Bangkok day', () => {
        expect(out.creditNoteNo).toBe('CN-PRD-2027-000001');
        expect(out.creditNote).toEqual({
            ISSUE_DATE: '1 ม.ค. 2570',
            YEAR_BE_TH: '๒๕๗๐',
            ORIGINAL_INVOICE_DATE: '17 ก.ย. 2569',
        });
    });

    it('the certificate number minted now is GACP-TH-2570-… and prints 1 Jan 2570', () => {
        expect(out.certNo).toBe('GACP-TH-2570-A3F7B2');
        expect(out.cert).toEqual({
            ISSUED_DATE_TH: '1 มกราคม 2570',
            ISSUED_DATE_SHORT: '01/01/2570',
        });
    });

    it('the CAR number, the numbering year helpers and the quote-path invoice number read the Bangkok year/day', () => {
        expect(out.carNo).toMatch(/^CAR-2570-\d{4}$/);
        expect(out.buddhistYear).toBe(2570);
        expect(out.christianYear).toBe(2027);
        expect(out.quoteNo).toMatch(/^INV-20270101-[0-9A-F]{8}$/);
    });
});

describe('CODE-X1 — audit appointments are Bangkok wall-clock times on a UTC server', () => {
    let out;
    beforeAll(() => {
        out = underUtc(`
            // Two audits on Sun 20 Sep in Bangkok: 06:30 and 09:00. In UTC the
            // first one is still the 19th.
            const SAME_BKK_DAY = [
                { id: 'a', applicationNumber: 'A', status: 'AUDIT_CONFIRMED', formData: {}, scheduledDate: new Date('2026-09-19T23:30:00.000Z') },
                { id: 'b', applicationNumber: 'B', status: 'AUDIT_CONFIRMED', formData: {}, scheduledDate: new Date('2026-09-20T02:00:00.000Z') },
            ];
            let captured = null;
            const prisma = { application: { findMany: async (args) => { captured = args.where; return SAME_BKK_DAY; } } };
            const dbPath = require.resolve('./services/prisma-database');
            require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { prisma } };
            const svc = require('./services/audit-scheduling-service');
            const { _internals } = svc;

            // A third request at 05:00 on the 20th in Bangkok (the 19th in UTC).
            const overCapMessage = await _internals._assertSlotAvailable(prisma, {
                auditorId: 'auditor-1', scheduledAt: new Date('2026-09-19T22:00:00.000Z'),
            }).then(() => 'no error', (e) => e.message);
            const availability = await svc.getAuditorAvailability({
                auditorId: 'auditor-1',
                dateRange: { from: '2026-09-18T00:00:00.000Z', to: '2026-09-22T00:00:00.000Z' },
            });
            await _internals._findAuditorBusyOnDate(prisma, {
                auditorId: 'auditor-1', scheduledAt: new Date('2026-09-20T02:00:00.000Z'),
            });
            const at = (date, time) => safe(() => _internals._resolveScheduledAt(date, time).toISOString());
            return {
                fromDateOnly: at('2026-09-20', '09:00'),
                fromBangkokMidnight: at('2026-09-19T17:00:00.000Z', '09:00'),
                earlyMorning: at('2026-09-20', '06:30'),
                dayWindow: { gte: captured.scheduledDate.gte.toISOString(), lte: captured.scheduledDate.lte.toISOString() },
                overCapMessage,
                overCapDays: availability.overCapDays,
            };
        `);
    });

    it('the over-cap error and the availability view count both audits on the same Bangkok day', () => {
        expect(out.overCapMessage).toContain('audits on 2026-09-20');
        expect(out.overCapDays).toEqual([{ day: '2026-09-20', count: 2 }]);
    });

    it('"20 Sep, 09:00" is 09:00 in Bangkok (02:00Z), not 09:00 UTC (16:00 in Bangkok)', () => {
        expect(out.fromDateOnly).toBe('2026-09-20T02:00:00.000Z');
        expect(out.fromBangkokMidnight).toBe('2026-09-20T02:00:00.000Z');
    });

    it('a time before 07:00 stays on the chosen Bangkok day', () => {
        expect(out.earlyMorning).toBe('2026-09-19T23:30:00.000Z');
    });

    it('the auditor-busy check counts the Bangkok day of the appointment', () => {
        expect(out.dayWindow).toEqual({
            gte: '2026-09-19T17:00:00.000Z',
            lte: '2026-09-20T16:59:59.999Z',
        });
    });
});

describe('notification times are Bangkok times on a UTC server', () => {
    let out;
    beforeAll(() => {
        out = underUtc(`
            const fanout = require('./services/notification-fanout-service');
            const { localWallClock, formatLocalTime } = require('./utils/working-days');
            const at = localWallClock('2026-09-21', '09:00');
            const rendered = fanout._internals.TEMPLATES.AUDIT_SCHEDULED({ applicationNumber: 'A', date: at });
            return {
                stored: at.toISOString(),
                time: fanout._internals.formatBETime(at),
                date: fanout._internals.formatBE(at),
                sms: rendered && rendered.smsTH,
                // routes/api/audit/audits.js prints scheduledTime with this helper
                routeTime: formatLocalTime(at),
            };
        `);
    });

    it('"21 Sep, 09:00" is stored as 02:00Z and every notification prints 09:00', () => {
        expect(out.stored).toBe('2026-09-21T02:00:00.000Z');
        expect(out.time).toBe('09:00');
        expect(out.date).toContain('21 กันยายน');
        expect(out.sms).toContain('09:00');
        expect(out.sms).not.toContain('02:00');
        expect(out.routeTime).toBe('09:00');
    });
});

describe('DOMA-10 — the working-day calendar matches the announced holidays', () => {
    const {
        isHoliday,
        isWorkingDay,
        addWorkingDays,
        getZonedParts,
        EXTRA_HOLIDAYS_BY_YEAR,
    } = require('../../utils/working-days');

    /** 00:00 in Bangkok on a YYYY-MM-DD day. */
    function bkk(isoDay) {
        const [y, m, d] = isoDay.split('-').map(Number);
        return new Date(Date.UTC(y, m - 1, d) - 7 * 3600 * 1000);
    }
    const offDays = (days) => days.filter((d) => isWorkingDay(bkk(d)));

    it('Mon 7 Dec 2569 (substitute for Father\'s Day on a Saturday) is not a working day', () => {
        expect(isHoliday(bkk('2026-12-07'))).toBe(true);
        expect(isWorkingDay(bkk('2026-12-07'))).toBe(false);
    });

    it('five working days from Fri 4 Dec 2569 skip 7 Dec and 10 Dec and end on Tue 15 Dec', () => {
        const due = addWorkingDays(bkk('2026-12-04'), 5);
        expect(getZonedParts(due).isoDate).toBe('2026-12-15');
        expect(due.toISOString()).toBe('2026-12-15T16:59:59.999Z');
    });

    it('the same deadline comes out the same on a UTC server', () => {
        const out = underUtc(`
            const { addWorkingDays, isWorkingDay } = require('./utils/working-days');
            return {
                due: addWorkingDays(new Date('2026-12-03T17:00:00.000Z'), 5).toISOString(),
                dec7: isWorkingDay(new Date('2026-12-07T05:00:00.000Z')),
            };
        `);
        expect(out).toEqual({ due: '2026-12-15T16:59:59.999Z', dec7: false });
    });

    it('2569: the announced lunar and special days are holidays', () => {
        expect(offDays([
            '2026-01-02', // วันหยุดพิเศษ (มติ ครม. 12 พ.ย. 2567)
            '2026-03-03', // วันมาฆบูชา
            '2026-06-01', // ชดเชยวันวิสาขบูชา (31 พ.ค. เป็นวันอาทิตย์)
            '2026-07-29', // วันอาสาฬหบูชา
            '2026-07-30', // วันเข้าพรรษา
        ])).toEqual([]);
    });

    it('2569: 1 and 2 Jul (the old, wrong Asalha dates) are ordinary working days', () => {
        expect(isWorkingDay(bkk('2026-07-01'))).toBe(true);
        expect(isWorkingDay(bkk('2026-07-02'))).toBe(true);
    });

    it('2570: the days in ประกาศ ธปท. 37/2569 are holidays, and 19 Feb is not', () => {
        expect(offDays([
            '2027-02-22', // ชดเชยวันมาฆบูชา
            '2027-05-03', // ชดเชยวันแรงงาน
            '2027-05-20', // วันวิสาขบูชา
            '2027-07-19', // ชดเชยวันอาสาฬหบูชา / วันเข้าพรรษา
            '2027-10-25', // ชดเชยวันปิยมหาราช
            '2027-12-06', // ชดเชยวันพ่อแห่งชาติ
        ])).toEqual([]);
        expect(isWorkingDay(bkk('2027-02-19'))).toBe(true);
    });

    it('2568: substitutes, the special days and the real Asalha date are holidays; 14 Jul is not', () => {
        expect(offDays([
            '2025-04-07', // ชดเชยวันจักรี
            '2025-04-16', // ชดเชยวันสงกรานต์
            '2025-05-05', // ชดเชยวันฉัตรมงคล
            '2025-05-12', // ชดเชยวันวิสาขบูชา
            '2025-06-02', // วันหยุดพิเศษ
            '2025-07-10', // วันอาสาฬหบูชา
            '2025-07-11', // วันเข้าพรรษา
            '2025-08-11', // วันหยุดพิเศษ
        ])).toEqual([]);
        expect(isWorkingDay(bkk('2025-07-14'))).toBe(true);
    });

    it('a run of fixed-date holidays that touches a weekend gets one substitute, across the new year too', () => {
        // 31 Dec 2565 was a Saturday and 1 Jan 2566 a Sunday. The 2566 list
        // gave one substitute for both: Mon 2 Jan. Tue 3 Jan was a working day.
        expect(isWorkingDay(bkk('2023-01-02'))).toBe(false);
        expect(isWorkingDay(bkk('2023-01-03'))).toBe(true);
        // Songkran 2567: Sat 13 to Mon 15 Apr, one substitute on Tue 16.
        expect(isWorkingDay(bkk('2024-04-16'))).toBe(false);
        expect(isWorkingDay(bkk('2024-04-17'))).toBe(true);
    });

    it('a substitute that is both announced and derived by the rule is one day off, not two', () => {
        // 7 Dec 2569 is copied from the announcement AND derived from 5 Dec.
        // Tue 8 Dec must stay a working day.
        expect(EXTRA_HOLIDAYS_BY_YEAR[2026]).toContain('2026-12-07');
        expect(isWorkingDay(bkk('2026-12-08'))).toBe(true);
    });

    it('beyond the dated table, the weekend rule still moves fixed-date holidays', () => {
        // 1 Jan 2571 (2028) is a Saturday.
        expect(Object.keys(EXTRA_HOLIDAYS_BY_YEAR)).not.toContain('2028');
        expect(isWorkingDay(bkk('2028-01-03'))).toBe(false);
        expect(isWorkingDay(bkk('2028-01-04'))).toBe(true);
    });
});

describe('VAT period (ภ.พ.30) follows the Bangkok calendar month', () => {
    const PLATFORM_VAT_ACCOUNT = '2131-001';

    function line(id, entryDate) {
        return {
            id,
            lineNumber: 4,
            accountCode: PLATFORM_VAT_ACCOUNT,
            debit: 0,
            credit: 7,
            taxableAmount: 100,
            metadata: {},
            entry: { id: `je-${id}`, entryDate: new Date(entryDate), reference: id, invoiceId: `inv-${id}` },
        };
    }

    // Each journal line is dated with its invoice's payment instant.
    const LINES = [
        // 01:00 on 1 Sep in Bangkok → September.
        line('first-hour-of-sep', '2026-08-31T18:00:00.000Z'),
        // 23:59:59.999 on 30 Sep in Bangkok → September.
        line('last-instant-of-sep', '2026-09-30T16:59:59.999Z'),
        // 03:00 on 1 Oct in Bangkok → October.
        line('issued-1-oct-0300-bkk', '2026-09-30T20:00:00.000Z'),
    ];

    function loadWithLedger() {
        const within = (d, { gte, lt }) => d >= gte && d < lt;
        const prisma = {
            journalLine: {
                findMany: jest.fn(async ({ where }) => LINES.filter((l) => within(l.entry.entryDate, where.entry.entryDate))),
            },
            invoice: {
                findMany: jest.fn(async ({ where }) => where.id.in.map((id) => {
                    const src = LINES.find((l) => l.entry.invoiceId === id);
                    return {
                        id,
                        invoiceNumber: src.id,
                        paidAt: src.entry.entryDate,
                        createdAt: src.entry.entryDate,
                        billingName: 'ผู้ซื้อ',
                        serviceType: 'PHASE_1_PLATFORM_FEE',
                        applicant: null,
                        application: null,
                    };
                })),
                count: jest.fn(async () => 0),
                findFirst: jest.fn(async () => null),
            },
        };
        jest.resetModules();
        jest.doMock('../../services/prisma-database', () => ({ prisma }));
        return require('../../services/vat-report-service');
    }

    afterEach(() => {
        jest.dontMock('../../services/prisma-database');
    });

    it('September 2569 excludes an invoice issued 2026-09-30T20:00Z (1 Oct 03:00 in Bangkok)', async () => {
        const service = loadWithLedger();
        const report = await service.generateOutputVatReport({ year: 2026, month: 9 });
        const numbers = report.rows.map((r) => r.invoiceNumber);
        expect(numbers).not.toContain('issued-1-oct-0300-bkk');
        expect(numbers).toEqual(['first-hour-of-sep', 'last-instant-of-sep']);
        expect(report.period.windowStart.toISOString()).toBe('2026-08-31T17:00:00.000Z');
        expect(report.period.windowEnd.toISOString()).toBe('2026-09-30T17:00:00.000Z');
    });

    it('October 2569 includes it', async () => {
        const service = loadWithLedger();
        const report = await service.generateOutputVatReport({ year: 2026, month: 10 });
        expect(report.rows.map((r) => r.invoiceNumber)).toEqual(['issued-1-oct-0300-bkk']);
    });

    it('the e-Filing CSV dates that invoice 2026-10-01 (its Bangkok day)', async () => {
        const service = loadWithLedger();
        const csv = await service.generateOutputVatReportCSV({ year: 2026, month: 10 });
        const row = csv.split('\r\n').find((l) => l.includes('issued-1-oct-0300-bkk'));
        expect(row).toContain(',2026-10-01,');
    });

    it('the ledger files the same entry in the same month as ภ.พ.30 — October, on a UTC server', () => {
        // Operator 2026-09-26: ledger months equal ภ.พ.30 months. The period
        // guard, period close, GL, trial balance and statements all read the
        // Bangkok month of 2026-09-30T20:00Z (03:00 on 1 Oct in Bangkok).
        const out = underUtc(`
            const guardCalls = [];
            // Guard first: period-close-service -> vat-report-service ->
            // journal-entry-service -> guard is a require cycle, and a guard
            // loaded inside it holds a half-built period-close module.
            const guard = require('./services/journal-entry-period-guard');
            const realPc = require('./services/period-close-service');
            // The guard holds this same exports object; record what it asks.
            realPc.isPeriodClosed = async (args) => { guardCalls.push(args); return false; };
            await guard.checkPeriodOpen({ entryDate: new Date('2026-09-30T20:00:00.000Z') });
            const { isMonthFullyElapsed } = realPc._internals;
            const gl = require('./services/general-ledger-service');
            const tb = require('./services/trial-balance-service');
            const fs = require('./services/financial-statements-service');
            const vat = require('./services/vat-report-service');
            const oct = vat._internals.toMonthBoundaries(2026, 10);
            return {
                guardMonth: guardCalls[0] && { year: guardCalls[0].year, month: guardCalls[0].month },
                septemberClosableAtEntry: isMonthFullyElapsed(2026, 9, new Date('2026-09-30T20:00:00.000Z')),
                octoberClosableAtEntry: isMonthFullyElapsed(2026, 10, new Date('2026-09-30T20:00:00.000Z')),
                septemberClosableJustBefore: isMonthFullyElapsed(2026, 9, new Date('2026-09-30T16:59:59.999Z')),
                glOctoberStart: gl.parseStartDate('2026-10-01').toISOString(),
                fsOctoberStart: fs.parseStartDate('2026-10-01').toISOString(),
                tbSeptemberEnd: tb.parseAsOfDate('2026-09-30').toISOString(),
                vatOctober: [oct.start.toISOString(), oct.end.toISOString()],
            };
        `);
        expect(out.guardMonth).toEqual({ year: 2026, month: 10 });
        expect(out.septemberClosableAtEntry).toBe(true);
        expect(out.octoberClosableAtEntry).toBe(false);
        expect(out.septemberClosableJustBefore).toBe(false);
        // GL / statements from 1 Oct and ภ.พ.30 October start at the same instant;
        // the trial balance "as of 30 Sep" ends one millisecond before it.
        expect(out.glOctoberStart).toBe('2026-09-30T17:00:00.000Z');
        expect(out.fsOctoberStart).toBe('2026-09-30T17:00:00.000Z');
        expect(out.vatOctober[0]).toBe('2026-09-30T17:00:00.000Z');
        expect(out.tbSeptemberEnd).toBe('2026-09-30T16:59:59.999Z');
        const entry = Date.parse('2026-09-30T20:00:00.000Z');
        expect(entry >= Date.parse(out.glOctoberStart) && entry > Date.parse(out.tbSeptemberEnd)).toBe(true);
    });

    it('both directions of the month edge agree between ภ.พ.30 and the ledger, including Dec→Jan', () => {
        // Re-review 2026-09-26: the last millisecond of a Bangkok month stays in
        // it; the first millisecond of the next one moves — in the VAT window
        // and in the ledger month the period guard asks about, on a UTC clock.
        const out = underUtc(`
            const guard = require('./services/journal-entry-period-guard');
            const pc = require('./services/period-close-service');
            const asked = [];
            pc.isPeriodClosed = async (args) => { asked.push(args.year + '-' + args.month); return false; };
            const vat = require('./services/vat-report-service');
            const vatMonth = (iso) => {
                const t = Date.parse(iso);
                for (const [y, m] of [[2026, 9], [2026, 10], [2026, 12], [2027, 1]]) {
                    const b = vat._internals.toMonthBoundaries(y, m);
                    if (t >= b.start.getTime() && t < b.end.getTime()) { return y + '-' + m; }
                }
                return 'none';
            };
            const edges = [
                '2026-09-30T16:59:59.999Z', // 23:59:59.999 on 30 Sep in Bangkok
                '2026-09-30T17:00:00.000Z', // 00:00 on 1 Oct in Bangkok
                '2026-12-31T16:59:59.999Z', // 23:59:59.999 on 31 Dec in Bangkok
                '2026-12-31T17:00:00.000Z', // 00:00 on 1 Jan 2570 in Bangkok
            ];
            const rows = [];
            for (const iso of edges) {
                asked.length = 0;
                await guard.checkPeriodOpen({ entryDate: new Date(iso) });
                rows.push([iso, vatMonth(iso), asked[0]]);
            }
            return rows;
        `);
        expect(out).toEqual([
            ['2026-09-30T16:59:59.999Z', '2026-9', '2026-9'],
            ['2026-09-30T17:00:00.000Z', '2026-10', '2026-10'],
            ['2026-12-31T16:59:59.999Z', '2026-12', '2026-12'],
            ['2026-12-31T17:00:00.000Z', '2027-1', '2027-1'],
        ]);
    });

    it('December ends, and January starts, at midnight in Bangkok', () => {
        const { _internals } = loadWithLedger();
        const dec = _internals.toMonthBoundaries(2026, 12);
        expect(dec.start.toISOString()).toBe('2026-11-30T17:00:00.000Z');
        expect(dec.end.toISOString()).toBe('2026-12-31T17:00:00.000Z');
    });
});
