/**
 * Batch A (fix/approver-sees-the-file) — web side, source-read pins (same convention as
 * p1h-overdue-tile.test.tsx: these screens mount ProviderLayout + apiClient, which the
 * audits tests do not instantiate).
 *
 *  item 3  the inspector dashboard has no "อนุมัติ" tab and never calls the approver-only
 *          /final-approval-queue (it answered 403 on every load)
 *  item 4  CAR_REVIEWING: the job sheet does not offer REJECT (not an edge for the inspector)
 *  item 5  the applicant-facing hint and button no longer say "Coordinator" / "CAR"
 *  item 1  the approver's list opens the read-only file, not /provider/audits/:id
 */
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (...p: string[]) => readFileSync(path.resolve(__dirname, '..', ...p), 'utf8');

describe('item 3 — inspector dashboard has no approver tab', () => {
    const src = read('client-view.tsx');
    it('does not call the final-approval queue', () => {
        expect(src).not.toMatch(/auditorFinalApprovalQueue/);
        expect(src).not.toMatch(/final-approval-queue/);
    });
    it('does not render the อนุมัติ tab or the approval list', () => {
        expect(src).not.toMatch(/final_approval/);
        expect(src).not.toMatch(/FinalApprovalList/);
        expect(src).not.toMatch(/auditorFinalApproval\b/);
        expect(src).not.toMatch(/auditorRejectToAuditor/);
    });
});

describe('item 4 — CAR_REVIEWING offers only what the inspector may do', () => {
    const src = read('[id]', 'page.tsx');
    it('hides the REJECT button while the file is under corrective-action review', () => {
        expect(src).toMatch(/workflowState !== "CAR_REVIEWING"[\s\S]{0,400}setDecision\("REJECT"\)/);
    });
    it('keeps Minor and Major available (CAR_REVIEWING -> CAR_PENDING is a legal edge)', () => {
        expect(src).toMatch(/setDecision\("MINOR"\)/);
        expect(src).toMatch(/setDecision\("MAJOR"\)/);
    });
});

describe('item 5 — applicant-facing wording', () => {
    const cfg = readFileSync(
        path.resolve(__dirname, '..', '..', '..', 'health', 'applications', '[id]', 'application-detail-page-config.ts'),
        'utf8',
    );
    it('no "Coordinator" in the hint', () => {
        expect(cfg).not.toMatch(/Coordinator/);
    });
    it('the CAR evidence button does not use the jargon', () => {
        expect(cfg).not.toMatch(/buttonLabel: 'ส่งหลักฐาน CAR'/);
    });
});

describe('item 1 — the decision list opens the read-only file', () => {
    const list = read('final-approval-list.tsx');
    it('"รายละเอียด" goes to /provider/certification-decisions/:id', () => {
        expect(list).toMatch(/\/provider\/certification-decisions\/\$\{item\.id\}/);
        expect(list).not.toMatch(/\/provider\/audits\/\$\{item\.id\}/);
    });
});
