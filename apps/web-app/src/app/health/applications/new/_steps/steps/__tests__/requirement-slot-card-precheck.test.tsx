/**
 * Task 8 — the document pre-check on the applicant's slot card.
 *
 * The pre-check is warn-only: it reads the uploaded file, tells the applicant what
 * it noticed, and the officer decides. Four states come off `slot.precheck`, each
 * with its exact copy, and none of them blocks anything — the submit button on the
 * review page stays live whatever the pre-check said (pinned at the bottom).
 *
 * Two carry-forwards from earlier tasks are load-bearing here:
 *   - a NOT_FOUND flag IS an observation. A cross-match that could not find the
 *     name must never be summarised as "ไม่พบข้อสังเกต".
 *   - MANUAL (signature/seal) is the officer's line, not the applicant's; a DONE
 *     pre-check whose only non-pass flag is MANUAL reads as checked-ok.
 *
 * Pattern: createRoot/act — this repo has no @testing-library/react
 * (mirrors hooks/__tests__/first-filing-sees-its-documents.test.tsx).
 */
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockAcknowledge = jest.fn<(appId: string, precheckId: string) => Promise<{ precheckId: string; acknowledgedAt: string | null }>>();
jest.mock('@/lib/services/application-requirements', () => {
    const actual = jest.requireActual('@/lib/services/application-requirements') as Record<string, unknown>;
    return {
        ...actual,
        acknowledgePrecheck: (appId: string, precheckId: string) => mockAcknowledge(appId, precheckId),
    };
});
jest.mock('@/lib/services/draft-document-upload', () => ({
    uploadDraftDocument: jest.fn(async () => ({ error: null })),
}));

import { RequirementSlotCard } from '../requirement-slot-card';
import { slotCardState, precheckState, PRECHECK_COPY_TH } from '../requirement-slot-card-state';
import { Step6Review } from '../step6-review';
import { DECLARATION_ROWS } from '../step6-review-state';
import { ACKNOWLEDGE_PRECHECK_FAILED_TH } from '@/lib/services/application-requirements';
import type { ApplicantPrecheck, RequirementSlot, RequirementsPayload } from '@/lib/services/application-requirements';

// Exact copy, spec §5 — typed here on purpose, not imported, so a drifted
// constant fails instead of agreeing with itself.
const CHECKING = 'กำลังตรวจเอกสาร…';
const CHECKED_OK = 'ตรวจเบื้องต้นแล้ว ไม่พบข้อสังเกต';
const CHECK_FAILED = 'ตรวจอัตโนมัติไม่สำเร็จ เจ้าหน้าที่จะตรวจเอง';
const UPLOAD_NEW = 'อัปโหลดไฟล์ใหม่';
const CONFIRM = 'ยืนยันว่าเอกสารถูกต้อง';
const ACKNOWLEDGED = 'ยืนยันแล้ว';

// \p{Extended_Pictographic} alone misses U+2713/2715/2717 and U+FE0F; the union
// follows scripts/ci/check-ai-style-smells.js (the whole U+2600-27BF block).
const EMOJI = /[\p{Extended_Pictographic}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{1F000}-\u{1FAFF}\u{FE0F}]/u;

const NOT_FOUND_REASON = 'ไม่พบชื่อผู้ยื่นในเอกสาร กรุณาตรวจสอบ';
const EXPIRED_REASON = 'เอกสารออกมานานเกินกำหนด (ออกเมื่อ 1 ม.ค. 2566)';
const PASS_REASON = 'อ่านเอกสารได้ชัดเจน';
const MANUAL_REASON = 'ให้เจ้าหน้าที่ตรวจลายมือชื่อและตราประทับด้วยตนเอง';

const pc = (patch: Partial<ApplicantPrecheck>): ApplicantPrecheck => ({
    id: 'pc-1', status: 'DONE', flags: [], acknowledgedAt: null, ...patch,
});

const slot = (precheck: ApplicantPrecheck | null, patch: Partial<RequirementSlot> = {}): RequirementSlot => ({
    slotId: 'land_rights',
    labelTH: 'เอกสารสิทธิ์ที่ดิน',
    description: null,
    sourceHint: null,
    required: true,
    requiredReason: 'ALWAYS',
    satisfied: true,
    fileUrl: '/uploads/a.pdf',
    fileName: 'chanote.pdf',
    uploadedAt: null,
    precheck,
    ...patch,
});

const OK = pc({ flags: [
    { check: 'READABILITY', result: 'PASS', reasonTH: PASS_REASON },
    { check: 'DOC_TYPE', result: 'MATCH', reasonTH: 'พบข้อความที่ตรงกับชนิดเอกสารที่คาด' },
] });
const OK_WITH_MANUAL = pc({ flags: [
    { check: 'READABILITY', result: 'PASS', reasonTH: PASS_REASON },
    { check: 'SIGNATURE', result: 'MANUAL', reasonTH: MANUAL_REASON },
] });
const FLAGS = pc({ flags: [
    { check: 'READABILITY', result: 'PASS', reasonTH: PASS_REASON },
    { check: 'CROSS_MATCH', result: 'NOT_FOUND', reasonTH: NOT_FOUND_REASON },
    { check: 'VALIDITY', result: 'EXPIRED', reasonTH: EXPIRED_REASON },
    { check: 'SIGNATURE', result: 'MANUAL', reasonTH: MANUAL_REASON },
] });
const NOT_FOUND_ONLY = pc({ flags: [
    { check: 'READABILITY', result: 'PASS', reasonTH: PASS_REASON },
    { check: 'CROSS_MATCH', result: 'NOT_FOUND', reasonTH: NOT_FOUND_REASON },
] });

describe('the emoji guard itself', () => {
    // \p{Extended_Pictographic} alone misses the dingbats most likely to turn up in a
    // pass/observation list (U+2713 check, U+2715/U+2717 crosses) and U+FE0F.
    it.each(['\u2713', '\u2715', '\u2717', '\uFE0F', '\u{1F600}'])('catches %s', (ch) => {
        expect(EMOJI.test(ch)).toBe(true);
    });

    it('does not trip on Thai text or the ellipsis the copy uses', () => {
        expect(EMOJI.test(`${CHECKING} ${CHECKED_OK} ${CHECK_FAILED} ${UPLOAD_NEW} ${CONFIRM}`)).toBe(false);
    });
});

describe('which pre-check state a slot is in', () => {
    it('PENDING is checking, FAILED is check-failed', () => {
        expect(precheckState(pc({ status: 'PENDING' }))).toBe('checking');
        expect(precheckState(pc({ status: 'FAILED' }))).toBe('check-failed');
    });

    it('DONE with every flag PASS/MATCH is checked-ok', () => {
        expect(precheckState(OK)).toBe('checked-ok');
    });

    it('MANUAL alone does not count — it is the officer’s line', () => {
        expect(precheckState(OK_WITH_MANUAL)).toBe('checked-ok');
    });

    it('NOT_FOUND counts as an observation, never as "nothing noticed"', () => {
        expect(precheckState(NOT_FOUND_ONLY)).toBe('checked-flags');
    });

    it('DONE with zero flags is no pre-check UI — a check that produced nothing has noticed nothing', () => {
        expect(precheckState(pc({ status: 'DONE', flags: [] }))).toBeNull();
        expect(slotCardState(slot(pc({ status: 'DONE', flags: [] })))).toBe('attached');
    });

    it('no pre-check means no pre-check state at all (slots outside the catalog)', () => {
        expect(precheckState(null)).toBeNull();
        expect(precheckState(undefined)).toBeNull();
        expect(slotCardState(slot(null))).toBe('attached');
    });

    it('the card state is derived from slot.precheck once a file is attached', () => {
        expect(slotCardState(slot(pc({ status: 'PENDING' })))).toBe('checking');
        expect(slotCardState(slot(OK))).toBe('checked-ok');
        expect(slotCardState(slot(FLAGS))).toBe('checked-flags');
        expect(slotCardState(slot(pc({ status: 'FAILED' })))).toBe('check-failed');
    });

    it('the copy constants carry the spec’s exact words', () => {
        expect(PRECHECK_COPY_TH.checking).toBe(CHECKING);
        expect(PRECHECK_COPY_TH.checkedOk).toBe(CHECKED_OK);
        expect(PRECHECK_COPY_TH.checkFailed).toBe(CHECK_FAILED);
        expect(PRECHECK_COPY_TH.uploadNew).toBe(UPLOAD_NEW);
        expect(PRECHECK_COPY_TH.confirm).toBe(CONFIRM);
    });
});

let container: HTMLDivElement;
let root: Root;
const onChanged = jest.fn();

async function mount(s: RequirementSlot): Promise<void> {
    await act(async () => {
        root.render(<RequirementSlotCard slot={s} appId="app-1" onChanged={onChanged} />);
    });
}

const text = () => container.textContent ?? '';
const button = (label: string): HTMLButtonElement | undefined =>
    Array.from(container.querySelectorAll('button')).find((b) => b.textContent === label);

beforeEach(() => {
    mockAcknowledge.mockReset();
    onChanged.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
});

describe('what the card says in each state', () => {
    it('checking: "กำลังตรวจเอกสาร…"', async () => {
        await mount(slot(pc({ status: 'PENDING' })));
        expect(text()).toContain(CHECKING);
        expect(text()).not.toContain(CHECKED_OK);
        expect(button(CONFIRM)).toBeUndefined();
    });

    it('checked-ok: "ตรวจเบื้องต้นแล้ว ไม่พบข้อสังเกต", and MANUAL is not shown to the applicant', async () => {
        await mount(slot(OK_WITH_MANUAL));
        expect(text()).toContain(CHECKED_OK);
        expect(text()).not.toContain(MANUAL_REASON);
        expect(button(CONFIRM)).toBeUndefined();
        expect(button(UPLOAD_NEW)).toBeUndefined();
    });

    it('checked-flags: each observation’s reasonTH, plus the two buttons', async () => {
        await mount(slot(FLAGS));
        expect(text()).toContain(NOT_FOUND_REASON);
        expect(text()).toContain(EXPIRED_REASON);
        expect(button(UPLOAD_NEW)).toBeDefined();
        expect(button(CONFIRM)).toBeDefined();
        expect(button(CONFIRM)!.disabled).toBe(false);
    });

    it('checked-flags lists observations only — not the passes, not the officer’s MANUAL line', async () => {
        await mount(slot(FLAGS));
        const items = Array.from(container.querySelectorAll('li')).map((li) => li.textContent);
        expect(items).toEqual([NOT_FOUND_REASON, EXPIRED_REASON]);
    });

    it('a NOT_FOUND flag is never summarised as "ไม่พบข้อสังเกต"', async () => {
        await mount(slot(NOT_FOUND_ONLY));
        expect(text()).toContain(NOT_FOUND_REASON);
        expect(text()).not.toContain(CHECKED_OK);
    });

    it('check-failed: "ตรวจอัตโนมัติไม่สำเร็จ เจ้าหน้าที่จะตรวจเอง"', async () => {
        await mount(slot(pc({ status: 'FAILED' })));
        expect(text()).toContain(CHECK_FAILED);
        expect(button(CONFIRM)).toBeUndefined();
    });

    it('DONE with zero flags never says "ไม่พบข้อสังเกต"', async () => {
        await mount(slot(pc({ status: 'DONE', flags: [] })));
        expect(text()).not.toContain(CHECKED_OK);
        expect(container.querySelector('[data-precheck]')).toBeNull();
    });

    it('precheck: null renders no pre-check UI at all', async () => {
        await mount(slot(null));
        for (const copy of [CHECKING, CHECKED_OK, CHECK_FAILED, UPLOAD_NEW, CONFIRM, ACKNOWLEDGED]) {
            expect(text()).not.toContain(copy);
        }
    });

    it('no emoji in any state (text labels only)', async () => {
        for (const p of [pc({ status: 'PENDING' }), OK, FLAGS, pc({ status: 'FAILED' }), pc({ ...FLAGS, acknowledgedAt: '2026-09-27T10:00:00.000Z' }), null]) {
            await mount(slot(p));
            expect(text()).not.toMatch(EMOJI);
        }
    });
});

describe('the two buttons on checked-flags', () => {
    it('"ยืนยันว่าเอกสารถูกต้อง" records the acknowledgement, then shows it — reasons stay, button goes dead', async () => {
        mockAcknowledge.mockResolvedValue({ precheckId: 'pc-1', acknowledgedAt: '2026-09-27T10:00:00.000Z' });
        await mount(slot(FLAGS));

        await act(async () => { button(CONFIRM)!.click(); });

        expect(mockAcknowledge).toHaveBeenCalledWith('app-1', 'pc-1');
        expect(text()).toContain(ACKNOWLEDGED);
        expect(text()).toContain(NOT_FOUND_REASON);
        expect(button(CONFIRM)!.disabled).toBe(true);
        // Re-read the server's answer, never keep only a local copy.
        expect(onChanged).toHaveBeenCalled();
    });

    it('a refused acknowledgement says so in the exact Thai, and leaves the button live', async () => {
        // Whatever the failure carries (here an English transport error), the applicant
        // reads the card's own sentence.
        mockAcknowledge.mockRejectedValue(new Error('Failed to fetch'));
        await mount(slot(FLAGS));

        await act(async () => { button(CONFIRM)!.click(); });

        expect(container.querySelector('[role="alert"]')?.textContent).toBe(ACKNOWLEDGE_PRECHECK_FAILED_TH);
        expect(ACKNOWLEDGE_PRECHECK_FAILED_TH).toBe('บันทึกการยืนยันเอกสารไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
        expect(text()).not.toContain(ACKNOWLEDGED);
        expect(button(CONFIRM)!.disabled).toBe(false);
    });

    it('a pre-check the server already reports acknowledged renders acknowledged', async () => {
        await mount(slot(pc({ ...FLAGS, acknowledgedAt: '2026-09-27T10:00:00.000Z' })));
        expect(text()).toContain(ACKNOWLEDGED);
        expect(text()).toContain(EXPIRED_REASON);
        expect(button(CONFIRM)!.disabled).toBe(true);
    });

    it('"อัปโหลดไฟล์ใหม่" carries the theme border and card surface, so it reads as a button in dark mode', async () => {
        await mount(slot(FLAGS));
        const classes = button(UPLOAD_NEW)!.className.split(/\s+/);
        expect(classes).toContain('border-border');
        expect(classes).toContain('bg-card');
        expect(classes).not.toContain('border-muted');
    });

    it('"อัปโหลดไฟล์ใหม่" opens the slot’s own file picker (the existing upload action)', async () => {
        const click = jest.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
        await mount(slot(FLAGS));

        await act(async () => { button(UPLOAD_NEW)!.click(); });

        expect(click).toHaveBeenCalledTimes(1);
        expect((click.mock.contexts[0] as HTMLInputElement).type).toBe('file');
        click.mockRestore();
    });
});

describe('nothing here gates submission (pin: warn-only)', () => {
    const payload = (slots: RequirementSlot[]): RequirementsPayload => ({
        dims: {} as never, slots, missingRequired: [], blockingIssues: [], complete: true,
    });
    const base = {
        katorlor1Html: '<h1>แบบ กทล ๑</h1>',
        ticked: Object.fromEntries(DECLARATION_ROWS.map((r) => [r.id, true])),
        onTick: () => {}, onSubmit: () => {}, submitting: false, error: null,
        alreadyAccepted: false, feeSummary: null, statusKnown: true, scopeDeclared: true,
        consentsAgreed: true, missingConsents: [], consentTicked: {}, onConsentTick: () => {},
    };

    for (const [name, p] of [
        ['checking', pc({ status: 'PENDING' })],
        ['checked-flags', FLAGS],
        ['check-failed', pc({ status: 'FAILED' })],
    ] as const) {
        it(`the submit button stays enabled while a slot is ${name}`, () => {
            const html = renderToStaticMarkup(<Step6Review {...base} requirements={payload([slot(p)])} />);
            const submit = html.match(/<button[^>]*data-testid="step6-submit"[^>]*>/)?.[0] ?? '';
            expect(submit).not.toBe('');
            expect(submit).not.toContain('disabled');
        });
    }
});
