/**
 * T6 — the one card every step uploads through.
 *
 * Two things are load-bearing and both are pinned here:
 *
 *   1. An OPTIONAL slot with nothing behind it is not a problem. It does not count
 *      toward completeness (review-completeness.ts is law), so painting it the same
 *      amber as a genuinely missing paper sends an applicant hunting for a document
 *      nobody asked them for.
 *   2. "เปิดดูในหน้า" goes through `openDocumentPreview`, NEVER `window.open`.
 *      `/uploads` is served `Content-Disposition: attachment`, so a plain link drops
 *      a copy of a national-ID scan onto the reader's disk, outside the platform's
 *      control. That is a PDPA breach, not a UX preference.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import {
    slotCardState,
    openSlotDocument,
    step2QualificationSlots,
    STEP2_QUALIFICATION_SLOT_IDS,
    SLOT_CARD_COPY_TH,
} from '../requirement-slot-card-state';
import { RequirementSlotCard } from '../requirement-slot-card';
import type { RequirementSlot } from '@/lib/services/application-requirements';

const slot = (patch: Partial<RequirementSlot>): RequirementSlot => ({
    slotId: 'land_rights',
    labelTH: 'เอกสารสิทธิ์ที่ดิน',
    description: null,
    sourceHint: null,
    required: true,
    requiredReason: 'ALWAYS',
    satisfied: false,
    fileUrl: null,
    fileName: null,
    uploadedAt: null,
    ...patch,
});

describe('what state a card is in', () => {
    it('separates a REQUIRED gap from an OPTIONAL one — they must not look alike', () => {
        expect(slotCardState(slot({ required: true, satisfied: false }))).toBe('missing');
        expect(slotCardState(slot({ required: false, satisfied: false }))).toBe('optional-missing');
    });

    it('an attached slot is attached whether or not it was required', () => {
        expect(slotCardState(slot({ required: true, satisfied: true }))).toBe('attached');
        expect(slotCardState(slot({ required: false, satisfied: true }))).toBe('attached');
    });
});

describe('opening an attached document', () => {
    it('goes through openDocumentPreview and never through window.open', async () => {
        const openSpy = jest.fn(async () => {});
        const windowOpen = jest.spyOn(window, 'open').mockImplementation(() => null);

        const opened = await openSlotDocument(slot({ satisfied: true, fileUrl: '/uploads/a.pdf' }), openSpy);

        expect(opened).toBe(true);
        expect(openSpy).toHaveBeenCalledWith('/uploads/a.pdf');
        expect(windowOpen).not.toHaveBeenCalled();
        windowOpen.mockRestore();
    });

    it('reports false rather than pretending, when there is no file', async () => {
        const openSpy = jest.fn(async () => {});
        expect(await openSlotDocument(slot({ fileUrl: null }), openSpy)).toBe(false);
        expect(openSpy).not.toHaveBeenCalled();
    });
});

describe('which qualification cards step 2 owns', () => {
    it('lists the six กทล.1 ส่วนที่ ๑ papers, in the catalog’s order', () => {
        expect(STEP2_QUALIFICATION_SLOT_IDS).toEqual([
            'id_house_reg', 'community_reg_members', 'community_assignment',
            'producer_supervision_letter', 'juristic_reg_6m', 'juristic_authority',
        ]);
    });

    it('shows only what the SERVER returned — the engine already scoped by holder type', () => {
        // An INDIVIDUAL filing gets the individual papers back and not the juristic ones.
        const payload = [
            slot({ slotId: 'producer_supervision_letter', labelTH: 'หนังสือกำกับโดยผู้รับอนุญาตผลิตยา' }),
            slot({ slotId: 'id_house_reg', labelTH: 'สำเนาบัตรประชาชนและทะเบียนบ้าน' }),
            slot({ slotId: 'land_rights' }),
        ];
        const shown = step2QualificationSlots(payload).map((s) => s.slotId);
        expect(shown).toEqual(['id_house_reg', 'producer_supervision_letter']);
        // Not a step-2 paper, however present it is in the payload.
        expect(shown).not.toContain('land_rights');
        // Never invented: a juristic card the server did not send is not rendered.
        expect(shown).not.toContain('juristic_reg_6m');
    });

    it('returns nothing when the server asked for none of them', () => {
        expect(step2QualificationSlots([slot({ slotId: 'site_photos' })])).toEqual([]);
    });
});

describe('the card itself', () => {
    // Static render — this repo has no @testing-library/react.
    it('an attached slot shows its filename and the in-page viewer, not a download link', () => {
        const html = renderToStaticMarkup(
            <RequirementSlotCard
                slot={slot({ satisfied: true, fileUrl: '/uploads/chanote.pdf', fileName: 'chanote.pdf' })}
                appId="app-1"
                onChanged={() => {}}
            />,
        );
        expect(html).toContain('chanote.pdf');
        expect(html).toContain(SLOT_CARD_COPY_TH.view);
        expect(html).toContain(SLOT_CARD_COPY_TH.replace);
        // The forbidden shape: an anchor straight at the file.
        expect(html).not.toContain('href="/uploads/chanote.pdf"');
    });

    it('a required gap is marked with a star; an optional one carries the badge instead', () => {
        const required = renderToStaticMarkup(
            <RequirementSlotCard slot={slot({ required: true })} appId="app-1" onChanged={() => {}} />,
        );
        expect(required).toContain('*');
        expect(required).not.toContain(SLOT_CARD_COPY_TH.optionalBadge);

        const optional = renderToStaticMarkup(
            <RequirementSlotCard slot={slot({ required: false })} appId="app-1" onChanged={() => {}} />,
        );
        expect(optional).toContain(SLOT_CARD_COPY_TH.optionalBadge);
    });

    it('says where the paper is obtained, when the catalog knows', () => {
        const html = renderToStaticMarkup(
            <RequirementSlotCard
                slot={slot({ sourceHint: 'สำนักงานที่ดินจังหวัด' })}
                appId="app-1"
                onChanged={() => {}}
            />,
        );
        expect(html).toContain('สำนักงานที่ดินจังหวัด');
    });
});
