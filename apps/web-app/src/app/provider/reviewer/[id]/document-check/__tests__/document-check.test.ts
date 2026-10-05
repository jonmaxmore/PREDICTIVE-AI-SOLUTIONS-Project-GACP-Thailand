/**
 * The officer screen may not be more permissive than the door behind it.
 *
 * Every rule here mirrors one in application-document-review-service.js. The
 * point of the mirror is not to duplicate enforcement — the server refuses
 * regardless — but that an officer learns "you still have two papers to accept"
 * from a disabled button and a highlighted row, instead of from a 409 after
 * they have already pressed it.
 *
 * If these ever disagree, the SERVER is right and this is the bug.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import {
    rowState, canSubmitRequest, decisionState, MIN_REASON_LENGTH,
    type SlotRow,
} from '../document-check-state';

const slot = (over: Partial<SlotRow> = {}): SlotRow => ({
    slotId: 'land_rights',
    labelTH: 'สำเนาเอกสารสิทธิ์ที่ดิน',
    required: true,
    satisfied: true,
    fileUrl: '/uploads/x.pdf',
    fileName: 'chanote.pdf',
    verdict: null,
    reviewReason: null,
    reviewDueDate: null,
    ...over,
});

describe('what a row looks like', () => {
    test.each([
        ['ACCEPTED', 'ACCEPTED' as const],
        ['MORE_REQUESTED', 'REQUESTED' as const],
    ])('a %s verdict shows as %s', (verdict, expected) => {
        expect(rowState(slot({ verdict: verdict as SlotRow['verdict'] }))).toBe(expected);
    });

    test('an unreviewed row is pending, not accepted — silence is not approval', () => {
        expect(rowState(slot({ verdict: null }))).toBe('PENDING');
    });
});

describe('the per-slot request form', () => {
    test('a reason shorter than the server accepts cannot be submitted', () => {
        expect(canSubmitRequest('ไม่ชัด', '2026-09-10')).toBe(false);
        expect(MIN_REASON_LENGTH).toBe(10);
    });

    test('whitespace is not a reason', () => {
        expect(canSubmitRequest('          ', '2026-09-10')).toBe(false);
    });

    test('a reason without a due date cannot be submitted — an open-ended demand has no deadline to miss', () => {
        expect(canSubmitRequest('สำเนาโฉนดอ่านเลขที่ไม่ออก กรุณาแนบใหม่', '')).toBe(false);
    });

    test('both present → submittable', () => {
        expect(canSubmitRequest('สำเนาโฉนดอ่านเลขที่ไม่ออก กรุณาแนบใหม่', '2026-09-10')).toBe(true);
    });
});

describe('which decision is available', () => {
    test('รับคำขอ needs every REQUIRED slot accepted', () => {
        const d = decisionState([
            slot({ slotId: 'land_rights', verdict: 'ACCEPTED' }),
            slot({ slotId: 'sop_manual', verdict: 'ACCEPTED' }),
        ]);
        expect(d.canAccept).toBe(true);
        expect(d.acceptBlockedReason).toBeNull();
    });

    test('one unaccepted required slot disables it and NAMES the row', () => {
        const d = decisionState([
            slot({ slotId: 'land_rights', verdict: 'ACCEPTED' }),
            slot({ slotId: 'sop_manual', verdict: null }),
        ]);
        expect(d.canAccept).toBe(false);
        expect(d.blockingSlotIds).toEqual(['sop_manual']);
        expect(d.acceptBlockedReason).toContain('ยังไม่ได้รับ');
    });

    test('a required slot marked MORE_REQUESTED blocks acceptance too', () => {
        expect(decisionState([slot({ verdict: 'MORE_REQUESTED' })]).canAccept).toBe(false);
    });

    test('an OPTIONAL slot never blocks acceptance, reviewed or not', () => {
        const d = decisionState([
            slot({ slotId: 'land_rights', verdict: 'ACCEPTED' }),
            slot({ slotId: 'water_test', required: false, verdict: null }),
            slot({ slotId: 'soil_test', required: false, verdict: 'MORE_REQUESTED' }),
        ]);
        expect(d.canAccept).toBe(true);
    });

    test('ส่งคำขอเอกสารเพิ่ม needs at least one requested slot', () => {
        expect(decisionState([slot({ verdict: 'ACCEPTED' })]).canRequestMore).toBe(false);
        expect(decisionState([slot({ verdict: 'MORE_REQUESTED' })]).canRequestMore).toBe(true);
    });

    test('an optional slot can be the thing requested', () => {
        const d = decisionState([slot({ required: false, verdict: 'MORE_REQUESTED' })]);
        expect(d.canRequestMore).toBe(true);
    });

    test('an empty checklist enables nothing — there is no filing to decide on', () => {
        const d = decisionState([]);
        expect(d.canAccept).toBe(false);
        expect(d.canRequestMore).toBe(false);
    });

    test('a filing with one requested and one pending offers ONLY ส่งคำขอเอกสารเพิ่ม', () => {
        const d = decisionState([
            slot({ slotId: 'land_rights', verdict: 'MORE_REQUESTED' }),
            slot({ slotId: 'sop_manual', verdict: null }),
        ]);
        expect(d.canAccept).toBe(false);
        expect(d.canRequestMore).toBe(true);
    });
});

// ── the page itself, read as text ─────────────────────────────────────────────

describe('the screen honours the rules it cannot enforce', () => {
    /**
     * Declarations only.
     *
     * The comment in client-view.tsx explaining why `window.open` is forbidden
     * necessarily writes it out, and a guard that reads a MENTION as a
     * DECLARATION punishes the explanation. That trap has caught this session
     * four times now — ratchet's hardcode and env-direct patterns, the farm-QR
     * pin, and here.
     */
    const view = readFileSync(join(__dirname, '..', 'client-view.tsx'), 'utf8')
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l))
        .join('\n');

    test('a document is opened in the page, never handed to the browser', () => {
        // /uploads serves Content-Disposition: attachment on purpose (PDPA
        // posture, middleware/uploads-security-headers.js). A raw link therefore
        // DOWNLOADS an applicant's identity document onto the officer's machine
        // instead of showing it — which is a copy nobody asked for and nobody
        // deletes. The in-page viewer is the only route.
        expect(view).not.toContain('window.open');
        expect(view).toContain('DocumentViewerModal');
    });

    test('both decision buttons read their enabled state from the shared rules', () => {
        expect(view).toContain('decision.canAccept');
        expect(view).toContain('decision.canRequestMore');
    });

    test('the per-slot request form is gated by the same minimum the server applies', () => {
        expect(view).toContain('canSubmitRequest(');
    });

    test('a failed read shows an error rather than an empty checklist', () => {
        // An empty list on THIS screen reads as "nothing left to check" to
        // someone about to accept a filing. It must never be the fallback.
        expect(view).toContain('role="alert"');
        expect(view).toMatch(/setError\(/);
    });

    test('a notification that did not reach the applicant is surfaced, not swallowed', () => {
        expect(view).toContain('notified === false');
    });

    test('every decision refetches — the server\'s answer is the one that counts', () => {
        expect(view).toMatch(/await load\(\)/);
    });
});
