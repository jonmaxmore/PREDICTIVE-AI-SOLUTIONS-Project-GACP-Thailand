/**
 * The rules of the COA screen, tested without rendering anything.
 *
 * Same shape as document-check-state and revision-state: the decisions that matter
 * — may this be submitted, what does each report say about itself, and can the
 * screen tell "cannot read" apart from "nothing here" — live in a pure module so a
 * change to them fails a test rather than a screenshot.
 */
import {
    submitState, reportBadge, orderReports, listState, MIN_LAB_NAME_LENGTH,
    type LabReport, type UploadForm,
} from '../lab-results-state';

const file = () => new File(['x'], 'coa.pdf', { type: 'application/pdf' });
const form = (over: Partial<UploadForm> = {}): UploadForm => ({
    file: file(), labName: 'ห้องปฏิบัติการกลาง', reportNumber: '', reportedAt: '', verificationCode: '', ...over,
});
const report = (over: Partial<LabReport> = {}): LabReport => ({
    id: 'r1', fileUrl: '/u/a.pdf', labName: 'ก', verificationStatus: 'FARMER_UPLOADED',
    uploadedAt: '2026-09-16T00:00:00.000Z', ...over,
});

describe('submitState — what the button waits for', () => {
    it('a file and a lab name are enough', () => {
        expect(submitState(form(), false)).toEqual({ canSubmit: true, reason: null });
    });

    it('no file is the reason, not a generic disabled state', () => {
        expect(submitState(form({ file: null }), false)).toEqual({ canSubmit: false, reason: 'NO_FILE' });
    });

    it('a lab name of spaces does not count', () => {
        expect(submitState(form({ labName: '   ' }), false)).toEqual({ canSubmit: false, reason: 'NO_LAB_NAME' });
    });

    it(`a lab name shorter than ${MIN_LAB_NAME_LENGTH} characters cannot be traced back`, () => {
        expect(submitState(form({ labName: 'ก' }), false).canSubmit).toBe(false);
    });

    it('a request already in flight blocks a second one — a double press is not two reports', () => {
        expect(submitState(form(), true)).toEqual({ canSubmit: false, reason: 'IN_FLIGHT' });
    });
});

describe('reportBadge — a reader should not have to guess who vouched for this', () => {
    it('a farmer upload says so, plainly', () => {
        const badge = reportBadge(report());
        expect(badge.tone).toBe('neutral');
        expect(badge.labelTH).toContain('ยังไม่ผ่านการตรวจสอบ');
    });

    it('an officer-checked report says that instead', () => {
        expect(reportBadge(report({ verificationStatus: 'OFFICER_VERIFIED' })).tone).toBe('verified');
    });
});

describe('orderReports — a corrected COA sits beside its predecessor', () => {
    it('newest first', () => {
        const out = orderReports([
            report({ id: 'old', uploadedAt: '2026-09-01T00:00:00.000Z' }),
            report({ id: 'new', uploadedAt: '2026-09-16T00:00:00.000Z' }),
        ]);
        expect(out.map((r) => r.id)).toEqual(['new', 'old']);
    });

    it('does not mutate the array it was handed', () => {
        const input = [report({ id: 'a', uploadedAt: '2026-09-01T00:00:00.000Z' }), report({ id: 'b' })];
        orderReports(input);
        expect(input.map((r) => r.id)).toEqual(['a', 'b']);
    });
});

describe('listState — "cannot read" must not look like "nothing here"', () => {
    it('loading is its own state', () => {
        expect(listState({ loading: true, error: false, reports: null })).toEqual({ kind: 'loading' });
    });

    it('an error is UNREADABLE, never empty', () => {
        // A farmer shown "no lab reports" when the server failed would believe
        // their upload vanished. tnt-data-scope principle 4.
        expect(listState({ loading: false, error: true, reports: [] })).toEqual({ kind: 'unreadable' });
        expect(listState({ loading: false, error: false, reports: null })).toEqual({ kind: 'unreadable' });
    });

    it('genuinely none is empty', () => {
        expect(listState({ loading: false, error: false, reports: [] })).toEqual({ kind: 'empty' });
    });

    it('ready comes back ordered', () => {
        const out = listState({
            loading: false, error: false,
            reports: [report({ id: 'old', uploadedAt: '2026-09-01T00:00:00.000Z' }), report({ id: 'new' })],
        });
        expect(out.kind).toBe('ready');
        expect(out.kind === 'ready' && out.reports[0].id).toBe('new');
    });
});
