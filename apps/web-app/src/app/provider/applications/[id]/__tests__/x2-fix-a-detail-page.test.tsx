/**
 * x2-fix-a-detail-page.test.tsx — X2-FIX-A (H-1, H-7, H-10) regression.
 *
 * Source-shape tests covering the patches on
 * `app/provider/applications/[id]/page.tsx`:
 *   - H-1: action panel labels and buttons must read in Thai.
 *   - H-7: history-tab actor attribution uses the fallback chain
 *          `actorName ?? actorRole ?? by ?? "SYSTEM"`.
 *   - H-10: Approve / Request-Revision buttons enforce the 44×44
 *           touch target (WCAG 2.5.5).
 *
 * Shape — file-read assertions. The project does not pull
 * `@testing-library/react`; sibling tests (review-decision-modal-thai-
 * copy.test.tsx) use `renderToStaticMarkup` but the canReview branch
 * requires the role fetch + isReviewableState predicate to resolve
 * synchronously, which cannot happen in SSR. Reading the source as a
 * string is the same pattern used by `i18n-canonical-source-check.test.
 * ts` elsewhere in the repo to lock JSX-level invariants.
 */

import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const PAGE_SOURCE = readFileSync(
    path.resolve(__dirname, '..', 'page.tsx'),
    'utf8',
);

describe('X2-FIX-A H-1 — action panel buttons Thai', () => {
    it('renders the Thai eyebrow "รอการดำเนินการ" instead of "Action Required"', () => {
        expect(PAGE_SOURCE).toMatch(/รอการดำเนินการ/);
        expect(PAGE_SOURCE).not.toMatch(/Action Required/);
    });

    it('renders the Thai sub-label "รอผลการตรวจ" instead of "Pending Review Decision"', () => {
        expect(PAGE_SOURCE).toMatch(/รอผลการตรวจ/);
        expect(PAGE_SOURCE).not.toMatch(/Pending Review Decision/);
    });

    it('labels the request-revision button "ขอให้แก้ไข"', () => {
        // Locate the action-request-revision button block and assert
        // the label is the Thai string. Regex includes the testid
        // anchor so we don't accidentally match the modal copy
        // ("ส่งคำขอแก้ไข" — a similar but distinct string).
        expect(PAGE_SOURCE).toMatch(
            /data-testid="action-request-revision"[\s\S]*?ขอให้แก้ไข/,
        );
        expect(PAGE_SOURCE).not.toMatch(
            /data-testid="action-request-revision"[\s\S]*?Request Revision/,
        );
    });

    it('labels the approve-documents button "อนุมัติเอกสาร"', () => {
        expect(PAGE_SOURCE).toMatch(
            /data-testid="action-approve-documents"[\s\S]*?อนุมัติเอกสาร/,
        );
        expect(PAGE_SOURCE).not.toMatch(
            /data-testid="action-approve-documents"[\s\S]*?Approve Documents/,
        );
    });
});

describe('X2-FIX-A H-7 — history tab actor name fallback', () => {
    it('reads the actor name with the documented fallback chain', () => {
        // The chain locks the rendering order:
        //   actorName -> actorRole -> by -> "SYSTEM"
        // Backend admin extension/override handlers persist actorName;
        // the canonical workflow event builder still emits only
        // actorRole, so the fallback keeps history attribution intact
        // for both paths.
        // Post Y1-FIX-C: the final "SYSTEM" fallback is wrapped in
        // (detailDict?.history?.system || "SYSTEM") so the dict can
        // localize the system actor label. The chain order is preserved.
        expect(PAGE_SOURCE).toMatch(
            /item\?\.actorName\s*\?\?\s*item\?\.actorRole\s*\?\?\s*item\?\.by\s*\?\?\s*[(\s\w?.|]*"SYSTEM"/,
        );
    });

    it('no longer uses the legacy actorRole-first fallback', () => {
        // The legacy line was:
        //   By: {item?.actorRole || item?.by || "SYSTEM"}
        // which never surfaced actorName even when present. Guard.
        expect(PAGE_SOURCE).not.toMatch(
            /\{item\?\.actorRole \|\| item\?\.by \|\| "SYSTEM"\}/,
        );
    });
});

describe('X2-FIX-A H-10 — Approve / Request-Revision touch target ≥ 44×44', () => {
    it('applies min-h-[44px] min-w-[44px] to the request-revision button', () => {
        // Touch-target compliance is a hard WCAG 2.5.5 AA fail when
        // the buttons sit at the default md (40px). The min-h /
        // min-w pair guards against future primitive size changes.
        expect(PAGE_SOURCE).toMatch(
            /min-h-\[44px\][\s\S]*?min-w-\[44px\][\s\S]*?data-testid="action-request-revision"/,
        );
    });

    it('applies min-h-[44px] min-w-[44px] to the approve-documents button', () => {
        expect(PAGE_SOURCE).toMatch(
            /min-h-\[44px\][\s\S]*?min-w-\[44px\][\s\S]*?data-testid="action-approve-documents"/,
        );
    });
});
