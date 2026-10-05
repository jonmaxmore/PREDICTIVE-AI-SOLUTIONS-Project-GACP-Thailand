/**
 * Task 8 — the pre-check on the officer's document-check row.
 *
 * The officer decides; the pre-check only reports. Each row that has a pre-check
 * shows every flag with its reasonTH, the confidence and the evidence snippet (the
 * API masks raw ids before they leave the server), a badge "ผู้ยื่นยืนยันแล้ว"
 * when the applicant acknowledged the observations, and the line "ตรวจลายมือชื่อ/ตรา"
 * for the MANUAL signature/seal flag. The verdict controls stay exactly as they were.
 *
 * Pattern: createRoot/act (no @testing-library/react in this repo).
 */
import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockGet = jest.fn<(url: string) => Promise<unknown>>();
jest.mock('@/lib/api', () => ({
    apiClient: { get: (url: string) => mockGet(url), post: jest.fn() },
}));
jest.mock('next/navigation', () => ({
    useParams: () => ({ id: 'app-1' }),
    useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }),
}));
jest.mock('@/components/feature/document-viewer-modal', () => ({
    DocumentViewerModal: () => null,
}));

import ClientView from '../client-view';
import { precheckFlagLine, precheckConfidence, PRECHECK_OFFICER_COPY_TH } from '../document-check-state';

const ACK_BADGE = 'ผู้ยื่นยืนยันแล้ว';
const SIGNATURE_LINE = 'ตรวจลายมือชื่อ/ตรา';
// \p{Extended_Pictographic} alone misses U+2713/2715/2717 and U+FE0F; the union
// follows scripts/ci/check-ai-style-smells.js (the whole U+2600-27BF block).
const EMOJI = /[\p{Extended_Pictographic}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{1F000}-\u{1FAFF}\u{FE0F}]/u;

const NOT_FOUND_REASON = 'ไม่พบชื่อผู้ยื่นในเอกสาร กรุณาตรวจสอบ';
const EXPIRED_REASON = 'เอกสารออกมานานเกินกำหนด (ออกเมื่อ 1 ม.ค. 2566)';
const SNIPPET = 'เลขประจำตัวประชาชน X-XXXX-XXXXX-12-3 นายสมชาย';

const baseRow = {
    required: true, satisfied: true, fileUrl: '/uploads/x.pdf', fileName: 'x.pdf',
    verdict: null, reviewReason: null, reviewDueDate: null,
};

const PAYLOAD = {
    round: 1,
    officerChecklist: { scope: '-', qualification: '-', overall: '-' },
    slots: [
        {
            ...baseRow, slotId: 'land_rights', labelTH: 'สำเนาเอกสารสิทธิ์ที่ดิน',
            precheck: {
                id: 'pc-1', status: 'DONE', acknowledgedAt: '2026-09-27T10:00:00.000Z',
                flags: [
                    { check: 'READABILITY', result: 'PASS', reasonTH: 'อ่านเอกสารได้ชัดเจน', confidence: 91.4, evidenceSnippet: null },
                    { check: 'CROSS_MATCH', result: 'NOT_FOUND', reasonTH: NOT_FOUND_REASON, confidence: 91.4, evidenceSnippet: SNIPPET },
                    { check: 'VALIDITY', result: 'EXPIRED', reasonTH: EXPIRED_REASON, confidence: 91.4, evidenceSnippet: 'ออกให้ ณ วันที่ 1 มกราคม 2566' },
                    { check: 'SIGNATURE', result: 'MANUAL', reasonTH: 'ให้เจ้าหน้าที่ตรวจลายมือชื่อและตราประทับด้วยตนเอง', confidence: 0, evidenceSnippet: null },
                ],
            },
        },
        {
            ...baseRow, slotId: 'id_house_reg', labelTH: 'สำเนาบัตรประชาชนและทะเบียนบ้าน',
            precheck: { id: 'pc-2', status: 'DONE', acknowledgedAt: null, flags: [
                { check: 'READABILITY', result: 'PASS', reasonTH: 'อ่านเอกสารได้ชัดเจน', confidence: 88, evidenceSnippet: null },
            ] },
        },
        { ...baseRow, slotId: 'sop_manual', labelTH: 'คู่มือ SOP', precheck: null },
    ],
};

let container: HTMLDivElement;
let root: Root;

async function mountView(): Promise<void> {
    await act(async () => { root.render(<ClientView />); });
    await act(async () => { await Promise.resolve(); });
}

function rowOf(label: string): HTMLElement {
    const heading = Array.from(container.querySelectorAll('p')).find((p) => p.textContent === label);
    if (!heading) { throw new Error(`no row for ${label}`); }
    return heading.closest('[data-slot-row]') as HTMLElement;
}

beforeEach(() => {
    mockGet.mockReset();
    mockGet.mockResolvedValue({ success: true, data: PAYLOAD });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
});

describe('the pre-check on an officer row', () => {
    it('lists every flag’s reasonTH, NOT_FOUND included', async () => {
        await mountView();
        const row = rowOf('สำเนาเอกสารสิทธิ์ที่ดิน');
        expect(row.textContent).toContain(NOT_FOUND_REASON);
        expect(row.textContent).toContain(EXPIRED_REASON);
        expect(row.textContent).toContain('อ่านเอกสารได้ชัดเจน');
    });

    it('shows the extraction confidence ONCE, beside the heading, and the (already masked) snippet', async () => {
        await mountView();
        const row = rowOf('สำเนาเอกสารสิทธิ์ที่ดิน');
        expect(row.textContent).toContain(SNIPPET);
        expect(row.textContent!.split(PRECHECK_OFFICER_COPY_TH.confidence).length - 1).toBe(1);
        expect(row.textContent!.split('91%').length - 1).toBe(1);
        const heading = Array.from(row.querySelectorAll('p')).find((p) => p.textContent === PRECHECK_OFFICER_COPY_TH.heading)!;
        expect(heading.parentElement!.textContent).toContain(`${PRECHECK_OFFICER_COPY_TH.confidence} 91%`);
        for (const li of Array.from(row.querySelectorAll('li'))) {
            expect(li.textContent).not.toContain('%');
        }
    });

    it('badges "ผู้ยื่นยืนยันแล้ว" only where acknowledgedAt is set', async () => {
        await mountView();
        expect(rowOf('สำเนาเอกสารสิทธิ์ที่ดิน').textContent).toContain(ACK_BADGE);
        expect(rowOf('สำเนาบัตรประชาชนและทะเบียนบ้าน').textContent).not.toContain(ACK_BADGE);
    });

    it('the MANUAL flag reads "ตรวจลายมือชื่อ/ตรา"', async () => {
        await mountView();
        expect(rowOf('สำเนาเอกสารสิทธิ์ที่ดิน').textContent).toContain(SIGNATURE_LINE);
        expect(rowOf('สำเนาบัตรประชาชนและทะเบียนบ้าน').textContent).not.toContain(SIGNATURE_LINE);
    });

    it('a row with precheck: null shows no pre-check block', async () => {
        await mountView();
        const row = rowOf('คู่มือ SOP');
        expect(row.querySelector('[data-precheck]')).toBeNull();
    });

    it('the verdict controls are unchanged on every row', async () => {
        await mountView();
        for (const label of ['สำเนาเอกสารสิทธิ์ที่ดิน', 'สำเนาบัตรประชาชนและทะเบียนบ้าน', 'คู่มือ SOP']) {
            const labels = Array.from(rowOf(label).querySelectorAll('button')).map((b) => b.textContent);
            expect(labels).toEqual(['ดู', 'รับเอกสารนี้', 'ขอเอกสารเพิ่ม']);
        }
    });

    it('no emoji anywhere on the screen', async () => {
        await mountView();
        expect(container.textContent).not.toMatch(EMOJI);
    });
});

// Operator ruling 2026-09-28 (Task 10): the officer row's per-flag tags.
const NOTHING_NOTICED_TAG = 'ไม่มีข้อสังเกต';
const OBSERVATION_TAG = 'ข้อสังเกต';
const MANUAL_TAG = 'ตรวจเอง';
const OFFICER_DECIDES = 'ผลตรวจอัตโนมัติเป็นข้อสังเกตเบื้องต้น การตัดสินเป็นของเจ้าหน้าที่';

/** The tag a flag line starts with: the text before the first " · ". */
function tagsOf(row: HTMLElement): string[] {
    return Array.from(row.querySelectorAll('[data-precheck] li')).map((li) => (li.textContent || '').split(' · ')[0]);
}

describe('officer-row labels (operator ruling 2026-09-28)', () => {
    it('PASS/MATCH is tagged "ไม่มีข้อสังเกต" — "ผ่าน" is no longer a tag anywhere', async () => {
        await mountView();
        const land = tagsOf(rowOf('สำเนาเอกสารสิทธิ์ที่ดิน'));
        const idHouse = tagsOf(rowOf('สำเนาบัตรประชาชนและทะเบียนบ้าน'));
        expect(land[0]).toBe(NOTHING_NOTICED_TAG);
        expect(idHouse).toEqual([NOTHING_NOTICED_TAG]);
        for (const tag of [...land, ...idHouse]) {
            expect(tag).not.toBe('ผ่าน');
        }
    });

    it('every non-PASS/MATCH result keeps "ข้อสังเกต"', async () => {
        await mountView();
        const land = tagsOf(rowOf('สำเนาเอกสารสิทธิ์ที่ดิน'));
        // READABILITY PASS, CROSS_MATCH NOT_FOUND, VALIDITY EXPIRED, SIGNATURE MANUAL
        expect(land.slice(1, 3)).toEqual([OBSERVATION_TAG, OBSERVATION_TAG]);
        for (const result of ['UNREADABLE', 'PAGE_COUNT', 'NOT_FOUND', 'MISMATCH', 'EXPIRED', 'DATE_NOT_FOUND']) {
            expect(precheckFlagLine({ check: 'X', result, reasonTH: 'r', confidence: 50, evidenceSnippet: null }).observation).toBe(true);
        }
    });

    it('the MANUAL line reads "ตรวจเอง · ตรวจลายมือชื่อ/ตรา"', async () => {
        await mountView();
        const lines = Array.from(rowOf('สำเนาเอกสารสิทธิ์ที่ดิน').querySelectorAll('[data-precheck] li')).map((li) => li.textContent);
        expect(lines[3]).toBe(`${MANUAL_TAG} · ${SIGNATURE_LINE}`);
    });

    it('each pre-check block carries the line that the officer decides once, directly below the heading', async () => {
        await mountView();
        for (const label of ['สำเนาเอกสารสิทธิ์ที่ดิน', 'สำเนาบัตรประชาชนและทะเบียนบ้าน']) {
            const block = rowOf(label).querySelector('[data-precheck]') as HTMLElement;
            expect(block.textContent!.split(OFFICER_DECIDES).length - 1).toBe(1);
            // Fix round 1 (review M1): the heading row comes first, the disclaimer right after it.
            const [first, second] = Array.from(block.children);
            expect(first.textContent).toContain(PRECHECK_OFFICER_COPY_TH.heading);
            expect(second.textContent).toBe(OFFICER_DECIDES);
        }
        expect(rowOf('คู่มือ SOP').textContent).not.toContain(OFFICER_DECIDES);
    });

    it('the copy constants carry the ruling’s exact words', () => {
        expect(PRECHECK_OFFICER_COPY_TH.nothingNoticed).toBe(NOTHING_NOTICED_TAG);
        expect(PRECHECK_OFFICER_COPY_TH.observation).toBe(OBSERVATION_TAG);
        expect(PRECHECK_OFFICER_COPY_TH.manualTag).toBe(MANUAL_TAG);
        expect(PRECHECK_OFFICER_COPY_TH.officerDecides).toBe(OFFICER_DECIDES);
    });
});

describe('the emoji guard itself', () => {
    it.each(['\u2713', '\u2715', '\u2717', '\uFE0F', '\u{1F600}'])('catches %s', (ch) => {
        expect(EMOJI.test(ch)).toBe(true);
    });
});

describe('precheckFlagLine (pure)', () => {
    it('MANUAL is the signature line', () => {
        const line = precheckFlagLine({ check: 'SIGNATURE', result: 'MANUAL', reasonTH: 'x', confidence: 0, evidenceSnippet: null });
        expect(line.text).toBe(SIGNATURE_LINE);
        expect(line.manual).toBe(true);
    });

    it('other flags keep their reasonTH, and a line carries no confidence of its own', () => {
        const line = precheckFlagLine({ check: 'VALIDITY', result: 'EXPIRED', reasonTH: EXPIRED_REASON, confidence: 91.6, evidenceSnippet: null });
        expect(line.text).toBe(EXPIRED_REASON);
        expect(line.observation).toBe(true);
        expect(line).not.toHaveProperty('confidence');
    });

    it('precheckConfidence: the extraction confidence (READABILITY first), whole percent, never MANUAL’s 0', () => {
        const f = (check: string, result: string, confidence: number | null) => ({ check, result, reasonTH: 'r', confidence, evidenceSnippet: null });
        expect(precheckConfidence({ id: 'p', status: 'DONE', acknowledgedAt: null, flags: [f('SIGNATURE', 'MANUAL', 0), f('DOC_TYPE', 'MATCH', 80), f('READABILITY', 'PASS', 91.6)] })).toBe('92%');
        expect(precheckConfidence({ id: 'p', status: 'DONE', acknowledgedAt: null, flags: [f('SIGNATURE', 'MANUAL', 0), f('DOC_TYPE', 'MATCH', 80.2)] })).toBe('80%');
        expect(precheckConfidence({ id: 'p', status: 'DONE', acknowledgedAt: null, flags: [f('SIGNATURE', 'MANUAL', 0)] })).toBeNull();
        expect(precheckConfidence({ id: 'p', status: 'PENDING', acknowledgedAt: null, flags: [] })).toBeNull();
    });

    it('PASS and MATCH are not observations; NOT_FOUND is', () => {
        const f = (result: string) => precheckFlagLine({ check: 'X', result, reasonTH: 'r', confidence: 50, evidenceSnippet: null }).observation;
        expect(f('PASS')).toBe(false);
        expect(f('MATCH')).toBe(false);
        expect(f('NOT_FOUND')).toBe(true);
    });

    it('the copy carries the spec’s exact words', () => {
        expect(PRECHECK_OFFICER_COPY_TH.acknowledged).toBe(ACK_BADGE);
        expect(PRECHECK_OFFICER_COPY_TH.signature).toBe(SIGNATURE_LINE);
    });
});

// Walk D5: a FAILED pre-check said three different things (API reason, applicant
// card, officer row). One wording now, spec §5's applicant copy — typed here as a
// literal so a drifted constant fails instead of agreeing with itself.
describe('one FAILED wording (walk D5)', () => {
    const FAILED_COPY = 'ตรวจอัตโนมัติไม่สำเร็จ เจ้าหน้าที่จะตรวจเอง';

    it('the officer row, the applicant card and the shared constant are the same string', async () => {
        const { PRECHECK_FAILED_TH } = await import('@gacp/validation/precheck-copy');
        const { PRECHECK_COPY_TH } = await import('@/app/health/applications/new/_steps/steps/requirement-slot-card-state');
        expect(PRECHECK_FAILED_TH).toBe(FAILED_COPY);
        expect(PRECHECK_OFFICER_COPY_TH.failed).toBe(FAILED_COPY);
        expect(PRECHECK_COPY_TH.checkFailed).toBe(FAILED_COPY);
    });

    it('a FAILED row prints that wording once, and no other FAILED sentence', async () => {
        mockGet.mockResolvedValue({
            success: true,
            data: {
                ...PAYLOAD,
                slots: [{ ...baseRow, slotId: 'land_rights', labelTH: 'สำเนาเอกสารสิทธิ์ที่ดิน',
                    precheck: { id: 'pc-f', status: 'FAILED', acknowledgedAt: null, flags: [] } }],
            },
        });
        await mountView();
        const text = rowOf('สำเนาเอกสารสิทธิ์ที่ดิน').textContent || '';
        expect(text.split(FAILED_COPY).length - 1).toBe(1);
        expect(text.split('ตรวจอัตโนมัติไม่สำเร็จ').length - 1).toBe(1);
    });
});
