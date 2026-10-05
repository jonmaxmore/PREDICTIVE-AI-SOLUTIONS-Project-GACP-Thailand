/**
 * Task 11 — the file-and-hand-over rail, extracted so there is ONE of it.
 *
 * Step 6 needs exactly what `/health/applications/preview` already does when the
 * applicant presses the button: submit or resubmit, read a gate refusal in Thai, and
 * hand over to the page that holds the quotation tick and the pay door. The plan says
 * "the wiring moves, the behavior must not" — so it moves into this module and BOTH
 * surfaces call it, rather than the new page carrying a second copy that drifts the
 * first time the payment rail changes.
 *
 * This module deliberately decides NOTHING about money. Under the checkout rail it
 * mints nothing at all (F-G4-64 put the quotation gate in front of /payments/create,
 * and the checkout order is minted by /health/payments after the tick). The legacy
 * branch is preserved byte-for-byte in behaviour because turning it off is an operator
 * decision, not a refactor's.
 */
import { describe, expect, it, jest, beforeEach } from '@jest/globals';

const mockPost = jest.fn<(url: string, body?: unknown) => Promise<Record<string, unknown>>>();
jest.mock('@/lib/api/api-client', () => ({ apiClient: { post: (u: string, b?: unknown) => mockPost(u, b) } }));

const mockCheckoutEnabled = jest.fn<() => boolean>(() => true);
jest.mock('@/lib/config/checkout-mode', () => ({ isCheckoutUiEnabled: () => mockCheckoutEnabled() }));

type GateResult = 'SAVED' | 'NOT_SAVED' | 'DETACHED';
const mockEnsureSaved = jest.fn<(applicationId: string) => Promise<GateResult>>(async () => 'SAVED');
const mockForgetFiled = jest.fn<(applicationId: string) => Promise<void>>(async () => undefined);
const mockSaveNow = jest.fn<(applicationId: string) => Promise<GateResult>>(async () => 'SAVED');
let mockClock: { saveSession: string; lastAppliedSeq: number } | null = null;
jest.mock('@/app/health/applications/new/_steps/hooks/use-auto-save', () => ({
    saveCurrentDraftNow: (applicationId: string) => mockSaveNow(applicationId),
    submitClockFor: () => mockClock,
    ensureLatestDraftSaved: (applicationId: string) => mockEnsureSaved(applicationId),
    forgetFiledApplication: (applicationId: string) => mockForgetFiled(applicationId),
    DETACHED_NOTICE_TH: {
        APPLICATION_NOT_EDITABLE: 'คำขอนี้ยื่นไปแล้ว ระบบจะบันทึกคำตอบของคุณเป็นร่างคำขอ',
        APPLICATION_NOT_FOUND: 'ไม่พบคำขอเดิมในบัญชีของคุณ ระบบจะบันทึกคำตอบของคุณเป็นร่างคำขอ',
    },
}));

import { submitAndHandOver, paymentsHrefFor, DRAFT_NOT_SAVED_TH, DRAFT_DETACHED_TH, DRAFT_NOT_LATEST_TH } from '../submit-and-hand-over';

beforeEach(() => {
    jest.clearAllMocks();
    mockCheckoutEnabled.mockReturnValue(true);
    mockPost.mockResolvedValue({ success: true });
    mockEnsureSaved.mockResolvedValue('SAVED');
    mockSaveNow.mockResolvedValue('SAVED');
    mockClock = null;
});

/**
 * Round 3: submit posts only {applicationId}, so the server files what it holds. An edit
 * the wizard has not saved yet would be filed stale — the latest edit is saved first, or
 * the filing does not go.
 */
describe('the latest edit is on the server before anything is filed (round 3)', () => {
    it('asks for the latest edit to be saved BEFORE posting the submit', async () => {
        const order: string[] = [];
        mockEnsureSaved.mockImplementation(async () => { order.push('ensure'); return 'SAVED'; });
        mockPost.mockImplementation(async (url: string) => { order.push(url); return { success: true }; });
        await submitAndHandOver({ applicationId: 'app-1', isInitialSubmit: true, isResubmit: false });
        expect(mockEnsureSaved).toHaveBeenCalledWith('app-1');
        expect(order).toEqual(['ensure', '/applications/submit']);
    });

    it.each([[true, false], [false, true]])('blocks the filing with a Thai message when the edit cannot be saved (initial=%s, resubmit=%s)', async (isInitialSubmit, isResubmit) => {
        mockEnsureSaved.mockResolvedValue('NOT_SAVED');
        const out = await submitAndHandOver({ applicationId: 'app-1', isInitialSubmit, isResubmit });
        expect(out).toEqual({ kind: 'REFUSED', message: DRAFT_NOT_SAVED_TH });
        expect(DRAFT_NOT_SAVED_TH).toBe('ยังบันทึกการแก้ไขล่าสุดไม่สำเร็จ กรุณาลองอีกครั้ง');
        expect(mockPost).not.toHaveBeenCalled();
    });
});

/**
 * Round 5 (b): the gate found the application's id refused by the server (already filed,
 * or not this user's). Nothing is filed, and the applicant is told that the answers will
 * be kept as a draft instead of "try again", which would fail the same way forever.
 */
describe('round 5: the gate dropped a refused id', () => {
    it('blocks the filing and says the answers are kept as a draft', async () => {
        mockEnsureSaved.mockResolvedValue('DETACHED');
        const out = await submitAndHandOver({ applicationId: 'app-1', isInitialSubmit: true, isResubmit: false });
        expect(out).toEqual({ kind: 'REFUSED', message: DRAFT_DETACHED_TH });
        expect(DRAFT_DETACHED_TH).toBe('คำขอนี้แก้ไขต่อไม่ได้แล้ว ระบบจะบันทึกคำตอบของคุณเป็นร่างคำขอ');
        expect(mockPost).not.toHaveBeenCalled();
        expect(mockForgetFiled).not.toHaveBeenCalled();
    });
});

/**
 * Round 5 (a): once the server has accepted the filing, the wizard lets go of it, so
 * "ยื่นคำขอใหม่" starts empty. A refused filing keeps everything.
 */
describe('round 5: an accepted filing lets go of the wizard', () => {
    it.each([
        ['a first filing', true, false],
        ['a resubmit', false, true],
    ])('%s accepted by the server: the wizard forgets it', async (_label, isInitialSubmit, isResubmit) => {
        await submitAndHandOver({ applicationId: 'app-1', isInitialSubmit, isResubmit });
        expect(mockForgetFiled).toHaveBeenCalledWith('app-1');
    });

    it('a quotation-gate refusal after filing (legacy rail) still forgets it: it IS filed', async () => {
        mockCheckoutEnabled.mockReturnValue(false);
        mockPost
            .mockResolvedValueOnce({ success: true })
            .mockResolvedValueOnce({ success: false, code: 'QUOTATION_NOT_ACCEPTED' });
        const out = await submitAndHandOver({ applicationId: 'app-1', isInitialSubmit: true, isResubmit: false });
        expect(out.kind).toBe('REFUSED_BUT_FILED');
        expect(mockForgetFiled).toHaveBeenCalledWith('app-1');
    });

    it('a refused filing keeps the wizard', async () => {
        mockPost.mockResolvedValueOnce({ success: false, code: 'APPLICATION_INCOMPLETE' });
        await submitAndHandOver({ applicationId: 'app-1', isInitialSubmit: true, isResubmit: false });
        expect(mockForgetFiled).not.toHaveBeenCalled();
    });

    it('nothing submitted (already past filing): nothing to forget here', async () => {
        await submitAndHandOver({ applicationId: 'app-1', isInitialSubmit: false, isResubmit: false });
        expect(mockForgetFiled).not.toHaveBeenCalled();
    });
});

describe('where the applicant is sent', () => {
    it('names the payments page once, so the refusal and the success agree', () => {
        expect(paymentsHrefFor('app-1')).toBe('/health/payments?app=app-1&phase=1');
    });
});

describe('a first filing under the checkout rail', () => {
    it('submits, mints nothing, and hands over to the payments page', async () => {
        const out = await submitAndHandOver({ applicationId: 'app-1', isInitialSubmit: true, isResubmit: false });
        expect(mockPost).toHaveBeenCalledTimes(1);
        expect(mockPost).toHaveBeenCalledWith('/applications/submit', expect.objectContaining({ applicationId: 'app-1' }));
        expect(out).toEqual({ kind: 'FILED', href: '/health/payments?app=app-1&phase=1' });
    });

    it('carries the declarations acceptance the applicant just ticked', async () => {
        await submitAndHandOver({
            applicationId: 'app-1', isInitialSubmit: true, isResubmit: false, declarationsAccepted: true,
        });
        expect(mockPost.mock.calls[0]![1]).toMatchObject({ declarationsAccepted: true });
    });

    it('does NOT claim an acceptance nobody gave', async () => {
        await submitAndHandOver({ applicationId: 'app-1', isInitialSubmit: true, isResubmit: false });
        expect(mockPost.mock.calls[0]![1]).not.toHaveProperty('declarationsAccepted');
    });
});

describe('a correction resubmit', () => {
    it('stops at the filing and goes back to the application, with no payment step', async () => {
        const out = await submitAndHandOver({ applicationId: 'app-2', isInitialSubmit: false, isResubmit: true });
        expect(mockPost).toHaveBeenCalledTimes(1);
        expect(out).toEqual({ kind: 'RESUBMITTED', href: '/health/applications/app-2' });
    });
});

describe('when the gate refuses', () => {
    it('speaks Thai instead of printing the enum at the farmer', async () => {
        mockPost.mockResolvedValueOnce({
            success: false, code: 'APPLICATION_NOT_JUDGEABLE',
            meta: { messageTh: 'ยังไม่มีกฎหมายสำหรับพืชที่เลือก' },
        });
        const out = await submitAndHandOver({ applicationId: 'app-3', isInitialSubmit: true, isResubmit: false });
        expect(out.kind).toBe('REFUSED');
        expect((out as { message: string }).message).toMatch(/[ก-๙]/);
        expect((out as { message: string }).message).not.toContain('APPLICATION_NOT_JUDGEABLE');
    });

    it('an APPLICATION_INCOMPLETE names the fields, not just "กรอกให้ครบ"', async () => {
        // Deep QA 2026-09-06: a walked filing was refused 422 while the review page's own
        // banner said everything was complete. The box then said only "กรุณากรอกข้อมูลให้
        // ครบถ้วน" — a sentence with nowhere to go. The 422 body CARRIES the field list
        // (errorsByStep, Thai per-field messages, in the form's own labels) and it
        // survives the envelope into `.meta`, so the farmer must be shown WHICH fields.
        mockPost.mockResolvedValueOnce({
            success: false, code: 'APPLICATION_INCOMPLETE',
            meta: {
                errorsByStep: {
                    4: [{ path: 'id_card', message: 'เลขประจำตัวประชาชน จำเป็น', code: 'invalid_type' }],
                    5: [{ path: 'farm_name', message: 'ชื่อสถานที่ปลูก จำเป็น', code: 'invalid_type' }],
                },
            },
        });
        const out = await submitAndHandOver({ applicationId: 'app-3', isInitialSubmit: true, isResubmit: false });
        expect(out.kind).toBe('REFUSED');
        const message = (out as { message: string }).message;
        expect(message).toContain('เลขประจำตัวประชาชน จำเป็น');
        expect(message).toContain('ชื่อสถานที่ปลูก จำเป็น');
        expect(message).not.toContain('APPLICATION_INCOMPLETE');
    });

    it('a refusal with no Thai copy still says something a person can read', async () => {
        mockPost.mockResolvedValueOnce({ success: false, error: 'SOMETHING_ELSE' });
        const out = await submitAndHandOver({ applicationId: 'app-3', isInitialSubmit: true, isResubmit: false });
        expect(out.kind).toBe('REFUSED');
        expect((out as { message: string }).message.length).toBeGreaterThan(0);
    });
});

describe('the legacy rail, unchanged', () => {
    beforeEach(() => mockCheckoutEnabled.mockReturnValue(false));

    it('still mints the phase-1 rows through the same door, then hands over', async () => {
        const out = await submitAndHandOver({ applicationId: 'app-4', isInitialSubmit: true, isResubmit: false });
        expect(mockPost).toHaveBeenNthCalledWith(2, '/payments/create', { applicationId: 'app-4', phase: '1' });
        expect(out).toEqual({ kind: 'FILED', href: '/health/payments?app=app-4&phase=1' });
    });

    it('a failure that is NOT the gate keeps its own message and stays put', async () => {
        // Pushing to the payments page here would take the applicant AWAY from the only
        // screen showing what went wrong, to one that cannot explain it.
        mockPost
            .mockResolvedValueOnce({ success: true })
            .mockResolvedValueOnce({ success: false, error: 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง' });
        const out = await submitAndHandOver({ applicationId: 'app-4', isInitialSubmit: true, isResubmit: false });
        expect(out.kind).toBe('REFUSED');
        expect(out).not.toHaveProperty('href');
        expect((out as { message: string }).message).toBe('ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง');
    });

    it('a quotation-gate refusal is said in Thai AND still sends them to the tick that clears it', async () => {
        mockPost
            .mockResolvedValueOnce({ success: true })
            .mockResolvedValueOnce({ success: false, code: 'QUOTATION_NOT_ACCEPTED' });
        const out = await submitAndHandOver({ applicationId: 'app-4', isInitialSubmit: true, isResubmit: false });
        expect(out.kind).toBe('REFUSED_BUT_FILED');
        expect((out as { href: string }).href).toBe('/health/payments?app=app-4&phase=1');
        expect((out as { message: string }).message).toMatch(/[ก-๙]/);
    });
});

describe('an application already past filing', () => {
    it('goes straight to the payments page without calling submit again', async () => {
        const out = await submitAndHandOver({ applicationId: 'app-5', isInitialSubmit: false, isResubmit: false });
        expect(mockPost).not.toHaveBeenCalled();
        expect(out).toEqual({ kind: 'FILED', href: '/health/payments?app=app-5&phase=1' });
    });
});


/**
 * autosave-lost-reply fix round 2 (3): tab B is SYNCED, tab A then saves older answers. B's
 * submit names B's last applied save; the server answers 409 DRAFT_NOT_LATEST. B saves its
 * current answers once and submits once more, never a third time.
 */
describe('fix round 2: another tab saved since this page did', () => {
    const notLatest = { success: false, status: 409, code: 'The stored draft is not the last save from this page', errorCode: 'DRAFT_NOT_LATEST' };

    it('sends the clock of this page\'s last applied save with the submit', async () => {
        mockClock = { saveSession: 'sess-B', lastAppliedSeq: 4 };
        await submitAndHandOver({ applicationId: 'app-1', isInitialSubmit: true, isResubmit: false });
        expect(mockPost).toHaveBeenCalledWith('/applications/submit', { applicationId: 'app-1', saveSession: 'sess-B', lastAppliedSeq: 4 });
    });

    it('409 DRAFT_NOT_LATEST: saves the current answers once, submits once more, and files', async () => {
        const calls: string[] = [];
        mockPost.mockImplementationOnce(async (url: string) => { calls.push(url); return notLatest; })
            .mockImplementation(async (url: string) => { calls.push(url); return { success: true }; });
        mockSaveNow.mockImplementation(async () => { calls.push('save-now'); return 'SAVED'; });
        const outcome = await submitAndHandOver({ applicationId: 'app-1', isInitialSubmit: true, isResubmit: false });
        expect(calls).toEqual(['/applications/submit', 'save-now', '/applications/submit']);
        expect(outcome.kind).toBe('FILED');
    });

    it('refused again after the one re-save: stops with Thai copy, no loop', async () => {
        mockPost.mockResolvedValue(notLatest);
        const outcome = await submitAndHandOver({ applicationId: 'app-1', isInitialSubmit: true, isResubmit: false });
        expect(mockSaveNow).toHaveBeenCalledTimes(1);
        expect(mockPost.mock.calls.filter(([u]) => u === '/applications/submit')).toHaveLength(2);
        expect(outcome).toEqual({ kind: 'REFUSED', message: DRAFT_NOT_LATEST_TH });
        expect(DRAFT_NOT_LATEST_TH).not.toMatch(/—/);
    });

    it('the re-save itself fails: refused, nothing submitted again', async () => {
        mockPost.mockResolvedValueOnce(notLatest);
        mockSaveNow.mockResolvedValueOnce('NOT_SAVED');
        const outcome = await submitAndHandOver({ applicationId: 'app-1', isInitialSubmit: true, isResubmit: false });
        expect(outcome).toEqual({ kind: 'REFUSED', message: DRAFT_NOT_SAVED_TH });
        expect(mockPost.mock.calls.filter(([u]) => u === '/applications/submit')).toHaveLength(1);
    });
});

/**
 * Operator ruling 2026-10-03 (a renewal is a submission): POST /applications/submit
 * refuses a renewal of another holder's certificate with 422 RENEWAL_HOLDER_MISMATCH.
 * The backend sends its Thai sentence as `error` (respondError keeps the thrower's
 * message), so apiClient's `.error` is that sentence and `.code` holds it too. The
 * applicant must read that sentence, not a generic line. Pin, not a fix: this path
 * already passes the backend's Thai through.
 */
describe('a renewal refused for another holder\'s certificate says so', () => {
    it('shows the backend\'s Thai refusal for RENEWAL_HOLDER_MISMATCH', async () => {
        const th = 'ใบรับรองเดิมออกในนามผู้ถือรายอื่น จึงยื่นต่ออายุในนามนี้ไม่ได้ กรุณายื่นในนามผู้ถือใบรับรองใบนั้น';
        mockPost.mockResolvedValueOnce({ success: false, error: th, code: th, errorCode: 'RENEWAL_HOLDER_MISMATCH', status: 422 });
        const out = await submitAndHandOver({ applicationId: 'app-1', isInitialSubmit: true, isResubmit: false, declarationsAccepted: true });
        expect(out).toEqual({ kind: 'REFUSED', message: th });
    });
});
