/**
 * Tests for notification-fanout-service.js (Iter 23, 2026-05-16).
 *
 * External-services cleanup, Task 2 (2026-08-19): EMAIL/SMS dispatch legs
 * were retired from this file (operator decision, 2026-08-13,
 * shared/notification-view.js:16-19: in-app inbox is the only route).
 * `_dispatchEmail`/`_dispatchSms` are gone; a `channels` array that still
 * names 'EMAIL'/'SMS' (some callers still pass
 * ['IN_APP','EMAIL','SMS'] explicitly; others — audit-onsite-service.js,
 * audit-scheduling-service.js, renewal-reminder-cron.js — omit `channels`
 * and get the ALL_CHANNELS default, IN_APP-only) gets those entries back as
 * `{ ok:false, skipped:'CHANNEL_RETIRED' }` rather than dispatching or
 * throwing, so no caller needed to change its call site.
 *
 * Anchors:
 *   - send() dispatches IN_APP only; EMAIL/SMS channel names are accepted
 *     but retired (CHANNEL_RETIRED), never call the transports.
 *   - dedupe: same key within DEDUPE_WINDOW_MS returns first dispatch.
 *   - Template resolution: each registered NotifyType returns the
 *     expected subjectTH / bodyTHText / smsTH (unaffected by the dispatch
 *     change — email/sms template BODIES are still built, just never sent).
 *   - Thai date formatting yields a Buddhist-Era year (Gregorian + 543).
 *   - Channel selection honours per-user opt-outs via
 *     User.notificationSettings.channels[type] for the surviving IN_APP leg.
 *   - Phone normalisation: 0XXXXXXXXX → +66XXXXXXXXX (kept — see
 *     notification-fanout-service.js `_internals._normalizePhone`; T3 owns
 *     removing dead phone-normalisation code alongside the SMS stack).
 *   - PDPA-erasure confirm-URL carrier: PDPA_ERASURE_REQUESTED's confirm
 *     URL reaches the user via the in-app row's `message` field
 *     (template.bodyTHText already embeds it) — verified end to end.
 */

'use strict';

/**
 * The URL a mail client will actually open: pull the href out of the body and
 * undo the HTML escaping. Email bodies escape every interpolated value, so the
 * href in the source is not byte-identical to the link — see the PDPA case below.
 */
function hrefIn(html) {
    const m = /<a href="([^"]*)"/.exec(String(html || ''));
    if (!m) { return null; }
    return m[1]
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&');   // last, so "&amp;lt;" does not become "<"
}

function createPrismaMock(user) {
    return {
        user: {
            findUnique: jest.fn(async ({ where: { id } }) => (
                id === user?.id ? { ...user } : null
            )),
        },
    };
}

// emailMock / smsMock are plain jest mock objects passed through by callers
// (see below) and asserted directly — they are NOT wired to the real
// transport modules. services/notification/transports/{email,sms}-transport
// were deleted (external-services cleanup T3, 2026-08-19); production code
// stopped requiring them in T2, so there is nothing left to jest.doMock.
function loadService({ prisma, emailMock, smsMock, notificationServiceMock, redisMock }) {
    jest.doMock('../../services/prisma-database', () => ({ prisma }));
    jest.doMock('../../services/notification-service', () => notificationServiceMock);
    if (redisMock) {
        jest.doMock('../../services/redis-service', () => redisMock);
    }
    return require('../../services/notification-fanout-service');
}

/**
 * Build a shared Redis-like mock that simulates SET EX NX semantics with a
 * plain Map. Returning the same `store` from multiple instances lets us
 * simulate two pods sharing one Redis server (used for the multi-instance
 * + cross-process tests).
 */
function makeRedisMock({ store = new Map(), latency = 0 } = {}) {
    const wait = () => (latency > 0 ? new Promise((r) => setTimeout(r, latency)) : Promise.resolve());
    return {
        _store: store,
        isAvailable: jest.fn(() => true),
        get: jest.fn(async (key) => {
            await wait();
            return store.has(key) ? store.get(key) : null;
        }),
        set: jest.fn(async (key, value, _ttl) => {
            await wait();
            store.set(key, value);
            return true;
        }),
        setNX: jest.fn(async (key, value, _ttl) => {
            await wait();
            if (store.has(key)) {return false;}
            store.set(key, value);
            return true;
        }),
        del: jest.fn(async (key) => {
            store.delete(key);
            return true;
        }),
        invalidatePattern: jest.fn(async (pattern) => {
            // crude prefix glob — accept "prefix*"
            const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern;
            for (const k of Array.from(store.keys())) {
                if (k.startsWith(prefix)) {store.delete(k);}
            }
            return true;
        }),
    };
}

// email/sms transport mocks are still wired through loadService() for
// modules that jest.doMock() unconditionally requires a factory for, but
// after T2 the fanout source no longer requires either transport — these
// mocks simply go unused. Kept so loadService()'s signature (and every
// call site below) doesn't need touching for an unrelated cleanup.
function makeEmailMock() {
    return {
        send: jest.fn(async ({ to, subject, htmlBody }) => ({
            messageId: `stub-email-${to}`,
            sent: true,
            _called: { to, subject, htmlLen: (htmlBody || '').length },
        })),
        _internals: {},
    };
}

function makeSmsMock() {
    return {
        send: jest.fn(async ({ to, body }) => ({
            messageId: `stub-sms-${to}`,
            sent: true,
            _called: { to, body },
        })),
        _internals: {},
    };
}

function makeNotificationServiceMock() {
    let counter = 0;
    return {
        createNotification: jest.fn(async ({
            userId, type, title, message, data: _d, actionUrl,
        }) => {
            counter += 1;
            return {
                id: `notif-${counter}`, userId, type, title, message, actionUrl: actionUrl || null,
            };
        }),
    };
}

const USER_FULL = {
    id: 'user-1',
    email: 'farmer@example.com',
    phoneNumber: '0812345678',
    firstName: 'สมชาย',
    lastName: 'ใจดี',
    notificationSettings: null,
    organizationId: 'org-1',
    smsOptIn: true,
};

const USER_OPT_OUT_IN_APP = {
    ...USER_FULL,
    id: 'user-4',
    notificationSettings: {
        channels: {
            REFUND_INITIATED: { inApp: false },
        },
    },
};

describe('[Iter23→T2] notification-fanout-service — send()', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    // ── T2 removal pin — RED before the edit (old code dispatched EMAIL+SMS
    // for real; this asserted the OPPOSITE — result.email.ok===true etc.) ──
    it('dispatches IN_APP only; EMAIL/SMS channel names come back CHANNEL_RETIRED and never touch the transports', async () => {
        const prisma = createPrismaMock(USER_FULL);
        const emailMock = makeEmailMock();
        const smsMock = makeSmsMock();
        const notificationServiceMock = makeNotificationServiceMock();
        const svc = loadService({
            prisma, emailMock, smsMock, notificationServiceMock,
        });
        await svc._internals._clearDedupeForTests();

        const result = await svc.send({
            userId: USER_FULL.id,
            type: 'REFUND_INITIATED',
            payload: {
                invoiceId: 'inv-1',
                invoiceNumber: 'TAX-PRD-2026-000001',
                creditNoteNumber: 'CN-PRD-2026-000001',
                amount: 535,
                businessDays: 7,
            },
            // Exactly what every real caller (refund-service, payment-slip-service,
            // slip-sla-monitor, ...) passes today — must stay valid unedited.
            channels: ['IN_APP', 'EMAIL', 'SMS'],
        });

        expect(result.deduped).toBe(false);
        expect(result.inApp.ok).toBe(true);
        expect(result.email).toEqual({ ok: false, skipped: 'CHANNEL_RETIRED' });
        expect(result.sms).toEqual({ ok: false, skipped: 'CHANNEL_RETIRED' });

        // The transports are never invoked — the fanout severed its use of them.
        expect(emailMock.send).not.toHaveBeenCalled();
        expect(smsMock.send).not.toHaveBeenCalled();

        // In-app row created via existing notification-service, unaffected.
        expect(notificationServiceMock.createNotification).toHaveBeenCalledTimes(1);
    });

    it('dedupes a second call within the 60-min window (same userId+type+invoiceId) — IN_APP dispatched once', async () => {
        const prisma = createPrismaMock(USER_FULL);
        const emailMock = makeEmailMock();
        const smsMock = makeSmsMock();
        const notificationServiceMock = makeNotificationServiceMock();
        const svc = loadService({
            prisma, emailMock, smsMock, notificationServiceMock,
        });
        await svc._internals._clearDedupeForTests();

        const payload = {
            invoiceId: 'inv-1',
            invoiceNumber: 'TAX-PRD-2026-000001',
            creditNoteNumber: 'CN-PRD-2026-000001',
            amount: 535,
        };
        const first = await svc.send({
            userId: USER_FULL.id, type: 'REFUND_INITIATED', payload, channels: ['IN_APP', 'EMAIL', 'SMS'],
        });
        const second = await svc.send({
            userId: USER_FULL.id, type: 'REFUND_INITIATED', payload, channels: ['IN_APP', 'EMAIL', 'SMS'],
        });
        expect(first.deduped).toBe(false);
        expect(second.deduped).toBe(true);
        // Second call MUST NOT re-trigger the in-app dispatch
        expect(notificationServiceMock.createNotification).toHaveBeenCalledTimes(1);
        // Dedupe key is stable hash → equal across calls
        expect(first.dedupeKey).toBe(second.dedupeKey);
    });

    it('IN_APP opt-out is still respected; EMAIL/SMS are unconditionally CHANNEL_RETIRED regardless of opt-out', async () => {
        const prisma = createPrismaMock(USER_OPT_OUT_IN_APP);
        const emailMock = makeEmailMock();
        const smsMock = makeSmsMock();
        const notificationServiceMock = makeNotificationServiceMock();
        const svc = loadService({
            prisma, emailMock, smsMock, notificationServiceMock,
        });
        await svc._internals._clearDedupeForTests();

        const result = await svc.send({
            userId: USER_OPT_OUT_IN_APP.id,
            type: 'REFUND_INITIATED',
            payload: { invoiceId: 'inv-4', invoiceNumber: 'TAX-PRD-2026-000004', amount: 50 },
            channels: ['IN_APP', 'EMAIL', 'SMS'],
        });
        expect(result.inApp.skipped).toBe('OPT_OUT');
        expect(result.email.skipped).toBe('CHANNEL_RETIRED');
        expect(result.sms.skipped).toBe('CHANNEL_RETIRED');
        expect(notificationServiceMock.createNotification).not.toHaveBeenCalled();
    });

    it('respects `channels` filter (IN_APP only) — EMAIL/SMS stay NOT_REQUESTED, not CHANNEL_RETIRED', async () => {
        const prisma = createPrismaMock(USER_FULL);
        const emailMock = makeEmailMock();
        const smsMock = makeSmsMock();
        const notificationServiceMock = makeNotificationServiceMock();
        const svc = loadService({
            prisma, emailMock, smsMock, notificationServiceMock,
        });
        await svc._internals._clearDedupeForTests();

        const result = await svc.send({
            userId: USER_FULL.id,
            type: 'REFUND_INITIATED',
            payload: { invoiceId: 'inv-5', invoiceNumber: 'TAX-PRD-2026-000005', amount: 50 },
            channels: ['IN_APP'],
        });
        expect(result.inApp.ok).toBe(true);
        expect(result.email.skipped).toBe('NOT_REQUESTED');
        expect(result.sms.skipped).toBe('NOT_REQUESTED');
        expect(emailMock.send).not.toHaveBeenCalled();
        expect(smsMock.send).not.toHaveBeenCalled();
    });

    it('default channels (caller omits `channels`) dispatch IN_APP only — ALL_CHANNELS shrank to [IN_APP]', async () => {
        const prisma = createPrismaMock(USER_FULL);
        const emailMock = makeEmailMock();
        const smsMock = makeSmsMock();
        const notificationServiceMock = makeNotificationServiceMock();
        const svc = loadService({
            prisma, emailMock, smsMock, notificationServiceMock,
        });
        await svc._internals._clearDedupeForTests();

        expect(svc.ALL_CHANNELS).toEqual(['IN_APP']);

        const result = await svc.send({
            userId: USER_FULL.id,
            type: 'REFUND_INITIATED',
            payload: { invoiceId: 'inv-6', invoiceNumber: 'TAX-PRD-2026-000006', amount: 10 },
            // no `channels` — this is renewal-reminder-cron.js's call shape
        });
        expect(result.inApp.ok).toBe(true);
        expect(result.email.skipped).toBe('NOT_REQUESTED');
        expect(result.sms.skipped).toBe('NOT_REQUESTED');
        expect(emailMock.send).not.toHaveBeenCalled();
        expect(smsMock.send).not.toHaveBeenCalled();
    });

    it('returns empty result when user not found', async () => {
        const prisma = createPrismaMock(null);
        const emailMock = makeEmailMock();
        const smsMock = makeSmsMock();
        const notificationServiceMock = makeNotificationServiceMock();
        const svc = loadService({
            prisma, emailMock, smsMock, notificationServiceMock,
        });
        await svc._internals._clearDedupeForTests();

        const result = await svc.send({
            userId: 'user-nonexistent',
            type: 'REFUND_INITIATED',
            payload: { invoiceId: 'inv-x' },
        });
        expect(result.inApp.skipped).toBe('NO_USER');
        expect(result.email.skipped).toBe('NO_USER');
        expect(result.sms.skipped).toBe('NO_USER');
    });
});

// ── T2 — the PDPA-erasure confirm-URL carrier ──────────────────────────────
//
// services/pdpa-erasure-service.js:~312 sends the confirm-token URL through
// fanout.send({ type:'PDPA_ERASURE_REQUESTED', payload:{ requestId, token,
// expiresAt, webBaseUrl, actionUrl } }). The message-carries-the-URL half of
// this pin is a GREEN-stays pin (true before AND after the T2 edit —
// _dispatchInApp is not touched by this task): _dispatchInApp() passes
// `template.bodyTHText` as the notification row's `message`, and
// PDPA_ERASURE_REQUESTED's bodyTHText embeds the fully composed confirmUrl
// (`${webBaseUrl}/health/account/erasure?requestId=...&token=...`) as
// literal text. final-fix-1 (2026-08-19): pdpa-erasure-service.js now ALSO
// sets `payload.actionUrl` to the same composed URL, so the in-app row gets
// a real click-through target instead of only unclickable plain text —
// this half of the pin was RED against the pre-fix payload shape (no
// actionUrl key), see evidence/external-services-cleanup-final-fix-1/.
describe('[T2] notification-fanout-service — PDPA-erasure confirm-URL carrier', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    it('PDPA_ERASURE_REQUESTED: the in-app row message carries the full confirm URL end to end', async () => {
        const prisma = createPrismaMock(USER_FULL);
        const emailMock = makeEmailMock();
        const smsMock = makeSmsMock();
        const notificationServiceMock = makeNotificationServiceMock();
        const svc = loadService({
            prisma, emailMock, smsMock, notificationServiceMock,
        });
        await svc._internals._clearDedupeForTests();

        const expectedConfirmUrl = 'https://gacp-platform.th/health/account/erasure'
            + '?requestId=erasure-req-carrier-test&token=tok-carrier-test';

        // Exact payload shape pdpa-erasure-service.js builds post-fix
        // (actionUrl = the same composed confirm URL).
        await svc.send({
            userId: USER_FULL.id,
            type: 'PDPA_ERASURE_REQUESTED',
            payload: {
                requestId: 'erasure-req-carrier-test',
                token: 'tok-carrier-test',
                expiresAt: '2026-05-18T08:00:00Z',
                webBaseUrl: 'https://gacp-platform.th',
                actionUrl: expectedConfirmUrl,
            },
        });

        expect(notificationServiceMock.createNotification).toHaveBeenCalledTimes(1);
        const createArgs = notificationServiceMock.createNotification.mock.calls[0][0];

        // final-fix-1: pdpa-erasure-service.js now also sets payload.actionUrl
        // to the same composed confirm URL, so the in-app row's actionUrl
        // carries a click-through target — not just plain unclickable text.
        expect(createArgs.actionUrl).toBe(expectedConfirmUrl);
        expect(createArgs.message).toContain(expectedConfirmUrl);
    });
});

describe('[Iter23] notification-fanout-service — template resolution', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    function freshSvc() {
        return loadService({
            prisma: createPrismaMock(null),
            emailMock: makeEmailMock(),
            smsMock: makeSmsMock(),
            notificationServiceMock: makeNotificationServiceMock(),
        });
    }

    it('REFUND_INITIATED → Thai subject + body cites ม.86/10', () => {
        const svc = freshSvc();
        const t = svc.getTemplateForType('REFUND_INITIATED', {
            invoiceNumber: 'TAX-PRD-2026-000001',
            creditNoteNumber: 'CN-PRD-2026-000001',
            amount: 535,
            businessDays: 7,
        });
        expect(t.subjectTH).toMatch(/TAX-PRD-2026-000001/);
        expect(t.bodyTHHtml).toMatch(/86\/10/);
        expect(t.smsTH).toMatch(/535\.00/);
    });

    // External-services cleanup Task 4 (2026-08-19): CERTIFICATE_ISSUED,
    // REVISION_REQUESTED (this fanout module's email/SMS-shaped variant —
    // distinct from the in-app NotifyType.REVISION_REQUESTED template in
    // notification-service.js's domain-helpers.js, which stays) and
    // BREACH_NOTIFICATION_SUBJECT (below) were deleted: zero production
    // caller ever passed any of these three as `type` to send() or
    // getTemplateForType() (repo-wide grep, incl. dynamic-type call
    // sites — see task-4-report.md). Removal pins replace the old
    // resolution assertions.
    it('CERTIFICATE_ISSUED → deleted (zero-caller fanout template; certificate-issued notices are in-app only) → getTemplateForType returns null', () => {
        const svc = freshSvc();
        const t = svc.getTemplateForType('CERTIFICATE_ISSUED', {
            certNumber: 'GACP-2026-0001',
            certUrl: 'https://gacp.example.com/cert/abc',
        });
        expect(t).toBeNull();
    });

    it('REVISION_REQUESTED (fanout email/SMS variant) → deleted (zero-caller; in-app variant lives in notification-service.js) → getTemplateForType returns null', () => {
        const svc = freshSvc();
        const t = svc.getTemplateForType('REVISION_REQUESTED', {
            applicationNumber: 'GACP-2026-00045',
            reason: 'แผนที่ฟาร์มไม่ครบ',
        });
        expect(t).toBeNull();
    });

    it('AUDIT_SCHEDULED → formats date in Buddhist-Era', () => {
        const svc = freshSvc();
        const dt = new Date('2026-05-16T09:30:00+07:00');
        const t = svc.getTemplateForType('AUDIT_SCHEDULED', {
            applicationNumber: 'GACP-2026-00046',
            date: dt,
            auditorName: 'นายตรวจ ฟาร์มดี',
        });
        // Buddhist Era year for 2026 AD = 2569 — should appear in subject/body
        expect(t.bodyTHText).toMatch(/2569|พ\.ศ\.|พุทธศักราช/);
        expect(t.bodyTHText).toMatch(/นายตรวจ ฟาร์มดี/);
    });

    // ── Iter V3 / V3-A — onsite audit FAIL + NEEDS_REVIEW templates ───
    // Background (DI-3): audit-onsite-service.js dispatches
    // AUDIT_RESULT_CAR on FAIL and AUDIT_RESULT_NEEDS_REVIEW on
    // NEEDS_REVIEW, but the fanout template registry was missing both —
    // getTemplateForType() returned null and the dispatch degraded to
    // IN_APP-only with a generic English bell row. These 2 tests pin
    // the new templates so the regression cannot return silently.

    it('AUDIT_RESULT_CAR → Thai subject + body include application number, summary, and critical findings', () => {
        const svc = freshSvc();
        const t = svc.getTemplateForType('AUDIT_RESULT_CAR', {
            applicationNumber: 'GACP-2026-00050',
            decision: 'FAIL',
            summary: 'พบรายการตรวจที่ไม่ผ่านมาตรฐาน 3 รายการ',
            criticalFindings: [
                'แหล่งน้ำไม่มีผลตรวจคุณภาพ',
                'บันทึกการใช้สารกำจัดศัตรูพืชไม่ครบ',
            ],
        });
        // The 5-slot bundle is present
        expect(t).not.toBeNull();
        expect(t).toHaveProperty('subjectTH');
        expect(t).toHaveProperty('subjectEN');
        expect(t).toHaveProperty('bodyTHHtml');
        expect(t).toHaveProperty('bodyTHText');
        expect(t).toHaveProperty('smsTH');

        // Thai-first subject mentions the corrective-action keyword + application number
        expect(t.subjectTH).toMatch(/พบข้อแก้ไข|GACP/);
        expect(t.subjectTH).toContain('GACP-2026-00050');
        expect(t.subjectEN).toMatch(/corrective/i);

        // HTML body lists each critical finding verbatim and embeds the summary
        expect(t.bodyTHHtml).toContain('GACP-2026-00050');
        expect(t.bodyTHHtml).toContain('แหล่งน้ำไม่มีผลตรวจคุณภาพ');
        expect(t.bodyTHHtml).toContain('บันทึกการใช้สารกำจัดศัตรูพืชไม่ครบ');
        expect(t.bodyTHHtml).toContain('พบรายการตรวจที่ไม่ผ่านมาตรฐาน 3 รายการ');

        // Text fallback covers the same fields
        expect(t.bodyTHText).toContain('GACP-2026-00050');
        expect(t.bodyTHText).toContain('แหล่งน้ำไม่มีผลตรวจคุณภาพ');
        expect(t.bodyTHText).toContain('พบรายการตรวจที่ไม่ผ่านมาตรฐาน 3 รายการ');

        // SMS contains the application number and tells the applicant to take action
        expect(t.smsTH).toContain('GACP-2026-00050');
        expect(t.smsTH).toMatch(/แก้ไข|ดำเนินการ/);
        // SMS within a single 160-char Thai segment is the target (defensive guard)
        expect(t.smsTH.length).toBeLessThanOrEqual(160);
    });

    it('AUDIT_RESULT_CAR → renders cleanly with no summary + empty findings (defaults safe)', () => {
        const svc = freshSvc();
        const t = svc.getTemplateForType('AUDIT_RESULT_CAR', {
            applicationNumber: 'GACP-2026-00051',
        });
        expect(t).not.toBeNull();
        expect(t.subjectTH).toContain('GACP-2026-00051');
        expect(t.bodyTHHtml).toContain('GACP-2026-00051');
        // No accidental `undefined` / "null" / empty <ul></ul> leak
        expect(t.bodyTHHtml).not.toContain('undefined');
        expect(t.bodyTHHtml).not.toContain('<ul></ul>');
        expect(t.bodyTHText).not.toContain('undefined');
        expect(t.smsTH).not.toContain('undefined');
    });

    it('AUDIT_RESULT_NEEDS_REVIEW → Thai subject + body signal "under further review", no action required', () => {
        const svc = freshSvc();
        const t = svc.getTemplateForType('AUDIT_RESULT_NEEDS_REVIEW', {
            applicationNumber: 'GACP-2026-00060',
            decision: 'NEEDS_REVIEW',
            summary: 'ขอให้หัวหน้าผู้ตรวจพิจารณาเพิ่ม',
        });
        expect(t).not.toBeNull();
        expect(t).toHaveProperty('subjectTH');
        expect(t).toHaveProperty('subjectEN');
        expect(t).toHaveProperty('bodyTHHtml');
        expect(t).toHaveProperty('bodyTHText');
        expect(t).toHaveProperty('smsTH');

        // Subject conveys "under review" in both languages
        expect(t.subjectTH).toMatch(/พิจารณา/);
        expect(t.subjectTH).toContain('GACP-2026-00060');
        expect(t.subjectEN).toMatch(/under review/i);

        // Body sets the right expectation: no immediate action
        expect(t.bodyTHHtml).toContain('GACP-2026-00060');
        expect(t.bodyTHHtml).toMatch(/ยังไม่ต้องดำเนินการ|พิจารณาเพิ่มเติม/);
        expect(t.bodyTHHtml).toContain('ขอให้หัวหน้าผู้ตรวจพิจารณาเพิ่ม');
        expect(t.bodyTHText).toContain('GACP-2026-00060');
        expect(t.bodyTHText).toMatch(/พิจารณาเพิ่มเติม/);

        // SMS within a single 160-char Thai segment
        expect(t.smsTH).toContain('GACP-2026-00060');
        expect(t.smsTH.length).toBeLessThanOrEqual(160);
    });

    it('AUDIT_RESULT_NEEDS_REVIEW → renders cleanly without summary (defaults safe)', () => {
        const svc = freshSvc();
        const t = svc.getTemplateForType('AUDIT_RESULT_NEEDS_REVIEW', {
            applicationNumber: 'GACP-2026-00061',
        });
        expect(t).not.toBeNull();
        expect(t.bodyTHHtml).not.toContain('undefined');
        expect(t.bodyTHText).not.toContain('undefined');
        expect(t.smsTH).not.toContain('undefined');
    });

    it('unknown type → null (caller can fall back to IN_APP-only)', () => {
        const svc = freshSvc();
        const t = svc.getTemplateForType('UNREGISTERED_TYPE', {});
        expect(t).toBeNull();
    });

    // ── Iter R4 / R4-C — PDPA + breach notification templates ────────
    // Three NEW templates feed surfaces (pdpa-erasure-service +
    // breach-notification-service) that previously silently no-op'd
    // email/SMS because the templates were missing. Tests assert: (a)
    // per-template subject+body shape with the canonical legal-basis
    // citations; (b) URL placeholders use the payload's webBaseUrl (so
    // staging/prod links work); (c) NO-PII-leak invariant — passing
    // realistic PII payloads MUST NOT echo raw phone/email into the
    // rendered bodies. These templates still build EMAIL/SMS-shaped
    // bodies (bodyTHHtml/smsTH) after T2 — only the fanout's DISPATCH of
    // those bodies over the email/SMS transports was retired; bodyTHText
    // is also what the IN-APP row's `message` column stores (see the
    // PDPA-erasure confirm-URL carrier describe block above).

    it('PDPA_ERASURE_REQUESTED → cites ม.32, embeds confirm URL with requestId + token + webBaseUrl', () => {
        const svc = freshSvc();
        const t = svc.getTemplateForType('PDPA_ERASURE_REQUESTED', {
            requestId: 'erasure-req-abc-123',
            token: 'tok-deadbeef',
            webBaseUrl: 'https://gacp-platform.th',
            expiresAt: '2026-05-18T08:00:00Z',
        });
        expect(t).not.toBeNull();
        expect(t.subjectTH).toMatch(/ม\.32/);
        expect(t.subjectTH).toMatch(/ยืนยันคำขอลบบัญชี/);
        expect(t.subjectEN).toMatch(/erasure/i);

        // The confirmation URL is the single most-important artefact —
        // it MUST contain ALL three components (webBaseUrl + requestId
        // + token) so the link is a working deep-link.
        //
        // Asserted through the href a mail client actually resolves, not the raw
        // HTML bytes. Since 2026-09-08 every interpolated value is HTML-escaped
        // on its way into the body (operator ruling: escape at display), so the
        // source reads `…?requestId=…&amp;token=…`. That is correct HTML for a
        // URL in an attribute and every client decodes it back to `&` before
        // navigating — but a byte-comparison against the undecoded string would
        // fail while the link works, and would have been "fixed" by removing the
        // escaping. Decode first, then compare.
        expect(hrefIn(t.bodyTHHtml)).toBe(
            'https://gacp-platform.th/health/account/erasure?requestId=erasure-req-abc-123&token=tok-deadbeef',
        );
        expect(t.bodyTHHtml).toContain('erasure-req-abc-123');
        expect(t.bodyTHHtml).toContain('tok-deadbeef');

        // 24-hour window disclosure (matches CONFIRM_WINDOW_MS semantics)
        expect(t.bodyTHHtml).toMatch(/24 ชั่วโมง/);

        // BE-formatted expiry timestamp
        expect(t.bodyTHHtml).toMatch(/2569|พ\.ศ\.|พุทธศักราช/);

        // ม.87/3 ป.รัษฎากร preservation disclosure
        expect(t.bodyTHHtml).toMatch(/ม\.87\/3/);

        expect(t.bodyTHText).toContain('erasure-req-abc-123');
        expect(t.bodyTHText).toContain('tok-deadbeef');
        // bodyTHText is what the in-app row's `message` stores — the confirm
        // URL MUST be present here too (see the carrier describe block).
        expect(t.bodyTHText).toContain(
            'https://gacp-platform.th/health/account/erasure?requestId=erasure-req-abc-123&token=tok-deadbeef',
        );
        expect(t.smsTH).toMatch(/ม\.32/);
        expect(t.smsTH).toContain('erasure-req-abc-123');
    });

    it('PDPA_ERASURE_REQUESTED → missing webBaseUrl falls back to [WEB_BASE_URL_NOT_CONFIGURED] sentinel (NOT a relative URL)', () => {
        const svc = freshSvc();
        const t = svc.getTemplateForType('PDPA_ERASURE_REQUESTED', {
            requestId: 'req-1',
            token: 'tok-1',
        });
        // The sentinel literal makes the misconfiguration visible to ops
        // rather than emitting a relative URL that breaks in email clients.
        expect(hrefIn(t.bodyTHHtml)).toBe('[WEB_BASE_URL_NOT_CONFIGURED]/health/account/erasure?requestId=req-1&token=tok-1');
    });

    it('PDPA_ERASURE_EXECUTED → enumerates preserved tables citing ม.32 + ม.87/3 ป.รัษฎากร', () => {
        const svc = freshSvc();
        const t = svc.getTemplateForType('PDPA_ERASURE_EXECUTED', {
            executedAt: '2026-05-17T10:00:00Z',
        });
        expect(t).not.toBeNull();
        expect(t.subjectTH).toMatch(/คำขอลบบัญชี/);
        expect(t.subjectTH).toMatch(/เสร็จสมบูรณ์/);

        // Legal-basis citations — both ม.32 (the right being exercised)
        // and ม.87/3 ป.รัษฎากร (why some records persist) must appear.
        expect(t.bodyTHHtml).toMatch(/ม\.32/);
        expect(t.bodyTHHtml).toMatch(/ม\.87\/3/);
        expect(t.bodyTHHtml).toMatch(/ประมวลรัษฎากร/);

        // Preservation matrix — the 3 preserved tables explicitly named
        // in the Acceptance criteria + the rest of the canonical list.
        expect(t.bodyTHHtml).toContain('Invoice');
        expect(t.bodyTHHtml).toContain('JournalEntry');
        expect(t.bodyTHHtml).toContain('AuditLog');
        expect(t.bodyTHHtml).toContain('Certificate');

        // Anonymisation sentinel reference
        expect(t.bodyTHHtml).toContain('PDPA_ERASED');

        // BE date format
        expect(t.bodyTHHtml).toMatch(/2569|พ\.ศ\.|พุทธศักราช/);

        // Text + SMS fall-backs
        expect(t.bodyTHText).toMatch(/ม\.32/);
        expect(t.bodyTHText).toMatch(/ม\.87\/3/);
        expect(t.smsTH).toMatch(/ม\.32/);
    });

    // BREACH_NOTIFICATION_SUBJECT deleted (External-services cleanup Task 4,
    // 2026-08-19) — zero production caller ever passed `type:
    // 'BREACH_NOTIFICATION_SUBJECT'` to send() or getTemplateForType();
    // breach-notification-service.js does not exist in this codebase
    // (repo-wide grep, see task-4-report.md). Removal pin:
    it('BREACH_NOTIFICATION_SUBJECT → deleted (zero-caller fanout template) → getTemplateForType returns null', () => {
        const svc = freshSvc();
        const t = svc.getTemplateForType('BREACH_NOTIFICATION_SUBJECT', {
            breachId: 'breach-xyz-789',
            breachDateTH: '17 พฤษภาคม พ.ศ. 2569',
            affectedDataCategoriesTH: 'ชื่อ-นามสกุล, ที่อยู่อีเมล',
            remedialActionsTH: 'รีเซ็ตรหัสผ่านทั้งหมด + บังคับเปิด 2FA',
            contactInformationTH: 'dpo@gacpth.com',
        });
        expect(t).toBeNull();
    });

    it('NO PII leak invariant — none of the 2 surviving PDPA-erasure templates echo raw phone (>=10 digits) or @gmail.com when given a realistic PII payload', () => {
        const svc = freshSvc();
        // Realistic PII payload — even though the templates are designed
        // to NOT consume these fields, we explicitly assert that passing
        // them through produces ZERO leakage. This guards against a
        // future template-author accidentally adding `${p.subjectEmail}`
        // or similar.
        const pii = {
            // PDPA_ERASURE_REQUESTED required fields:
            requestId: 'req-leak-test',
            token: 'tok-leak-test',
            webBaseUrl: 'https://gacp-platform.th',
            expiresAt: '2026-05-18T08:00:00Z',
            // PDPA_ERASURE_EXECUTED required fields:
            executedAt: '2026-05-17T10:00:00Z',
            // INTENTIONAL PII pollution — must NEVER appear in output:
            subjectFullName: 'สมชาย ใจดี',
            subjectEmail: 'somchai@gmail.com',
            subjectPhone: '0812345678',
            subjectIdCard: '1234567890123',
            subjectHealthId: '9876543210987',
        };

        const types = [
            'PDPA_ERASURE_REQUESTED',
            'PDPA_ERASURE_EXECUTED',
        ];

        for (const type of types) {
            const t = svc.getTemplateForType(type, pii);
            expect(t).not.toBeNull();

            // No raw phone number (10+ consecutive digits)
            expect(t.bodyTHHtml).not.toMatch(/\d{10,13}/);
            expect(t.bodyTHText).not.toMatch(/\d{10,13}/);
            expect(t.smsTH).not.toMatch(/\d{10,13}/);

            // No raw @gmail.com (or any consumer email TLD pattern in body)
            expect(t.bodyTHHtml).not.toContain('@gmail.com');
            expect(t.bodyTHHtml).not.toContain('somchai@gmail.com');
            expect(t.bodyTHText).not.toContain('@gmail.com');
            expect(t.smsTH).not.toContain('@gmail.com');

            // The polluted name MUST NOT appear (templates don't consume it)
            expect(t.bodyTHHtml).not.toContain('สมชาย ใจดี');
            expect(t.bodyTHText).not.toContain('สมชาย ใจดี');

            // Polluted ID-card / Thai-ID MUST NOT appear
            expect(t.bodyTHHtml).not.toContain('1234567890123');
            expect(t.bodyTHHtml).not.toContain('9876543210987');
        }
    });
});

describe('[Iter23] notification-fanout-service — internals', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    function freshSvc() {
        return loadService({
            prisma: createPrismaMock(null),
            emailMock: makeEmailMock(),
            smsMock: makeSmsMock(),
            notificationServiceMock: makeNotificationServiceMock(),
        });
    }

    it('_normalizePhone: 0XXXXXXXXX → +66XXXXXXXXX', () => {
        const svc = freshSvc();
        expect(svc._internals._normalizePhone('0812345678')).toBe('+66812345678');
        expect(svc._internals._normalizePhone('+66812345678')).toBe('+66812345678');
        expect(svc._internals._normalizePhone('66812345678')).toBe('+66812345678');
        expect(svc._internals._normalizePhone(null)).toBeNull();
        expect(svc._internals._normalizePhone('garbage')).toBeNull();
    });

    it('_makeDedupeKey: same key for identical inputs, different for different', () => {
        const svc = freshSvc();
        const k1 = svc._internals._makeDedupeKey({
            userId: 'u1', type: 'REFUND_INITIATED', payload: { invoiceId: 'i1' },
        });
        const k2 = svc._internals._makeDedupeKey({
            userId: 'u1', type: 'REFUND_INITIATED', payload: { invoiceId: 'i1' },
        });
        const k3 = svc._internals._makeDedupeKey({
            userId: 'u1', type: 'REFUND_INITIATED', payload: { invoiceId: 'DIFFERENT' },
        });
        expect(k1).toBe(k2);
        expect(k1).not.toBe(k3);
    });

    it('formatBE: produces a Buddhist-Era string for 2026 AD', () => {
        const svc = freshSvc();
        const out = svc._internals.formatBE(new Date('2026-05-16T00:00:00Z'));
        // Should include 2569 (BE) and Thai month text — formatter is locale-dependent
        // so we accept either explicit 2569 or the Thai era marker.
        expect(out.length).toBeGreaterThan(0);
        expect(out).toMatch(/2569|พุทธศักราช|พ\.ศ\./);
    });

    it('formatTHB: emits 2-decimal Thai locale string', () => {
        const svc = freshSvc();
        const out = svc._internals.formatTHB(1234.5);
        expect(out).toMatch(/1,234\.50/);
    });
});

// ── R5-A — Redis-backed dedupe ─────────────────────────────────────────────
//
// Replaces the in-process Map dedupe with an atomic Redis SET EX NX so the
// dedupe slot holds across Node processes / pods. Verifies:
//   1. Single-process happy path still dedupes (regression guard for the
//      Iter 23 behaviour, now backed by Redis).
//   2. Two concurrent send() calls with identical (userId, type, payload)
//      collapse via the NX claim → exactly ONE dispatch.
//   3. Cross-process: a second module load (jest.resetModules) with the
//      SAME shared Redis store sees the first call's slot and returns
//      deduped: true without re-dispatching.
//   4. Redis-unavailable graceful degradation: isAvailable() = false falls
//      back to the in-process Map shim, logs a single warn.
//
// T2 update: these tests previously asserted email/sms transport call
// counts as proof that dedupe suppressed re-dispatch; EMAIL/SMS are no
// longer dispatched at all (CHANNEL_RETIRED unconditionally), so the
// "single dispatch" proof now checks notificationService.createNotification
// (the IN_APP leg — the only channel that can still be double-fired).

describe('[R5-A] notification-fanout-service — Redis-backed dedupe', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    it('dedupes a second send() within window using Redis NX (single process)', async () => {
        const redisMock = makeRedisMock();
        const emailMock = makeEmailMock();
        const smsMock = makeSmsMock();
        const notificationServiceMock = makeNotificationServiceMock();
        const svc = loadService({
            prisma: createPrismaMock(USER_FULL),
            emailMock, smsMock, notificationServiceMock, redisMock,
        });
        await svc._internals._clearDedupeForTests();

        const args = {
            userId: USER_FULL.id,
            type: 'REFUND_INITIATED',
            payload: {
                invoiceId: 'inv-redis-1',
                invoiceNumber: 'TAX-PRD-2026-R5A-001',
                creditNoteNumber: 'CN-PRD-2026-R5A-001',
                amount: 1000,
            },
            channels: ['IN_APP', 'EMAIL', 'SMS'],
        };
        const first = await svc.send(args);
        const second = await svc.send(args);

        expect(first.deduped).toBe(false);
        expect(second.deduped).toBe(true);
        expect(second.dedupeKey).toBe(first.dedupeKey);
        // IN_APP dispatch MUST happen exactly once across both calls
        expect(notificationServiceMock.createNotification).toHaveBeenCalledTimes(1);
        // EMAIL/SMS never dispatch — retired regardless of dedupe.
        expect(emailMock.send).not.toHaveBeenCalled();
        expect(smsMock.send).not.toHaveBeenCalled();

        // setNX was called with the canonical 'EX', ttl, 'NX' shape via the
        // helper (we assert on the mock that setNX was invoked at least once).
        expect(redisMock.setNX).toHaveBeenCalled();
        // First-write key uses the notify:dedupe: namespace
        const setNxArgs = redisMock.setNX.mock.calls[0];
        expect(setNxArgs[0]).toMatch(/^notify:dedupe:[a-f0-9]{64}$/);
        // TTL passed through
        expect(setNxArgs[2]).toBe(svc.DEDUPE_TTL_SECONDS);
    });

    it('two concurrent send() calls collapse via Redis NX — exactly ONE IN_APP dispatch', async () => {
        // Add a tiny latency so the two Promise.all branches both reach
        // _getDedupeResult (MISS) and both proceed to _claimDedupeSlot; the
        // setNX semantics guarantee only ONE wins, the loser re-reads.
        const redisMock = makeRedisMock({ latency: 5 });
        const emailMock = makeEmailMock();
        const smsMock = makeSmsMock();
        const notificationServiceMock = makeNotificationServiceMock();
        const svc = loadService({
            prisma: createPrismaMock(USER_FULL),
            emailMock, smsMock, notificationServiceMock, redisMock,
        });
        await svc._internals._clearDedupeForTests();

        const args = {
            userId: USER_FULL.id,
            type: 'REFUND_INITIATED',
            payload: {
                invoiceId: 'inv-concurrent',
                invoiceNumber: 'TAX-PRD-2026-R5A-002',
                creditNoteNumber: 'CN-PRD-2026-R5A-002',
                amount: 2500,
            },
            channels: ['IN_APP', 'EMAIL', 'SMS'],
        };

        const [a, b] = await Promise.all([svc.send(args), svc.send(args)]);

        // Both callers see the same dedupeKey
        expect(a.dedupeKey).toBe(b.dedupeKey);
        // Exactly one of the two reports deduped:true (the loser of the NX race)
        const dedupedFlags = [a.deduped, b.deduped].sort();
        expect(dedupedFlags).toEqual([false, true]);

        // IN_APP fired exactly ONCE despite two concurrent send() calls
        expect(notificationServiceMock.createNotification).toHaveBeenCalledTimes(1);
    });

    it('cross-process: dedupe survives a fresh module load with the SAME Redis store', async () => {
        // Shared store simulates "two pods talking to one Redis server".
        const sharedStore = new Map();

        // First "pod" — load + dispatch + verify Redis got the slot.
        const redisMockA = makeRedisMock({ store: sharedStore });
        const emailMockA = makeEmailMock();
        const smsMockA = makeSmsMock();
        const notifMockA = makeNotificationServiceMock();
        let svc = loadService({
            prisma: createPrismaMock(USER_FULL),
            emailMock: emailMockA, smsMock: smsMockA,
            notificationServiceMock: notifMockA, redisMock: redisMockA,
        });
        await svc._internals._clearDedupeForTests();

        const args = {
            userId: USER_FULL.id,
            type: 'REFUND_INITIATED',
            payload: {
                invoiceId: 'inv-cross-proc',
                invoiceNumber: 'TAX-PRD-2026-R5A-003',
                creditNoteNumber: 'CN-PRD-2026-R5A-003',
                amount: 5000,
            },
            channels: ['IN_APP', 'EMAIL', 'SMS'],
        };
        const first = await svc.send(args);
        expect(first.deduped).toBe(false);
        expect(notifMockA.createNotification).toHaveBeenCalledTimes(1);
        // Redis store now contains the dedupe slot
        expect(sharedStore.size).toBe(1);
        const cachedKey = Array.from(sharedStore.keys())[0];
        expect(cachedKey).toMatch(/^notify:dedupe:[a-f0-9]{64}$/);

        // Simulate a fresh process by tearing down the module cache.
        jest.resetModules();

        // Second "pod" — same shared store, fresh mocks for transports.
        const redisMockB = makeRedisMock({ store: sharedStore });
        const emailMockB = makeEmailMock();
        const smsMockB = makeSmsMock();
        const notifMockB = makeNotificationServiceMock();
        svc = loadService({
            prisma: createPrismaMock(USER_FULL),
            emailMock: emailMockB, smsMock: smsMockB,
            notificationServiceMock: notifMockB, redisMock: redisMockB,
        });
        // NOTE: we DO NOT call _clearDedupeForTests here — that would wipe
        // the shared Redis store and defeat the purpose of the test.

        const second = await svc.send(args);
        expect(second.deduped).toBe(true);
        // Critically: no dispatch call on the second "pod"
        expect(notifMockB.createNotification).not.toHaveBeenCalled();
        expect(emailMockB.send).not.toHaveBeenCalled();
        expect(smsMockB.send).not.toHaveBeenCalled();
        // The dedupe result round-trips through JSON cleanly
        expect(second.dedupeKey).toBe(first.dedupeKey);
        const roundTrip = JSON.parse(JSON.stringify(first));
        expect({ ...second, deduped: false }).toEqual({ ...roundTrip, deduped: false });
    });

    it('falls back to per-process Map when Redis is unavailable (logs warn once)', async () => {
        const unavailableRedis = {
            isAvailable: jest.fn(() => false),
            get: jest.fn(),
            set: jest.fn(),
            setNX: jest.fn(),
            del: jest.fn(),
            invalidatePattern: jest.fn(),
        };
        const emailMock = makeEmailMock();
        const smsMock = makeSmsMock();
        const notifMock = makeNotificationServiceMock();
        const svc = loadService({
            prisma: createPrismaMock(USER_FULL),
            emailMock, smsMock, notificationServiceMock: notifMock,
            redisMock: unavailableRedis,
        });
        await svc._internals._clearDedupeForTests();

        const args = {
            userId: USER_FULL.id,
            type: 'REFUND_INITIATED',
            payload: {
                invoiceId: 'inv-fallback',
                invoiceNumber: 'TAX-PRD-2026-R5A-004',
                creditNoteNumber: 'CN-PRD-2026-R5A-004',
                amount: 750,
            },
            channels: ['IN_APP', 'EMAIL', 'SMS'],
        };
        const first = await svc.send(args);
        const second = await svc.send(args);

        expect(first.deduped).toBe(false);
        expect(second.deduped).toBe(true);
        // Redis primitives MUST NOT be called when isAvailable() = false
        expect(unavailableRedis.setNX).not.toHaveBeenCalled();
        expect(unavailableRedis.get).not.toHaveBeenCalled();
        // Single dispatch despite two send() calls
        expect(notifMock.createNotification).toHaveBeenCalledTimes(1);
    });
});

// ── API-4 — transient-channel-failure retry within the dedupe window ─────────
//
// Pre-fix: send() wrote the dispatch result to the dedupe slot UNCONDITIONALLY,
// including a channel that failed transiently. Every retry within the 60-min
// window then read the cached failure and returned it WITHOUT re-dispatching
// — so a flaky channel silently dropped the notification for a full hour. The
// fix re-attempts ONLY the channels whose cached outcome is a transient
// failure ({ ok:false, error }); delivered and permanently-skipped channels
// are never re-sent (no duplicate delivery).
//
// T2 update: the mechanism is channel-agnostic (_isOutcomeRetriable /
// _unsettledRequestedChannels operate on whatever keys _CHANNEL_RESULT_KEY
// maps — now only IN_APP). These 2 tests were rewritten from
// "EMAIL transient failure/retry" to "IN_APP transient failure/retry" so the
// generic partial-retry behaviour stays covered with the surviving channel.

describe('[API-4] notification-fanout-service — transient failure retry within dedupe window', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    it('_isOutcomeRetriable: only transient failures (ok:false + no skipped) are retriable', () => {
        const svc = loadService({
            prisma: createPrismaMock(null),
            emailMock: makeEmailMock(),
            smsMock: makeSmsMock(),
            notificationServiceMock: makeNotificationServiceMock(),
        });
        const r = svc._internals._isOutcomeRetriable;
        expect(r({ ok: true, messageId: 'x' })).toBe(false);            // delivered
        expect(r({ ok: false, skipped: 'NO_EMAIL' })).toBe(false);      // permanent skip
        expect(r({ ok: false, skipped: 'CHANNEL_RETIRED' })).toBe(false); // retired channel
        expect(r({ ok: false, skipped: 'OPT_OUT' })).toBe(false);       // opt-out
        expect(r({ ok: false, skipped: 'NOT_REQUESTED' })).toBe(false); // not requested
        expect(r({ ok: false, error: 'DB write timeout' })).toBe(true); // transient ✓
        expect(r(undefined)).toBe(false);
        expect(r(null)).toBe(false);
    });

    it('re-attempts ONLY the failed IN_APP dispatch on the next send; a third send fully dedupes', async () => {
        const prisma = createPrismaMock(USER_FULL);
        // notification-service throws on the first attempt, succeeds on the retry.
        let inAppCalls = 0;
        const notificationServiceMock = {
            createNotification: jest.fn(async ({ userId, type }) => {
                inAppCalls += 1;
                if (inAppCalls === 1) { throw new Error('DB write timeout'); }
                return { id: `notif-retry-${inAppCalls}`, userId, type };
            }),
        };
        const emailMock = makeEmailMock();
        const smsMock = makeSmsMock();
        const redisMock = makeRedisMock();
        const svc = loadService({
            prisma, emailMock, smsMock, notificationServiceMock, redisMock,
        });
        await svc._internals._clearDedupeForTests();

        const args = {
            userId: USER_FULL.id,
            type: 'REFUND_INITIATED',
            payload: { invoiceId: 'inv-retry-1', invoiceNumber: 'TAX-PRD-2026-RETRY-001', amount: 535 },
            channels: ['IN_APP', 'EMAIL', 'SMS'],
        };

        const first = await svc.send(args);
        expect(first.deduped).toBe(false);
        expect(first.inApp.ok).toBe(false);           // transient failure cached
        expect(first.inApp.error).toMatch(/timeout/i);
        expect(first.email.skipped).toBe('CHANNEL_RETIRED');

        // Second send within the window retries IN_APP only — and it now succeeds.
        const second = await svc.send(args);
        expect(second.deduped).toBe(false);           // it actually dispatched (retry)
        expect(second.inApp.ok).toBe(true);
        expect(second.email.skipped).toBe('CHANNEL_RETIRED'); // preserved from first attempt

        // IN_APP dispatched twice (fail + retry).
        expect(notificationServiceMock.createNotification).toHaveBeenCalledTimes(2);
        expect(emailMock.send).not.toHaveBeenCalled();
        expect(smsMock.send).not.toHaveBeenCalled();

        // A THIRD send now fully dedupes — everything is settled, no dispatch.
        const third = await svc.send(args);
        expect(third.deduped).toBe(true);
        expect(notificationServiceMock.createNotification).toHaveBeenCalledTimes(2);
    });

    it('permanent skip (IN_APP OPT_OUT) is NOT retried — second send fully dedupes', async () => {
        const prisma = createPrismaMock(USER_OPT_OUT_IN_APP);
        const emailMock = makeEmailMock();
        const smsMock = makeSmsMock();
        const notificationServiceMock = makeNotificationServiceMock();
        const redisMock = makeRedisMock();
        const svc = loadService({
            prisma, emailMock, smsMock, notificationServiceMock, redisMock,
        });
        await svc._internals._clearDedupeForTests();

        const args = {
            userId: USER_OPT_OUT_IN_APP.id,
            type: 'REFUND_INITIATED',
            payload: { invoiceId: 'inv-optout-retry', invoiceNumber: 'TAX-PRD-2026-RETRY-002', amount: 100 },
            channels: ['IN_APP', 'EMAIL', 'SMS'],
        };
        const first = await svc.send(args);
        expect(first.inApp.skipped).toBe('OPT_OUT');

        const second = await svc.send(args);
        // OPT_OUT is permanent → second call fully dedupes, nothing re-dispatched.
        expect(second.deduped).toBe(true);
        expect(notificationServiceMock.createNotification).not.toHaveBeenCalled();
    });
});
